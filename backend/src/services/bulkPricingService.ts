import { BULK_LIMITS } from '../config/dropshipping.js';
import { AuditLog } from '../models/auditLog.js';
import { Product } from '../models/product.js';
import { SupplierCatalogItem } from '../models/supplierCatalogItem.js';
import { preferredSupplierSource } from './dropshipService.js';
import { computePrice, loadActiveRules, loadRuleById, PricingError, selectRule, type PricingRuleShape } from './pricingService.js';

/**
 * Bulk selling-price preview and application.
 *
 * Two operations over the same computation so the numbers an operator approves are
 * the numbers that get written: `previewPricing` reads and returns, `applyPricing`
 * repeats the computation and persists it. Nothing here publishes anything — a
 * repriced DRAFT product stays DRAFT (§20).
 *
 * A price an admin decided is protected by default. `sellingPriceOverridden` products
 * are skipped unless the caller opts in with `includeOverridden`, which is the
 * "admin explicitly applies the suggestion" case from §19; applying then marks the
 * new price as admin-decided in turn, so no later automatic pass moves it silently.
 *
 * See PRICING_ARCHITECTURE.md.
 */

export interface PricingTargetQuery {
  productIds?: string[];
  supplierId?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  fulfillmentType?: 'OWN_STOCK' | 'DROPSHIP';
  ruleId?: string;
  includeOverridden?: boolean;
}

export interface PricingPreviewRow {
  productId: string;
  name: string | null;
  sku: string | null;
  status: string;
  fulfillmentType: string;
  supplierId: string | null;
  supplierSku: string | null;
  supplierCost: number | null;
  currentPrice: number | null;
  sellingPriceOverridden: boolean;
  rule: { id: string; name: string } | null;
  newPrice: number | null;
  grossUnitMargin: number | null;
  grossMarginPercent: number | null;
  appliedMinimumProfit: boolean;
  appliedRounding: boolean;
  willChange: boolean;
  eligible: boolean;
  issues: { code: string; message: string }[];
}

const PRICING_FIELDS = '_id name sku status fulfillmentType category brand price costPrice sellingPriceOverridden';
const money = (value: number) => Number(value.toFixed(2));

/** Builds the product filter, refusing an unbounded "every product" request. */
function targetFilter(query: PricingTargetQuery): Record<string, unknown> {
  const ids = query.productIds ?? [];
  if (ids.length) {
    if (ids.length > BULK_LIMITS.maxPricingTargets)
      throw new PricingError('PRICING_TARGETS_TOO_MANY', `At most ${BULK_LIMITS.maxPricingTargets} products may be priced in one request.`);
    if (new Set(ids.map(String)).size !== ids.length) throw new PricingError('PRICING_TARGETS_DUPLICATE', 'Product ids must be unique.');
    return { _id: { $in: ids } };
  }
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.fulfillmentType) filter.fulfillmentType = query.fulfillmentType;
  if (!query.supplierId && !Object.keys(filter).length)
    throw new PricingError('PRICING_TARGETS_REQUIRED', 'Select products by id, supplier, status or fulfillment type.');
  return filter;
}

/**
 * The one supplier source that governs a product's cost when several exist. Shared with
 * checkout so a preview and the eventual order snapshot never disagree about which
 * supplier is in play.
 */
function bestSource(sources: any[]): any {
  return preferredSupplierSource(sources);
}

