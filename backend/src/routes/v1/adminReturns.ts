import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Order } from '../../models/order.js';
import { Refund } from '../../models/refund.js';
import { ReturnRequest } from '../../models/return.js';
import { createRefund, OrderError, updateRefundStatus, updateReturnStatus } from '../../services/orderService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router(),
  oid = /^[a-f\d]{24}$/i;
const id = z.object({ id: z.string().regex(oid) }).strict(),
  orderId = z.object({ orderId: z.string().regex(oid) }).strict();
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED']).optional(),
  })
  .strict();
const status = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED']), reason: z.string().trim().min(3).max(500) }).strict();
const refund = z.object({ amount: z.number().positive(), reason: z.string().trim().min(3).max(500), returnId: z.string().regex(oid).optional() }).strict();
const refundStatus = z.object({ status: z.enum(['APPROVED', 'COMPLETED', 'FAILED']) }).strict();
const meta = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
router.use(requireAuth, requireSuperAdmin);
router.get('/returns', validate(page, 'query'), async (r, s, n) => {
  try {
    const q: any = r.query,
      filter = q.status ? { status: q.status } : {};
    const [data, total] = await Promise.all([
      ReturnRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('customer', 'name email')
        .populate('order', 'orderNumber total currency')
        .lean(),
      ReturnRequest.countDocuments(filter),
    ]);
    return sendSuccess(s, data, 200, meta(q.page, q.limit, total));
  } catch (e) {
    return n(e);
  }
});
router.get('/returns/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    const record = await ReturnRequest.findById(r.params.id).populate('customer', 'name email').populate('order', 'orderNumber items total currency').lean();
    return record ? sendSuccess(s, record) : sendFailure(s, 404, 'RETURN_NOT_FOUND', 'Return not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.patch('/returns/:id/status', validate(id, 'params'), validate(status), async (r, s, n) => {
  try {
    return sendSuccess(s, await updateReturnStatus(String(r.params.id), r.body.status, r.auth!.userId, r.body.reason, r.requestId));
  } catch (e: any) {
    return e instanceof OrderError ? sendFailure(s, e.code === 'RETURN_NOT_FOUND' ? 404 : 400, e.code, e.message, r.requestId) : n(e);
  }
});
router.get('/refunds', validate(page, 'query'), async (r, s, n) => {
  try {
    const q: any = r.query,
      filter = q.status ? { status: q.status } : {};
    const [data, total] = await Promise.all([
      Refund.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('order', 'orderNumber total')
        .lean(),
      Refund.countDocuments(filter),
    ]);
    return sendSuccess(s, data, 200, meta(q.page, q.limit, total));
  } catch (e) {
    return n(e);
  }
});
router.get('/refunds/:id', validate(id, 'params'), async (r, s, n) => {
  try {
    const record = await Refund.findById(r.params.id).populate('order', 'orderNumber total currency').lean();
    return record ? sendSuccess(s, record) : sendFailure(s, 404, 'REFUND_NOT_FOUND', 'Refund not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.patch('/refunds/:id/status', validate(id, 'params'), validate(refundStatus), async (r, s, n) => {
  try {
    return sendSuccess(s, await updateRefundStatus(String(r.params.id), r.body.status, r.auth!.userId, r.requestId));
  } catch (e: any) {
    return e instanceof OrderError ? sendFailure(s, e.code === 'REFUND_NOT_FOUND' ? 404 : 400, e.code, e.message, r.requestId) : n(e);
  }
});
router.post('/orders/:orderId/refunds', validate(orderId, 'params'), validate(refund), async (r, s, n) => {
  const key = r.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128)
    return sendFailure(s, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', r.requestId);
  try {
    return sendSuccess(s, await createRefund(String(r.params.orderId), r.auth!.userId, { ...r.body, idempotencyKey: key }, r.requestId), 201);
  } catch (e: any) {
    return e instanceof OrderError ? sendFailure(s, e.code === 'ORDER_NOT_FOUND' ? 404 : 400, e.code, e.message, r.requestId) : n(e);
  }
});
export default router;
