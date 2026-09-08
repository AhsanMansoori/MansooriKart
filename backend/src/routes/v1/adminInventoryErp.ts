import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { InventoryBalance } from '../../models/inventoryBalance.js';
import { InventoryMovement } from '../../models/inventoryMovement.js';
import { InventoryTransfer } from '../../models/inventoryTransfer.js';
import { Product } from '../../models/product.js';
import { StockLocation } from '../../models/stockLocation.js';
import { Warehouse } from '../../models/warehouse.js';
import { adjustStock, adjustStockWithAudit, available, ensureDefaultWarehouse, transferStock, InventoryError } from '../../services/inventoryService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router(),
  oid = /^[a-f\d]{24}$/i,
  status = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
const id = z.object({ id: z.string().regex(oid) }).strict();
const warehouse = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,40}$/),
    description: z.string().trim().max(2000).optional(),
    address: z.string().trim().max(1000).optional(),
    contactName: z.string().trim().max(120).optional(),
    contactPhone: z.string().trim().max(30).optional(),
    status: status.default('ACTIVE'),
    isDefault: z.boolean().default(false),
  })
  .strict();
const location = z
  .object({
    warehouseId: z.string().regex(oid),
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,80}$/),
    description: z.string().trim().max(1000).optional(),
    status: status.default('ACTIVE'),
  })
  .strict();