/** Loads the products in scope plus their active supplier sources, in a bounded number of queries. */
async function loadTargets(query: PricingTargetQuery): Promise<{ products: any[]; grouped: Map<string, any[]> }> {
  const filter = targetFilter(query);
  if (query.supplierId) {
    const owned = await SupplierCatalogItem.find({ supplier: query.supplierId, isActive: true }).select('product').limit(BULK_LIMITS.maxPricingTargets).lean();
    const supplierProductIds = owned.map((source: any) => String(source.product));
    const explicit = (query.productIds ?? []).map(String);
    filter._id = { $in: explicit.length ? explicit.filter(id => supplierProductIds.includes(id)) : supplierProductIds };
  }
  const products = await Product.find(filter).select(PRICING_FIELDS).sort({ createdAt: -1 }).limit(BULK_LIMITS.maxPricingTargets).lean();
  const sourceFilter: Record<string, unknown> = { product: { $in: products.map((item: any) => item._id) }, isActive: true };
  if (query.supplierId) sourceFilter.supplier = query.supplierId;
  const sources = products.length ? await SupplierCatalogItem.find(sourceFilter).select('product supplier supplierSku supplierCost createdAt').lean() : [];
  const grouped = new Map<string, any[]>();
  for (const source of sources) {
    const key = String((source as any).product);
    const list = grouped.get(key);
    if (list) list.push(source);
    else grouped.set(key, [source]);
  }
  return { products, grouped };
}

/**
 * One product's price proposal.
 *
 * Cost comes from the supplier source for a sourced product and falls back to
 * `Product.costPrice` for an own-stock product with no source, so the same rule engine
 * serves both fulfillment types. Every problem is reported as a row issue rather than
 * thrown, so one unpriceable product cannot abort a batch of five hundred.
 */
function rowFor(product: any, source: any, rules: PricingRuleShape[], explicitRule: PricingRuleShape | null, includeOverridden: boolean): PricingPreviewRow {
  const issues: { code: string; message: string }[] = [];
  const supplierCost =
    source && typeof source.supplierCost === 'number'
      ? money(source.supplierCost)
      : typeof product.costPrice === 'number' && product.costPrice > 0
        ? money(product.costPrice)
        : null;
  const overridden = Boolean(product.sellingPriceOverridden);
  const currentPrice = typeof product.price === 'number' ? money(product.price) : null;
  if (supplierCost === null) issues.push({ code: 'SUPPLIER_COST_MISSING', message: 'The product has no supplier cost, so no price can be computed.' });
  if (overridden && !includeOverridden) issues.push({ code: 'PRICE_MANUALLY_OVERRIDDEN', message: 'The selling price was set by an admin and is preserved.' });
  const rule =
    supplierCost === null
      ? null
      : (explicitRule ?? selectRule(rules, { supplier: source?.supplier, category: product.category, brand: product.brand, supplierCost }));
  if (supplierCost !== null && !rule) issues.push({ code: 'PRICING_RULE_NOT_MATCHED', message: 'No active pricing rule matches this product.' });
  let computed: ReturnType<typeof computePrice> | null = null;
  if (supplierCost !== null && rule) {
    try {
      computed = computePrice(supplierCost, rule);
    } catch (error) {
      issues.push({
        code: error instanceof PricingError ? error.code : 'PRICING_FAILED',
        message: error instanceof PricingError ? error.message : 'The price could not be computed for this product.',
      });
    }
  }
  const newPrice = computed?.suggestedPrice ?? null;
  const eligible = issues.length === 0 && newPrice !== null;
  return {
    productId: String(product._id),
    name: product.name ?? null,
    sku: product.sku ?? null,
    status: product.status ?? 'ACTIVE',
    fulfillmentType: product.fulfillmentType ?? 'OWN_STOCK',
    supplierId: source ? String(source.supplier) : null,
    supplierSku: source?.supplierSku ?? null,
    supplierCost,
    currentPrice,
    sellingPriceOverridden: overridden,
    rule: rule ? { id: String(rule._id ?? ''), name: rule.name ?? '' } : null,
    newPrice,
    grossUnitMargin: computed?.grossUnitMargin ?? null,
    grossMarginPercent: computed?.grossMarginPercent ?? null,
    appliedMinimumProfit: Boolean(computed?.appliedMinimumProfit),
    appliedRounding: Boolean(computed?.appliedRounding),
    willChange: eligible && newPrice !== currentPrice,
    eligible,
    issues,
  };
}

