import type { NextFunction, Request, Response } from 'express';
import { Product } from '../../models/product.js';
import { InventoryMovement } from '../../models/inventoryMovement.js';
import { InventoryBalance } from '../../models/inventoryBalance.js';
import { AuditLog } from '../../models/auditLog.js';
import { adjustStock, InventoryError } from '../../services/inventoryService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

async function aggregateStock(state: 'LOW_STOCK' | 'OUT_OF_STOCK') {
  const balances = await InventoryBalance.find().populate('product', 'name sku lowStockThreshold status').lean();
  const grouped = new Map<string, any>();
  for (const balance of balances as any[]) {
    if (!balance.product) continue;
    const key = String(balance.product._id);
    const item = grouped.get(key) || {
      id: key,
      name: balance.product.name,
      sku: balance.product.sku,
      lowStockThreshold: balance.product.lowStockThreshold ?? 5,
      quantityOnHand: 0,
      quantityReserved: 0,
    };
    item.quantityOnHand += balance.quantityOnHand;
    item.quantityReserved += balance.quantityReserved;
    grouped.set(key, item);
  }
  // Compatibility for products not yet lazily backfilled: their existing stock is the
  // one-time source value that will seed the first InventoryBalance operation.
  for (const product of await Product.find().select('name sku stock lowStockThreshold').lean()) {
    const key = String(product._id);
    if (!grouped.has(key))
      grouped.set(key, {
        id: key,
        name: product.name,
        sku: product.sku,
        lowStockThreshold: product.lowStockThreshold ?? 5,
        quantityOnHand: product.stock || 0,
        quantityReserved: 0,
      });
  }
  return [...grouped.values()]
    .map(item => ({ ...item, available: item.quantityOnHand - item.quantityReserved }))
    .filter(item => (state === 'OUT_OF_STOCK' ? item.available <= 0 : item.available > 0 && item.available <= item.lowStockThreshold));
}

export const getInventory = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(request.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
    const [data, total] = await Promise.all([
      Product.find()
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(),
    ]);
    return sendSuccess(
      response,
      data.map((p: any) => ({
        id: String(p._id),
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        status: p.status,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold || 5,
        isLowStock: p.stock <= (p.lowStockThreshold || 5),
      })),
      200,
      { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasNextPage: page * limit < total, hasPreviousPage: page > 1 }
    );
  } catch (error) {
    return next(error);
  }
};

export const getLowStock = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await aggregateStock('LOW_STOCK'));
  } catch (error) {
    return next(error);
  }
};

export const getOutOfStock = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await aggregateStock('OUT_OF_STOCK'));
  } catch (error) {
    return next(error);
  }
};

export const getProductMovements = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const data = await InventoryMovement.find({ product: request.params.productId }).sort({ createdAt: -1 }).lean();
    return sendSuccess(response, data);
  } catch (error) {
    return next(error);
  }
};

export const adjustProductStock = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const product = await adjustStock({
      productId: String(request.params.productId),
      quantityDelta: request.body.quantityDelta,
      reason: request.body.reason,
      actor: request.auth!.userId,
      requestId: request.requestId,
      type: 'ADJUSTMENT',
    });
    await AuditLog.create({
      actor: request.auth!.userId,
      action: 'INVENTORY_ADJUSTED',
      resourceType: 'Product',
      resourceId: String(product._id),
      requestId: request.requestId,
      metadata: { quantityDelta: request.body.quantityDelta, reason: request.body.reason },
    });
    return sendSuccess(response, { id: String(product._id), stock: product.stock });
  } catch (error) {
    if (error instanceof InventoryError) return sendFailure(response, 409, 'INSUFFICIENT_STOCK', error.message, request.requestId);
    return next(error);
  }
};
