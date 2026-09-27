import type { NextFunction, Request, Response } from 'express';
import { DEFAULT_CURRENCY } from '../../config/storefront.js';
import { isSupplierStockStale, SUPPLIER_STOCK_STALE_AFTER_HOURS } from '../../config/dropshipping.js';
import { Product } from '../../models/product.js';
import { Supplier } from '../../models/supplier.js';
import { SupplierCatalogItem } from '../../models/supplierCatalogItem.js';
import { preferredSupplierSource } from '../../services/dropshipService.js';
import { marginFor } from '../../services/pricingService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const asId = (value: unknown) => (value ? String(value) : null);
const SOURCE_FIELDS =
  '_id supplier product supplierSku supplierProductName supplierCost currency supplierStock supplierAvailability supplierStockUpdatedAt sourceExternalId sourceImageUrls lastImportedAt lastImportJob isActive metadata createdAt updatedAt';
const PRODUCT_FIELDS = '_id name sku status fulfillmentType price sellingPriceOverridden';

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
    currency: source.currency ?? DEFAULT_CURRENCY,
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

export const listSupplierSources = async (request: Request, response: Response, next: NextFunction) => {
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
};

export const getProductSupplierSources = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const product = await Product.findById(request.params.productId).select('_id').lean();
    if (!product) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    const sources = await SupplierCatalogItem.find({ product: request.params.productId }).select(SOURCE_FIELDS).sort({ supplierCost: 1, createdAt: 1 }).lean();
    const items = await decorate(sources);
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
};

export const getSupplierSourceById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const source = await SupplierCatalogItem.findById(request.params.id).select(SOURCE_FIELDS).lean();
    if (!source) return sendFailure(response, 404, 'SUPPLIER_SOURCE_NOT_FOUND', 'Supplier source not found.', request.requestId);
    const [view] = await decorate([source]);
    return sendSuccess(response, view);
  } catch (error) {
    return next(error);
  }
};
