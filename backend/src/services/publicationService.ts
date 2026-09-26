import { Types } from 'mongoose';
import { BULK_LIMITS, DEFAULT_IMPORT_CATEGORY } from '../config/dropshipping.js';
import { AuditLog } from '../models/auditLog.js';
import { Category } from '../models/category.js';
import { Product } from '../models/product.js';
import { SupplierCatalogItem } from '../models/supplierCatalogItem.js';

/**
 * The gate between "imported" and "on sale".
 *
 * A CSV import produces DRAFT products and nothing else; this module is the only
 * thing that turns one into an `ACTIVE`, publicly purchasable product, and it does
 * so only when a deliberate admin request passes every launch-critical check. That
 * is the whole point of the two-step flow: a supplier feed can never publish, and
 * neither can an operator who has not filled in the fields a storefront needs.
 *
 * Publication reuses the existing `Product.status` values rather than adding a
 * parallel flag, so the public catalog filter that already selects `ACTIVE` keeps
 * working untouched. See DROPSHIPPING_ARCHITECTURE.md.
 */

export class PublicationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export interface PublicationIssue {
  code: string;
  field?: string;
  message: string;
}

export interface PublicationCandidate {
  id: string;
  name: string | null;
  sku: string | null;
  status: string | null;
  fulfillmentType: string | null;
  price: number | null;
  publishable: boolean;
  issues: PublicationIssue[];
}

const PUBLISH_FIELDS = '_id name sku description category brand image images price status fulfillmentType publishedAt';
const issue = (code: string, message: string, field?: string): PublicationIssue => ({ code, ...(field ? { field } : {}), message });

/** Bounds a bulk request and refuses a list that repeats an id, which would double-audit one product. */
function assertBatch(ids: string[]): void {
  if (!ids.length) throw new PublicationError('PRODUCT_IDS_REQUIRED', 'At least one product id is required.');
  if (ids.length > BULK_LIMITS.maxPublishTargets)
    throw new PublicationError('PRODUCT_IDS_TOO_MANY', `At most ${BULK_LIMITS.maxPublishTargets} products may be processed in one request.`);
  if (new Set(ids.map(String)).size !== ids.length) throw new PublicationError('PRODUCT_IDS_DUPLICATE', 'Product ids must be unique.');
}

/**
 * Every reason a product may not go on sale, as a list rather than a first failure,
 * so an operator can fix a draft in one pass instead of discovering one problem per
 * attempt.
 *
 * The category rule is deliberately permissive about *unknown* names and strict about
 * two things: an imported row left on the `Uncategorized` placeholder has not been
 * classified yet, and a category an admin has archived is not a place to publish into.
 * Free-text categories that predate the Category collection stay publishable.
 */
function publicationIssues(product: any, sourced: Set<string>, archivedCategories: Set<string>): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  if (!String(product.name ?? '').trim()) issues.push(issue('NAME_REQUIRED', 'A product name is required before publishing.', 'name'));
  if (!String(product.sku ?? '').trim()) issues.push(issue('SKU_REQUIRED', 'A MansooriKart SKU is required before publishing.', 'sku'));
  if (!String(product.description ?? '').trim()) issues.push(issue('DESCRIPTION_REQUIRED', 'A description is required before publishing.', 'description'));
  if (!String(product.image ?? '').trim()) issues.push(issue('IMAGE_REQUIRED', 'At least one product image is required before publishing.', 'image'));
  const price = typeof product.price === 'number' ? product.price : 0;
  if (!(price > 0)) issues.push(issue('PRICE_REQUIRED', 'A selling price greater than zero is required before publishing.', 'price'));
  const category = String(product.category ?? '').trim();
  if (!category || category.toLowerCase() === DEFAULT_IMPORT_CATEGORY.toLowerCase())
    issues.push(issue('CATEGORY_REQUIRED', 'A real category is required before publishing.', 'category'));
  else if (archivedCategories.has(category.toLowerCase()))
    issues.push(issue('CATEGORY_ARCHIVED', 'The product category is archived and cannot be published into.', 'category'));
  const fulfillmentType = product.fulfillmentType ?? 'OWN_STOCK';
  if (fulfillmentType !== 'OWN_STOCK' && fulfillmentType !== 'DROPSHIP')
    issues.push(issue('FULFILLMENT_TYPE_INVALID', 'The product fulfillment type is not recognised.', 'fulfillmentType'));
  // A DROPSHIP product with no active supplier source has nobody to ship it, so it
  // could take an order MansooriKart cannot fulfil (§22).
  if (fulfillmentType === 'DROPSHIP' && !sourced.has(String(product._id)))
    issues.push(issue('SUPPLIER_SOURCE_REQUIRED', 'A dropship product requires an active supplier source before publishing.', 'fulfillmentType'));
  return issues;
}

/**
 * The same launch-critical checks, for a product an admin is writing directly rather
 * than publishing from a draft.
 *
 * The admin catalog endpoints accept `status`, so without this they would be a second
 * door into `ACTIVE` that skips every check the publish route makes (§22). One product
 * means `exists` probes instead of the batch `$in` queries above; the caller passes the
 * *effective* product — the stored document merged with the patch — because that is what
 * would be on sale if the write went through.
 */
export async function publicationIssuesFor(product: Record<string, any>): Promise<PublicationIssue[]> {
  const sourced = new Set<string>();
  if (product.fulfillmentType === 'DROPSHIP' && product._id && (await SupplierCatalogItem.exists({ product: product._id, isActive: true })))
    sourced.add(String(product._id));
  const category = String(product.category ?? '').trim();
  const archived = category && (await Category.exists({ name: category, status: 'ARCHIVED' })) ? [category.toLowerCase()] : [];
  return publicationIssues(product, sourced, new Set<string>(archived));
}

