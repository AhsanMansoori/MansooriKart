import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Order } from '../../models/order.js';
import { cancelOrder, OrderError, updateOrderStatus, updatePaymentStatus } from '../../services/orderService.js';
import { fulfillmentsForOrder } from '../../services/dropshipService.js';
import { buildInvoice } from '../../services/invoice.js';
import { renderInvoicePdf } from '../../services/invoicePdf.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router(),
  oid = /^[a-f\d]{24}$/i;
const params = z.object({ orderId: z.string().regex(oid) }).strict();
const status = z
  .object({ status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']), reason: z.string().trim().min(3).max(500).optional() })
  .strict();
const payment = z
  .object({
    paymentStatus: z.enum(['PENDING', 'UNPAID', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    orderNumber: z.string().trim().min(1).max(64).optional(),
    customer: z.string().trim().min(1).max(120).optional(),
    orderStatus: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
    paymentStatus: z.enum(['PENDING', 'UNPAID', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
    paymentMethod: z.literal('CASH_ON_DELIVERY').optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    sort: z.enum(['createdAt', 'total', 'orderNumber']).default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
router.use(requireAuth, requireSuperAdmin);
router.get('/orders', validate(listQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as any,
      page = query.page,
      limit = query.limit,
      filter: any = {};
    for (const key of ['orderStatus', 'paymentStatus', 'paymentMethod'] as const) if (query[key]) filter[key] = query[key];
    if (query.orderNumber) filter.orderNumber = query.orderNumber.toUpperCase();
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    if (query.minAmount !== undefined || query.maxAmount !== undefined)
      filter.total = {
        ...(query.minAmount !== undefined ? { $gte: query.minAmount } : {}),
        ...(query.maxAmount !== undefined ? { $lte: query.maxAmount } : {}),
      };
    if (query.customer) {
      const users = await (
        await import('../../models/user.js')
      ).User.find({ $or: [{ email: query.customer.toLowerCase() }, { name: query.customer }] })
        .select('_id')
        .lean();
      filter.customer = { $in: users.map((user: any) => user._id) };
    }
    const [data, total] = await Promise.all([
      Order.find(filter)
        .sort({ [query.sort]: query.direction === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', 'name email')
        .lean(),
      Order.countDocuments(filter),
    ]);
    return sendSuccess(s, data, 200, { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return n(e);
  }
});
/**
 * Order detail carries the supplier obligations attached to the order.
 *
 * A mixed order splits across suppliers (§32), so "who was asked to ship what" is only
 * answerable from the fulfillments; showing them here saves a second call and keeps the
 * own-stock lines visibly separate from the dropship ones. The full operational surface —
 * filtering, status transitions, tracking — stays on `/dropship-fulfillments` (§43).
 */
router.get('/orders/:orderId', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findById(r.params.orderId).populate('customer', 'name email').lean();
    if (!order) return sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
    return sendSuccess(s, { ...order, dropshipFulfillments: await fulfillmentsForOrder(String(r.params.orderId)) });
  } catch (e) {
    return n(e);
  }
});
router.get('/orders/:orderId/invoice', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findById(r.params.orderId).populate('customer', 'name email').lean();
    if (!order) return sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
    return sendSuccess(s, buildInvoice(order));
  } catch (e) {
    return n(e);
  }
});
router.get('/orders/:orderId/invoice.pdf', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findById(r.params.orderId).populate('customer', 'name email').lean();
    if (!order) return sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
    const invoice = buildInvoice(order);
    const pdf = await renderInvoicePdf(invoice);
    s.setHeader('Content-Type', 'application/pdf');
    s.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    s.setHeader('Content-Length', String(pdf.length));
    return s.status(200).end(pdf);
  } catch (e) {
    return n(e);
  }
});
router.patch('/orders/:orderId/status', validate(params, 'params'), validate(status), async (r, s, n) => {
  try {
    return sendSuccess(
      s,
      await updateOrderStatus(String(r.params.orderId), r.body.status, r.auth!.userId, r.body.reason || 'Admin status update', r.requestId)
    );
  } catch (e: any) {
    if (e instanceof OrderError) return sendFailure(s, e.code === 'ORDER_NOT_FOUND' ? 404 : 400, e.code, e.message, r.requestId);
    return n(e);
  }
});
router.patch('/orders/:orderId/payment-status', validate(params, 'params'), validate(payment), async (r, s, n) => {
  try {
    return sendSuccess(
      s,
      await updatePaymentStatus(String(r.params.orderId), r.body.paymentStatus, r.auth!.userId, r.body.reason || 'Admin payment update', r.requestId)
    );
  } catch (e: any) {
    if (e instanceof OrderError) return sendFailure(s, e.code === 'ORDER_NOT_FOUND' ? 404 : 400, e.code, e.message, r.requestId);
    return n(e);
  }
});
router.post('/orders/:orderId/cancel', validate(params, 'params'), validate(z.object({}).strict()), async (r, s, n) => {
  try {
    return sendSuccess(s, await cancelOrder('', String(r.params.orderId), r.requestId, r.auth!.userId, true));
  } catch (e: any) {
    return e instanceof OrderError ? sendFailure(s, e.code === 'ORDER_NOT_FOUND' ? 404 : 400, e.code, e.message, r.requestId) : n(e);
  }
});
export default router;
