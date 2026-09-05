import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Order } from '../../models/order.js';
import { Refund } from '../../models/refund.js';
import { ReturnRequest } from '../../models/return.js';
import { cancelOrder, checkout, OrderError, requestReturn } from '../../services/orderService.js';
import { buildInvoice } from '../../services/invoice.js';
import { renderInvoicePdf } from '../../services/invoicePdf.js';
import { customerOrder } from '../../serializers/index.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router();
const oid = /^[a-f\d]{24}$/i;
const checkoutBody = z
  .object({ addressId: z.string().regex(oid), couponCode: z.string().trim().min(2).max(64).optional(), paymentMethod: z.literal('CASH_ON_DELIVERY') })
  .strict();
const params = z.object({ orderId: z.string().regex(oid) }).strict();
const emptyBody = z.object({}).strict();
const returnBody = z
  .object({
    items: z
      .array(z.object({ productId: z.string().regex(oid), quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(50),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  })
  .strict();
// `DROPSHIP_UNAVAILABLE` is the supplier-side twin of `STOCK_UNAVAILABLE`: a well-formed
// request for goods that are not obtainable, so it answers 409 alongside it (§30).
const fail = (e: unknown, r: any, s: any, n: any) =>
  e instanceof OrderError
    ? sendFailure(
        s,
        e.code === 'ORDER_NOT_FOUND' || e.code === 'ADDRESS_NOT_FOUND' ? 404 : e.code === 'STOCK_UNAVAILABLE' || e.code === 'DROPSHIP_UNAVAILABLE' ? 409 : 400,
        e.code,
        e.message,
        r.requestId
      )
    : n(e);
router.use(requireAuth);
router.post('/checkout', validate(checkoutBody), async (r, s, n) => {
  if (r.auth!.role !== 'CUSTOMER') return sendFailure(s, 403, 'AUTH_FORBIDDEN', 'Only customers may checkout.', r.requestId);
  const key = r.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128)
    return sendFailure(s, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', r.requestId);
  try {
    return sendSuccess(s, customerOrder(await checkout(r.auth!.userId, { ...r.body, idempotencyKey: key }, r.requestId)), 201);
  } catch (e) {
    return fail(e, r, s, n);
  }
});
router.get('/orders', validate(listQuery, 'query'), async (r, s, n) => {
  try {
    const { page, limit, status } = r.query as any;
    const filter: any = { customer: r.auth!.userId };
    if (status) filter.orderStatus = status;
    const [data, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return sendSuccess(s, data.map(customerOrder), 200, { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return n(e);
  }
});
router.get('/orders/:orderId/tracking', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId })
      .select('orderNumber orderStatus statusHistory createdAt updatedAt')
      .lean();
    return order
      ? sendSuccess(s, { orderNumber: order.orderNumber, currentStatus: order.orderStatus, timeline: order.statusHistory })
      : sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.get('/orders/:orderId/invoice', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
    if (!order) return sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
    return sendSuccess(s, buildInvoice(order));
  } catch (e) {
    return n(e);
  }
});
router.get('/orders/:orderId/invoice.pdf', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
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
router.post('/orders/:orderId/returns', validate(params, 'params'), validate(returnBody), async (r, s, n) => {
  try {
    return sendSuccess(s, await requestReturn(r.auth!.userId, String(r.params.orderId), r.body, r.requestId), 201);
  } catch (e) {
    return fail(e, r, s, n);
  }
});
router.get('/returns', async (r, s, n) => {
  try {
    return sendSuccess(s, await ReturnRequest.find({ customer: r.auth!.userId }).sort({ createdAt: -1 }).lean());
  } catch (e) {
    return n(e);
  }
});
router.get('/returns/:orderId', validate(params, 'params'), async (r, s, n) => {
  try {
    const record = await ReturnRequest.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
    return record ? sendSuccess(s, record) : sendFailure(s, 404, 'RETURN_NOT_FOUND', 'Return not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.get('/refunds', async (r, s, n) => {
  try {
    const orders = await Order.find({ customer: r.auth!.userId }).select('_id').lean();
    return sendSuccess(
      s,
      await Refund.find({ order: { $in: orders.map((x: any) => x._id) } })
        .sort({ createdAt: -1 })
        .lean()
    );
  } catch (e) {
    return n(e);
  }
});
router.get('/orders/:orderId', validate(params, 'params'), async (r, s, n) => {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
    return order ? sendSuccess(s, customerOrder(order)) : sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
});
router.post('/orders/:orderId/cancel', validate(params, 'params'), validate(emptyBody), async (r, s, n) => {
  try {
    return sendSuccess(s, customerOrder(await cancelOrder(r.auth!.userId, String(r.params.orderId), r.requestId)));
  } catch (e) {
    return fail(e, r, s, n);
  }
});
export default router;