/**
 * Read-only publication check for a set of products.
 *
 * Three bounded queries regardless of batch size: the products, the supplier sources
 * of the dropship ones, and the archived categories among the names in play.
 */
export async function evaluatePublication(ids: string[]): Promise<PublicationCandidate[]> {
  assertBatch(ids);
  const products = await Product.find({ _id: { $in: ids } })
    .select(PUBLISH_FIELDS)
    .lean();
  const byId = new Map<string, any>(products.map((item: any) => [String(item._id), item]));
  const dropshipIds = products.filter((item: any) => item.fulfillmentType === 'DROPSHIP').map((item: any) => item._id);
  const sourced = new Set<string>(
    dropshipIds.length
      ? (
          await SupplierCatalogItem.find({ product: { $in: dropshipIds }, isActive: true })
            .select('product')
            .lean()
        ).map((source: any) => String(source.product))
      : []
  );
  const categoryNames = [...new Set(products.map((item: any) => String(item.category ?? '').trim()).filter(Boolean))];
  const archivedCategories = new Set<string>(
    categoryNames.length
      ? (
          await Category.find({ name: { $in: categoryNames }, status: 'ARCHIVED' })
            .select('name')
            .lean()
        ).map((row: any) => String(row.name).toLowerCase())
      : []
  );
  return ids.map(id => {
    const product = byId.get(String(id));
    if (!product)
      return {
        id: String(id),
        name: null,
        sku: null,
        status: null,
        fulfillmentType: null,
        price: null,
        publishable: false,
        issues: [issue('PRODUCT_NOT_FOUND', 'The product was not found.')],
      };
    const issues = publicationIssues(product, sourced, archivedCategories);
    // Republishing an already-live product is a no-op the caller should hear about, but it
    // is not a field problem, so it lives here rather than in the shared field checks.
    if (product.status === 'ACTIVE') issues.push(issue('PRODUCT_ALREADY_ACTIVE', 'The product is already published.', 'status'));
    return {
      id: String(product._id),
      name: product.name ?? null,
      sku: product.sku ?? null,
      status: product.status ?? null,
      fulfillmentType: product.fulfillmentType ?? 'OWN_STOCK',
      price: typeof product.price === 'number' ? product.price : null,
      publishable: issues.length === 0,
      issues,
    };
  });
}

export interface PublicationResult {
  published: PublicationCandidate[];
  rejected: PublicationCandidate[];
}

/**
 * Publishes every product that passes validation and reports the rest untouched.
 *
 * Partial success is deliberate for a bulk request: one unpriced draft in a batch of
 * fifty must not block the other forty-nine, and the caller receives the exact reason
 * each rejected product was left alone. A single-product route turns a non-empty
 * `rejected` list into a 400 instead, so "publish this one" never silently no-ops.
 */
export async function publishProducts(actor: string, ids: string[], requestId?: string): Promise<PublicationResult> {
  const candidates = await evaluatePublication(ids);
  const publishable = candidates.filter(candidate => candidate.publishable);
  const rejected = candidates.filter(candidate => !candidate.publishable);
  if (publishable.length) {
    const now = new Date();
    await Product.updateMany(
      { _id: { $in: publishable.map(candidate => new Types.ObjectId(candidate.id)) }, status: { $ne: 'ACTIVE' } },
      { $set: { status: 'ACTIVE', publishedAt: now, publishedBy: new Types.ObjectId(actor) } }
    );
    await AuditLog.create({
      actor,
      action: ids.length === 1 ? 'PRODUCT_PUBLISHED' : 'PRODUCT_BULK_PUBLISHED',
      resourceType: 'Product',
      resourceId: publishable[0]!.id,
      requestId,
      // Ids only, capped: an audit entry records what was published, not a copy of the catalog.
      metadata: {
        requested: ids.length,
        publishedCount: publishable.length,
        rejectedCount: rejected.length,
        productIds: publishable.slice(0, 50).map(candidate => candidate.id),
      },
    });
  }
  return { published: publishable, rejected };
}

/**
 * Withdraws products from sale.
 *
 * Archiving needs no field validation — an incomplete product is exactly the kind you
 * want to be able to pull — so the only failure is a product that does not exist. The
 * supplier source is left active on purpose: the sourcing relationship still exists,
 * and a later import should update it rather than create a second one. `featured` is
 * cleared so an archived product cannot linger on a home-page rail.
 */
export async function archiveProducts(actor: string, ids: string[], requestId?: string): Promise<{ archived: string[]; missing: string[] }> {
  assertBatch(ids);
  const found = await Product.find({ _id: { $in: ids } })
    .select('_id')
    .lean();
  const archived = found.map((item: any) => String(item._id));
  const missing = ids.map(String).filter(id => !archived.includes(id));
  if (archived.length) {
    await Product.updateMany({ _id: { $in: found.map((item: any) => item._id) } }, { $set: { status: 'ARCHIVED', featured: false } });
    await AuditLog.create({
      actor,
      action: ids.length === 1 ? 'PRODUCT_ARCHIVED' : 'PRODUCT_BULK_ARCHIVED',
      resourceType: 'Product',
      resourceId: archived[0]!,
      requestId,
      metadata: { requested: ids.length, archivedCount: archived.length, productIds: archived.slice(0, 50) },
    });
  }
  return { archived, missing };
}
