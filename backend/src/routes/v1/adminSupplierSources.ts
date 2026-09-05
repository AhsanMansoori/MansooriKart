import express from 'express';
import { z } from 'zod';
import { isSupplierStockStale, SUPPLIER_STOCK_STALE_AFTER_HOURS } from '../../config/dropshipping.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Product } from '../../models/product.js';
import { Supplier } from '../../models/supplier.js';
import { SupplierCatalogItem } from '../../models/supplierCatalogItem.js';
import { preferredSupplierSource } from '../../services/dropshipService.js';
import { marginFor } from '../../services/pricingService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

/**
 * Admin supplier-source visibility (§42, §24, §25).
 *
 * Read-only by design. A sourcing record is written by the CSV import and by nothing
 * else, so there is no create, patch or delete here — an operator who wants different
 * supplier data re-imports the feed, which keeps the import history the single account
 * of where these numbers came from.
 *
 * Every row states plainly how old the supplier's stock figure is and whether that makes
 * it stale, because a CSV feed is advisory: it is not a transactional stock guarantee and
 * is deliberately never written into `InventoryBalance` (§24, §29).
 */
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const productParam = z.object({ productId: z.string().regex(oid) }).strict();
const SORTABLE = ['createdAt', 'updatedAt', 'supplierCost', 'supplierStockUpdatedAt', 'supplierSku'] as const;
const listQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    productId: z.string().regex(oid).optional(),
    supplierSku: z.string().trim().min(1).max(120).optional(),
    availability: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    /** Filtered in the query, not after paging, so the count and the page agree. */
    stale: z.enum(['true', 'false']).optional(),
    sortBy: z.enum(SORTABLE).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const asId = (value: unknown) => (value ? String(value) : null);
const SOURCE_FIELDS =
  '_id supplier product supplierSku supplierProductName supplierCost currency supplierStock supplierAvailability supplierStockUpdatedAt sourceExternalId sourceImageUrls lastImportedAt lastImportJob isActive metadata createdAt updatedAt';
const PRODUCT_FIELDS = '_id name sku status fulfillmentType price sellingPriceOverridden';

/**
 * One sourcing row, joined to the little of the supplier and product an operator needs.
 *
 * `sourceRowHash` is never projected: it is an internal change-detection digest, not
 * operator information (§48). Margin is included because §21 asks for supplier cost,
 * selling price and margin side by side, and it carries its own basis label so nobody
 * mistakes merchandise margin for business profit.
 */