export interface PricingSummary {
  /** Products matched by the target query. */
  targets: number;
  /** Rows with a computable price and no blocking issue. */
  eligible: number;
  /** Eligible rows whose price actually differs from the current one. */
  willChange: number;
  /** Rows left alone because an admin set the price by hand. */
  preservedOverrides: number;
  /** Rows with no computable price: no cost, no matching rule, or a failed computation. */
  blocked: number;
  /** Products written. Always 0 for a preview. */
  updated: number;
}

export interface PricingBatchResult {
  rule: { id: string; name: string } | null;
  rows: PricingPreviewRow[];
  summary: PricingSummary;
}

/** Runs the shared computation once for a target query. */
async function computeRows(query: PricingTargetQuery): Promise<{ rows: PricingPreviewRow[]; rule: PricingRuleShape | null }> {
  const explicitRule = query.ruleId ? await loadRuleById(query.ruleId) : null;
  const rules = explicitRule ? [] : await loadActiveRules();
  const { products, grouped } = await loadTargets(query);
  const includeOverridden = Boolean(query.includeOverridden);
  const rows = products.map((product: any) => {
    const sources = grouped.get(String(product._id)) ?? [];
    return rowFor(product, sources.length ? bestSource(sources) : null, rules, explicitRule, includeOverridden);
  });
  return { rows, rule: explicitRule };
}

function summarize(rows: PricingPreviewRow[], updated: number): PricingSummary {
  return {
    targets: rows.length,
    eligible: rows.filter(row => row.eligible).length,
    willChange: rows.filter(row => row.willChange).length,
    preservedOverrides: rows.filter(row => row.issues.some(item => item.code === 'PRICE_MANUALLY_OVERRIDDEN')).length,
    blocked: rows.filter(row => !row.eligible).length,
    updated,
  };
}

/**
 * Read-only price proposal. Writes nothing, publishes nothing (§20).
 */
export async function previewPricing(query: PricingTargetQuery): Promise<PricingBatchResult> {
  const { rows, rule } = await computeRows(query);
  return {
    rule: rule ? { id: String(rule._id ?? ''), name: rule.name ?? '' } : null,
    rows,
    summary: summarize(rows, 0),
  };
}

/**
 * Applies the same proposal a preview would have produced.
 *
 * Only rows that both pass validation and actually move are written, in one `bulkWrite`
 * rather than a query per product (§52). `sellingPriceOverridden` is set on every written
 * product: the admin has now explicitly decided this price, so a later automatic pass
 * must not move it without being told to (§19). Status is never touched — repricing a
 * DRAFT leaves it DRAFT (§20).
 */
export async function applyPricing(actor: string, query: PricingTargetQuery, requestId?: string): Promise<PricingBatchResult> {
  const { rows, rule } = await computeRows(query);
  const changes = rows.filter(row => row.willChange && row.newPrice !== null);
  let updated = 0;
  if (changes.length) {
    const result = await Product.bulkWrite(
      changes.map(row => ({
        updateOne: {
          filter: { _id: row.productId },
          update: { $set: { price: row.newPrice, sellingPriceOverridden: true } },
        },
      })),
      { ordered: false }
    );
    updated = Number((result as any)?.modifiedCount ?? 0);
    await AuditLog.create({
      actor,
      action: 'PRICING_BULK_APPLIED',
      resourceType: 'Product',
      resourceId: changes[0]!.productId,
      requestId,
      // Counts and ids only: an audit entry records the decision, not a price list.
      metadata: {
        ruleId: rule ? String(rule._id ?? '') : null,
        targets: rows.length,
        changed: changes.length,
        updated,
        includeOverridden: Boolean(query.includeOverridden),
        productIds: changes.slice(0, 50).map(row => row.productId),
      },
    });
  }
  return {
    rule: rule ? { id: String(rule._id ?? ''), name: rule.name ?? '' } : null,
    rows,
    summary: summarize(rows, updated),
  };
}
