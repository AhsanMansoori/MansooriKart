import type { NextFunction, Request, Response } from 'express';
import { AuditLog } from '../../models/auditLog.js';
import { InventoryBalance } from '../../models/inventoryBalance.js';
import { InventoryMovement } from '../../models/inventoryMovement.js';
import { InventoryTransfer } from '../../models/inventoryTransfer.js';
import { Product } from '../../models/product.js';
import { StockLocation } from '../../models/stockLocation.js';
import { Warehouse } from '../../models/warehouse.js';
import { adjustStockWithAudit, available, ensureDefaultWarehouse, transferStock, InventoryError } from '../../services/inventoryService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const meta = (p: number, l: number, t: number) => ({
  page: p,
  limit: l,
  total: t,
  totalPages: Math.max(1, Math.ceil(t / l)),
  hasNextPage: p < Math.max(1, Math.ceil(t / l)),
  hasPreviousPage: p > 1,
});

const audit = (request: Request, action: string, type: string, resourceId: string, metadata: any) =>
  AuditLog.create({ actor: request.auth!.userId, action, resourceType: type, resourceId, requestId: request.requestId, metadata });

const fail = (error: any, request: Request, response: Response, next: NextFunction) =>
  error instanceof InventoryError
    ? sendFailure(response, error.code === 'INSUFFICIENT_STOCK' ? 409 : 400, error.code, error.message, request.requestId)
    : next(error);

export const getInventoryDashboard = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const [balances, warehouseCount] = await Promise.all([
      InventoryBalance.find().populate('product', 'lowStockThreshold').lean(),
      Warehouse.countDocuments({ status: 'ACTIVE' }),
    ]);
    let totalUnits = 0,
      availableUnits = 0,
      reservedUnits = 0;
    const byProduct = new Map<string, { available: number; threshold: number }>();
    for (const b of balances) {
      const a = available(b);
      totalUnits += b.quantityOnHand;
      availableUnits += a;
      reservedUnits += b.quantityReserved;
      const key = String((b.product as any)?._id || b.product);
      const aggregate = byProduct.get(key) || { available: 0, threshold: (b.product as any)?.lowStockThreshold ?? 5 };
      aggregate.available += a;
      byProduct.set(key, aggregate);
    }
    const products = [...byProduct.values()];
    const out = products.filter(item => item.available <= 0).length;
    const low = products.filter(item => item.available > 0 && item.available <= item.threshold).length;
    return sendSuccess(response, {
      totalSKUs: new Set(balances.map((b: any) => String(b.product?._id || b.product))).size,
      totalUnits,
      availableUnits,
      reservedUnits,
      lowStockItems: low,
      outOfStockItems: out,
      warehouseCount,
    });
  } catch (error) {
    return next(error);
  }
};

export const listStockBalances = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const q: any = request.query,
      filter: any = {};
    if (q.warehouse) filter.warehouse = q.warehouse;
    if (q.location) filter.location = q.location;
    if (q.product) filter.product = q.product;
    const [data, total] = await Promise.all([
      InventoryBalance.find(filter)
        .populate('product', 'name sku slug lowStockThreshold category brand status')
        .populate('warehouse', 'name code')
        .populate('location', 'name code')
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      InventoryBalance.countDocuments(filter),
    ]);
    const rows = data
      .map((b: any) => {
        const a = available(b),
          threshold = b.product?.lowStockThreshold ?? 5,
          state = a <= 0 ? 'OUT_OF_STOCK' : a <= threshold ? 'LOW_STOCK' : 'IN_STOCK';
        return {
          id: String(b._id),
          product: b.product ? { id: String(b.product._id), name: b.product.name, sku: b.product.sku } : null,
          warehouse: b.warehouse ? { id: String(b.warehouse._id), code: b.warehouse.code } : null,
          location: b.location ? { id: String(b.location._id), code: b.location.code } : null,
          quantityOnHand: b.quantityOnHand,
          quantityReserved: b.quantityReserved,
          available: a,
          stockState: state,
        };
      })
      .filter((x: any) => !q.stockState || x.stockState === q.stockState)
      .filter(
        (x: any) => !q.search || new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(`${x.product?.name || ''} ${x.product?.sku || ''}`)
      );
    return sendSuccess(response, rows, 200, meta(q.page, q.limit, total));
  } catch (error) {
    return next(error);
  }
};