const adjustment = z
  .object({
    productId: z.string().regex(oid),
    warehouseId: z.string().regex(oid).optional(),
    locationId: z.string().regex(oid).optional(),
    quantityDelta: z
      .number()
      .int()
      .refine(v => v !== 0),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const transfer = z
  .object({
    productId: z.string().regex(oid),
    sourceWarehouseId: z.string().regex(oid),
    sourceLocationId: z.string().regex(oid),
    destinationWarehouseId: z.string().regex(oid),
    destinationLocationId: z.string().regex(oid),
    quantity: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    warehouse: z.string().regex(oid).optional(),
    location: z.string().regex(oid).optional(),
    product: z.string().regex(oid).optional(),
    type: z.enum(['INITIAL', 'RESTOCK', 'ORDER', 'CANCELLATION', 'RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN']).optional(),
    referenceType: z.string().trim().min(1).max(80).optional(),
    referenceId: z.string().trim().min(1).max(160).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    stockState: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
    search: z.string().trim().max(80).optional(),
  })
  .strict();
const meta = (p: number, l: number, t: number) => ({
  page: p,
  limit: l,
  total: t,
  totalPages: Math.max(1, Math.ceil(t / l)),
  hasNextPage: p < Math.max(1, Math.ceil(t / l)),
  hasPreviousPage: p > 1,
});
const audit = (r: any, action: string, type: string, resourceId: string, metadata: any) =>
  AuditLog.create({ actor: r.auth.userId, action, resourceType: type, resourceId, requestId: r.requestId, metadata });
const fail = (e: any, r: any, s: any, n: any) =>
  e instanceof InventoryError ? sendFailure(s, e.code === 'INSUFFICIENT_STOCK' ? 409 : 400, e.code, e.message, r.requestId) : n(e);
router.use(requireAuth, requireSuperAdmin);
router.get('/inventory/dashboard', async (_r, s, n) => {
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
    return sendSuccess(s, {
      totalSKUs: new Set(balances.map((b: any) => String(b.product?._id || b.product))).size,
      totalUnits,
      availableUnits,
      reservedUnits,
      lowStockItems: low,
      outOfStockItems: out,
      warehouseCount,
    });
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/stock', validate(page, 'query'), async (r, s, n) => {
  try {
    const q: any = r.query,
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
    return sendSuccess(s, rows, 200, meta(q.page, q.limit, total));
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/stock/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    const product = await Product.findById(r.params.id).lean();
    if (!product) return sendFailure(s, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', r.requestId);
    const balances = await InventoryBalance.find({ product: product._id }).populate('warehouse', 'name code').populate('location', 'name code').lean(),
      movements = await InventoryMovement.find({ product: product._id }).sort({ createdAt: -1 }).limit(20).lean();
    return sendSuccess(s, {
      product: { id: String(product._id), name: product.name, sku: product.sku },
      quantityOnHand: balances.reduce((x: any, b: any) => x + b.quantityOnHand, 0),
      quantityReserved: balances.reduce((x: any, b: any) => x + b.quantityReserved, 0),
      available: balances.reduce((x: any, b: any) => x + available(b), 0),
      lowStockThreshold: product.lowStockThreshold ?? 5,
      balances,
      movements,
    });
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/warehouses', validate(page, 'query'), async (r, s, n) => {
  try {
    const q: any = r.query;
    const [data, total] = await Promise.all([
      Warehouse.find({})
        .sort({ code: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Warehouse.countDocuments(),
    ]);
    return sendSuccess(
      s,
      data.map((x: any) => ({ id: String(x._id), ...x })),
      200,
      meta(q.page, q.limit, total)
    );
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/warehouses/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    const x = await Warehouse.findById(r.params.id).lean();
    return x ? sendSuccess(s, { id: String(x._id), ...x }) : sendFailure(s, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.post('/inventory/warehouses', validate(warehouse), async (r, s, n) => {
  try {
    if (r.body.isDefault) await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    const x = await Warehouse.create(r.body);
    await audit(r, 'WAREHOUSE_CREATED', 'Warehouse', String(x._id), { code: x.code });
    return sendSuccess(s, { id: String(x._id), ...x.toObject() }, 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'WAREHOUSE_CODE_EXISTS', 'Warehouse code already exists.', r.requestId);
    return n(e);
  }
});
router.patch('/inventory/warehouses/:id', validate(id, 'params'), validate(warehouse.partial().strict()), async (r, s, n) => {
  try {
    if (r.body.isDefault) await Warehouse.updateMany({ _id: { $ne: r.params.id }, isDefault: true }, { $set: { isDefault: false } });
    const x = await Warehouse.findByIdAndUpdate(r.params.id, { $set: r.body }, { new: true, runValidators: true }).lean();
    if (!x) return sendFailure(s, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.', r.requestId);
    await audit(r, 'WAREHOUSE_UPDATED', 'Warehouse', String(x._id), { fields: Object.keys(r.body) });
    return sendSuccess(s, { id: String(x._id), ...x });
  } catch (e) {
    return n(e);
  }
});
router.delete('/inventory/warehouses/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    const x = await Warehouse.findByIdAndUpdate(r.params.id, { $set: { status: 'ARCHIVED', isDefault: false } }, { new: true }).lean();
    if (!x) return sendFailure(s, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.', r.requestId);
    await audit(r, 'WAREHOUSE_ARCHIVED', 'Warehouse', String(x._id), {});
    return sendSuccess(s, { id: String(x._id), ...x });
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/locations', validate(page, 'query'), async (r, s, n) => {
  try {
    const q: any = r.query,
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
      s,
      data.map((x: any) => ({ id: String(x._id), ...x })),
      200,
      meta(q.page, q.limit, total)
    );
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/locations/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    const x = await StockLocation.findById(r.params.id).lean();
    return x ? sendSuccess(s, { id: String(x._id), ...x }) : sendFailure(s, 404, 'LOCATION_NOT_FOUND', 'Location not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.post('/inventory/locations', validate(location), async (r, s, n) => {
  try {
    if (!(await Warehouse.exists({ _id: r.body.warehouseId, status: 'ACTIVE' })))
      return sendFailure(s, 400, 'WAREHOUSE_INVALID', 'Warehouse is unavailable.', r.requestId);
    const x = await StockLocation.create({
      warehouse: r.body.warehouseId,
      name: r.body.name,
      code: r.body.code,
      description: r.body.description,
      status: r.body.status,
    });
    await audit(r, 'STOCK_LOCATION_CREATED', 'StockLocation', String(x._id), { code: x.code, warehouseId: r.body.warehouseId });
    return sendSuccess(s, { id: String(x._id), ...x.toObject() }, 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'LOCATION_CODE_EXISTS', 'Location code already exists for this warehouse.', r.requestId);
    return n(e);
  }
});
router.patch('/inventory/locations/:id', validate(id, 'params'), validate(location.partial().omit({ warehouseId: true }).strict()), async (r, s, n) => {
  try {
    const x = await StockLocation.findByIdAndUpdate(r.params.id, { $set: r.body }, { new: true, runValidators: true }).lean();
    if (!x) return sendFailure(s, 404, 'LOCATION_NOT_FOUND', 'Location not found.', r.requestId);
    await audit(r, 'STOCK_LOCATION_UPDATED', 'StockLocation', String(x._id), { fields: Object.keys(r.body) });
    return sendSuccess(s, { id: String(x._id), ...x });
  } catch (e) {
    return n(e);
  }
});
router.delete('/inventory/locations/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    if (await InventoryBalance.exists({ location: r.params.id, quantityOnHand: { $gt: 0 } }))
      return sendFailure(s, 409, 'LOCATION_HAS_STOCK', 'Location has stock and cannot be archived.', r.requestId);
    const x = await StockLocation.findByIdAndUpdate(r.params.id, { $set: { status: 'ARCHIVED' } }, { new: true }).lean();
    if (!x) return sendFailure(s, 404, 'LOCATION_NOT_FOUND', 'Location not found.', r.requestId);
    await audit(r, 'STOCK_LOCATION_ARCHIVED', 'StockLocation', String(x._id), {});
    return sendSuccess(s, { id: String(x._id), ...x });
  } catch (e) {
    return n(e);
  }
});
router.post('/inventory/adjustments', validate(adjustment), async (r, s, n) => {
  try {
    const x = await adjustStockWithAudit({ ...r.body, actor: r.auth!.userId, requestId: r.requestId });
    return sendSuccess(s, { id: String(x._id), stock: x.stock });
  } catch (e) {
    return fail(e, r, s, n);
  }
});
router.post('/inventory/transfers', validate(transfer), async (r, s, n) => {
  const key = r.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128)
    return sendFailure(s, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', r.requestId);
  try {
    const replay = await InventoryTransfer.findOne({ idempotencyKey: key }).lean();
    if (replay) return sendSuccess(s, replay, 201);
    const x = await transferStock({ ...r.body, actor: r.auth!.userId, requestId: r.requestId, idempotencyKey: key });
    if ((x as any).__replayed) return sendSuccess(s, x, 201);
    return sendSuccess(s, x, 201);
  } catch (e) {
    return fail(e, r, s, n);
  }
});
router.get('/inventory/movements', validate(page, 'query'), async (r, s, n) => {
  try {
    const q: any = r.query,
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
    return sendSuccess(s, data, 200, meta(q.page, q.limit, total));
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/bootstrap-default', async (_r, s, n) => {
  try {
    const x = await ensureDefaultWarehouse();
    return sendSuccess(s, { warehouseId: String(x.warehouse._id), locationId: String(x.location._id) });
  } catch (e) {
    return n(e);
  }
});
export default router;