const sourceView = (source: any, suppliers: Map<string, any>, products: Map<string, any>, now: Date) => {
  const supplier = suppliers.get(String(source.supplier));
  const product = products.get(String(source.product));
  return {
    id: asId(source._id),
    supplier: supplier ? { id: asId(supplier._id), name: supplier.name, code: supplier.code } : { id: asId(source.supplier), name: null, code: null },
    product: product
      ? {
          id: asId(product._id),
          name: product.name,
          sku: product.sku,
          status: product.status,
          fulfillmentType: product.fulfillmentType ?? 'OWN_STOCK',
          sellingPrice: typeof product.price === 'number' ? product.price : null,
          sellingPriceOverridden: Boolean(product.sellingPriceOverridden),
        }
      : { id: asId(source.product), name: null, sku: null, status: null, fulfillmentType: null, sellingPrice: null, sellingPriceOverridden: false },
    supplierSku: source.supplierSku,
    supplierProductName: source.supplierProductName ?? null,
    supplierCost: source.supplierCost ?? null,
    currency: source.currency ?? 'PKR',
    supplierStock: typeof source.supplierStock === 'number' ? source.supplierStock : null,
    supplierAvailability: source.supplierAvailability ?? 'UNKNOWN',
    supplierStockUpdatedAt: source.supplierStockUpdatedAt ?? null,
    isSupplierStockStale: isSupplierStockStale(source.supplierStockUpdatedAt, now),
    staleAfterHours: SUPPLIER_STOCK_STALE_AFTER_HOURS,
    margin: marginFor(product?.price, source.supplierCost),
    sourceExternalId: source.sourceExternalId ?? null,
    sourceImageUrls: source.sourceImageUrls ?? [],
    lastImportedAt: source.lastImportedAt ?? null,
    lastImportJob: asId(source.lastImportJob),
    isActive: source.isActive !== false,
    metadata: source.metadata ?? {},
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
};

/** Joins a page of sources to their suppliers and products in two extra bounded queries. */
async function decorate(sources: any[]): Promise<any[]> {
  if (!sources.length) return [];
  const now = new Date();
  const [suppliers, products] = await Promise.all([
    Supplier.find({ _id: { $in: [...new Set(sources.map((source: any) => String(source.supplier)))] } })
      .select('_id name code')
      .lean(),
    Product.find({ _id: { $in: [...new Set(sources.map((source: any) => String(source.product)))] } })
      .select(PRODUCT_FIELDS)
      .lean(),
  ]);
  const supplierById = new Map<string, any>(suppliers.map((item: any) => [String(item._id), item]));
  const productById = new Map<string, any>(products.map((item: any) => [String(item._id), item]));
  return sources.map((source: any) => sourceView(source, supplierById, productById, now));
}

router.get('/supplier-sources', validate(listQuery, 'query'), async (request, response, next) => {
  try {
    const query = request.query as any;
    const filter: Record<string, unknown> = {};
    if (query.supplierId) filter.supplier = query.supplierId;
    if (query.productId) filter.product = query.productId;
    if (query.supplierSku) filter.supplierSku = query.supplierSku;
    if (query.availability) filter.supplierAvailability = query.availability;
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
    if (query.stale !== undefined) {
      const cutoff = new Date(Date.now() - SUPPLIER_STOCK_STALE_AFTER_HOURS * 60 * 60 * 1000);
      // A source that never recorded an update counts as stale: the safe answer about
      // supplier stock is "unknown", never "in stock" (§25).
      Object.assign(
        filter,
        query.stale === 'true'
          ? { $or: [{ supplierStockUpdatedAt: { $lt: cutoff } }, { supplierStockUpdatedAt: null }] }
          : { supplierStockUpdatedAt: { $gte: cutoff } }
      );
    }
    const [items, total] = await Promise.all([
      SupplierCatalogItem.find(filter)
        .select(SOURCE_FIELDS)
        .sort({ [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      SupplierCatalogItem.countDocuments(filter),
    ]);
    return sendSuccess(response, await decorate(items), 200, {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      hasNextPage: query.page * query.limit < total,
      hasPreviousPage: query.page > 1,
      staleAfterHours: SUPPLIER_STOCK_STALE_AFTER_HOURS,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Every supplier that can source one product.
 *
 * More than one is legitimate — the same goods from two suppliers — so the response also
 * names the source checkout would pick: lowest cost first, then the oldest record. Stating
 * it here means an operator sees the same choice the order snapshot will make.
 */
router.get('/products/:productId/supplier-sources', validate(productParam, 'params'), async (request, response, next) => {
  try {
    const product = await Product.findById(request.params.productId).select('_id').lean();
    if (!product) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    const sources = await SupplierCatalogItem.find({ product: request.params.productId }).select(SOURCE_FIELDS).sort({ supplierCost: 1, createdAt: 1 }).lean();
    const items = await decorate(sources);
    // The same helper checkout uses, so the operator's view and the order snapshot agree.
    const preferred = preferredSupplierSource(sources.filter((source: any) => source.isActive !== false));
    return sendSuccess(response, {
      items,
      total: items.length,
      preferredSourceId: preferred ? String(preferred._id) : null,
      staleAfterHours: SUPPLIER_STOCK_STALE_AFTER_HOURS,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/supplier-sources/:id', validate(idParam, 'params'), async (request, response, next) => {
  try {
    const source = await SupplierCatalogItem.findById(request.params.id).select(SOURCE_FIELDS).lean();
    if (!source) return sendFailure(response, 404, 'SUPPLIER_SOURCE_NOT_FOUND', 'Supplier source not found.', request.requestId);
    const [view] = await decorate([source]);
    return sendSuccess(response, view);
  } catch (error) {
    return next(error);
  }
});

export default router;
