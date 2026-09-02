import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Product } from '../../models/product.js';
import { InventoryMovement } from '../../models/inventoryMovement.js';
import { InventoryBalance } from '../../models/inventoryBalance.js';
import { AuditLog } from '../../models/auditLog.js';
import { adjustStock, InventoryError } from '../../services/inventoryService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router();
const adjust = z
  .object({
    quantityDelta: z
      .number()
      .int()
      .refine(value => value !== 0),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const productParams = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
router.use(requireAuth, requireSuperAdmin);
router.get('/inventory', async (r, s, n) => {
  try {
    const page = Math.max(1, Number(r.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(r.query.limit) || 20));
    const [data, total] = await Promise.all([
      Product.find()
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(),
    ]);
    return sendSuccess(
      s,
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
  } catch (e) {
    return n(e);
  }
});
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
router.get('/inventory/low-stock', async (_r, s, n) => {
  try {
    return sendSuccess(s, await aggregateStock('LOW_STOCK'));
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/out-of-stock', async (_r, s, n) => {
  try {
    return sendSuccess(s, await aggregateStock('OUT_OF_STOCK'));
  } catch (e) {
    return n(e);
  }
});
router.get('/inventory/:productId/movements', validate(productParams, 'params'), async (r, s, n) => {
  try {
    const data = await InventoryMovement.find({ product: r.params.productId }).sort({ createdAt: -1 }).lean();
    return sendSuccess(s, data);
  } catch (e) {
    return n(e);
  }
});
router.post('/inventory/:productId/adjust', validate(productParams, 'params'), validate(adjust), async (r, s, n) => {
  try {
    const product = await adjustStock({
      productId: String(r.params.productId),
      quantityDelta: r.body.quantityDelta,
      reason: r.body.reason,
      actor: r.auth!.userId,
      requestId: r.requestId,
      type: 'ADJUSTMENT',
    });
    await AuditLog.create({
      actor: r.auth!.userId,
      action: 'INVENTORY_ADJUSTED',
      resourceType: 'Product',
      resourceId: String(product._id),
      requestId: r.requestId,
      metadata: { quantityDelta: r.body.quantityDelta, reason: r.body.reason },
    });
    return sendSuccess(s, { id: String(product._id), stock: product.stock });
  } catch (e) {
    if (e instanceof InventoryError) return sendFailure(s, 409, 'INSUFFICIENT_STOCK', e.message, r.requestId);
    return n(e);
  }
});
export default router;