export const getProductStockDetail = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const product = await Product.findById(request.params.id).lean();
    if (!product) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    const balances = await InventoryBalance.find({ product: product._id }).populate('warehouse', 'name code').populate('location', 'name code').lean(),
      movements = await InventoryMovement.find({ product: product._id }).sort({ createdAt: -1 }).limit(20).lean();
    return sendSuccess(response, {
      product: { id: String(product._id), name: product.name, sku: product.sku },
      quantityOnHand: balances.reduce((x: any, b: any) => x + b.quantityOnHand, 0),
      quantityReserved: balances.reduce((x: any, b: any) => x + b.quantityReserved, 0),
      available: balances.reduce((x: any, b: any) => x + available(b), 0),
      lowStockThreshold: product.lowStockThreshold ?? 5,
      balances,
      movements,
    });
  } catch (error) {
    return next(error);
  }
};

export const listWarehouses = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const q: any = request.query;
    const [data, total] = await Promise.all([
      Warehouse.find({})
        .sort({ code: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Warehouse.countDocuments(),
    ]);
    return sendSuccess(
      response,
      data.map((x: any) => ({ id: String(x._id), ...x })),
      200,
      meta(q.page, q.limit, total)
    );
  } catch (error) {
    return next(error);
  }
};

export const getWarehouseById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const x = await Warehouse.findById(request.params.id).lean();
    return x
      ? sendSuccess(response, { id: String(x._id), ...x })
      : sendFailure(response, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.', request.requestId);
  } catch (error) {
    return next(error);
  }
};

export const createWarehouse = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (request.body.isDefault) await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    const x = await Warehouse.create(request.body);
    await audit(request, 'WAREHOUSE_CREATED', 'Warehouse', String(x._id), { code: x.code });
    return sendSuccess(response, { id: String(x._id), ...x.toObject() }, 201);
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'WAREHOUSE_CODE_EXISTS', 'Warehouse code already exists.', request.requestId);
    return next(error);
  }
};

export const patchWarehouse = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (request.body.isDefault) await Warehouse.updateMany({ _id: { $ne: request.params.id }, isDefault: true }, { $set: { isDefault: false } });
    const x = await Warehouse.findByIdAndUpdate(request.params.id, { $set: request.body }, { new: true, runValidators: true }).lean();
    if (!x) return sendFailure(response, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.', request.requestId);
    await audit(request, 'WAREHOUSE_UPDATED', 'Warehouse', String(x._id), { fields: Object.keys(request.body) });
    return sendSuccess(response, { id: String(x._id), ...x });
  } catch (error) {
    return next(error);
  }
};

export const deleteWarehouse = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const x = await Warehouse.findByIdAndUpdate(request.params.id, { $set: { status: 'ARCHIVED', isDefault: false } }, { new: true }).lean();
    if (!x) return sendFailure(response, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.', request.requestId);
    await audit(request, 'WAREHOUSE_ARCHIVED', 'Warehouse', String(x._id), {});
    return sendSuccess(response, { id: String(x._id), ...x });
  } catch (error) {
    return next(error);
  }
};

export const listLocations = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const q: any = request.query,
      filter: any = q.warehouse ? { warehouse: q.warehouse } : {};
    const [data, total] = await Promise.all([
      StockLocation.find(filter)
        .sort({ code: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      StockLocation.countDocuments(filter),
    ]);
    return sendSuccess(
      response,
      data.map((x: any) => ({ id: String(x._id), ...x })),
      200,
      meta(q.page, q.limit, total)
    );
  } catch (error) {
    return next(error);
  }
};

export const getLocationById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const x = await StockLocation.findById(request.params.id).lean();
    return x ? sendSuccess(response, { id: String(x._id), ...x }) : sendFailure(response, 404, 'LOCATION_NOT_FOUND', 'Location not found.', request.requestId);
  } catch (error) {
    return next(error);
  }
};

export const createLocation = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!(await Warehouse.exists({ _id: request.body.warehouseId, status: 'ACTIVE' })))
      return sendFailure(response, 400, 'WAREHOUSE_INVALID', 'Warehouse is unavailable.', request.requestId);
    const x = await StockLocation.create({
      warehouse: request.body.warehouseId,
      name: request.body.name,
      code: request.body.code,
      description: request.body.description,
      status: request.body.status,
    });
    await audit(request, 'STOCK_LOCATION_CREATED', 'StockLocation', String(x._id), { code: x.code, warehouseId: request.body.warehouseId });
    return sendSuccess(response, { id: String(x._id), ...x.toObject() }, 201);
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'LOCATION_CODE_EXISTS', 'Location code already exists for this warehouse.', request.requestId);
    return next(error);
  }
};

export const patchLocation = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const x = await StockLocation.findByIdAndUpdate(request.params.id, { $set: request.body }, { new: true, runValidators: true }).lean();
    if (!x) return sendFailure(response, 404, 'LOCATION_NOT_FOUND', 'Location not found.', request.requestId);
    await audit(request, 'STOCK_LOCATION_UPDATED', 'StockLocation', String(x._id), { fields: Object.keys(request.body) });
    return sendSuccess(response, { id: String(x._id), ...x });
  } catch (error) {
    return next(error);
  }
};

export const deleteLocation = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (await InventoryBalance.exists({ location: request.params.id, quantityOnHand: { $gt: 0 } }))
      return sendFailure(response, 409, 'LOCATION_HAS_STOCK', 'Location has stock and cannot be archived.', request.requestId);
    const x = await StockLocation.findByIdAndUpdate(request.params.id, { $set: { status: 'ARCHIVED' } }, { new: true }).lean();
    if (!x) return sendFailure(response, 404, 'LOCATION_NOT_FOUND', 'Location not found.', request.requestId);
    await audit(request, 'STOCK_LOCATION_ARCHIVED', 'StockLocation', String(x._id), {});
    return sendSuccess(response, { id: String(x._id), ...x });
  } catch (error) {
    return next(error);
  }
};

export const createAdjustment = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const x = await adjustStockWithAudit({ ...request.body, actor: request.auth!.userId, requestId: request.requestId });
    return sendSuccess(response, { id: String(x._id), stock: x.stock });
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const createTransfer = async (request: Request, response: Response, next: NextFunction) => {
  const key = request.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128)
    return sendFailure(response, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', request.requestId);
  try {
    const replay = await InventoryTransfer.findOne({ idempotencyKey: key }).lean();
    if (replay) return sendSuccess(response, replay, 201);
    const x = await transferStock({ ...request.body, actor: request.auth!.userId, requestId: request.requestId, idempotencyKey: key });
    if ((x as any).__replayed) return sendSuccess(response, x, 201);
    return sendSuccess(response, x, 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const listMovements = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const q: any = request.query,
      filter: any = {};
    for (const k of ['product', 'warehouse', 'location', 'type']) if (q[k]) filter[k] = q[k];
    if (q.referenceType) filter.referenceType = q.referenceType;
    if (q.referenceId) filter.referenceId = q.referenceId;
    if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const [data, total] = await Promise.all([
      InventoryMovement.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      InventoryMovement.countDocuments(filter),
    ]);
    return sendSuccess(response, data, 200, meta(q.page, q.limit, total));
  } catch (error) {
    return next(error);
  }
};

export const bootstrapDefaultWarehouse = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const x = await ensureDefaultWarehouse();
    return sendSuccess(response, { warehouseId: String(x.warehouse._id), locationId: String(x.location._id) });
  } catch (error) {
    return next(error);
  }
};
