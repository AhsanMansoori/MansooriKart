import { type NextFunction, type Response } from 'express';
import { Types } from 'mongoose';
import { Order } from '../../models/order.js';
import { Refund } from '../../models/refund.js';
import { ReturnRequest } from '../../models/return.js';
import { customerOrder, customerRefund, customerReturn, customerStatusHistory } from '../../serializers/index.js';
import { buildInvoice } from '../../services/invoice.js';
import { renderInvoicePdf } from '../../services/invoicePdf.js';
import { cancelOrder, checkout, OrderError, previewCheckout, requestReturn } from '../../services/orderService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const fail = (e: unknown, r: any, s: any, n: any) =>
  e instanceof OrderError
    ? sendFailure(
        s,
        e.code === 'ORDER_NOT_FOUND' || e.code === 'ADDRESS_NOT_FOUND'
          ? 404
          : e.code === 'STOCK_UNAVAILABLE' || e.code === 'DROPSHIP_UNAVAILABLE' || e.code === 'PAYMENT_METHOD_UNAVAILABLE'
            ? 409
            : 400,
        e.code,
        e.message,
        r.requestId
      )
    : n(e);

export async function previewCheckoutHandler(r: any, s: Response, n: NextFunction) {
  if (r.auth!.role !== 'CUSTOMER') return sendFailure(s, 403, 'AUTH_FORBIDDEN', 'Only customers may checkout.', r.requestId);
  try {
    return sendSuccess(s, await previewCheckout(r.auth!.userId, r.body));
  } catch (e) {
    return fail(e, r, s, n);
  }
}

export async function checkoutHandler(r: any, s: Response, n: NextFunction) {
  if (r.auth!.role !== 'CUSTOMER') return sendFailure(s, 403, 'AUTH_FORBIDDEN', 'Only customers may checkout.', r.requestId);
  const key = r.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128)
    return sendFailure(s, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', r.requestId);
  try {
    return sendSuccess(s, customerOrder(await checkout(r.auth!.userId, { ...r.body, idempotencyKey: key }, r.requestId)), 201);
  } catch (e) {
    return fail(e, r, s, n);
  }
}

export async function getCustomerOrders(r: any, s: Response, n: NextFunction) {
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
}

export async function getOrderTracking(r: any, s: Response, n: NextFunction) {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId })
      .select('orderNumber orderStatus statusHistory createdAt updatedAt')
      .lean();
    return order
      ? sendSuccess(s, { orderNumber: order.orderNumber, currentStatus: order.orderStatus, timeline: customerStatusHistory(order.statusHistory) })
      : sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
}

export async function getOrderInvoice(r: any, s: Response, n: NextFunction) {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
    if (!order) return sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
    return sendSuccess(s, buildInvoice(order));
  } catch (e) {
    return n(e);
  }
}

export async function downloadInvoicePdf(r: any, s: Response, n: NextFunction) {
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
}

export async function requestOrderReturn(r: any, s: Response, n: NextFunction) {
  try {
    return sendSuccess(s, customerReturn(await requestReturn(r.auth!.userId, String(r.params.orderId), r.body, r.requestId)), 201);
  } catch (e) {
    return fail(e, r, s, n);
  }
}

export async function getCustomerReturns(r: any, s: Response, n: NextFunction) {
  try {
    const { page, limit } = r.query as any;
    const filter = { customer: r.auth!.userId };
    const [records, total] = await Promise.all([
      ReturnRequest.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ReturnRequest.countDocuments(filter),
    ]);
    return sendSuccess(s, records.map(customerReturn), 200, { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return n(e);
  }
}

export async function getCustomerReturnById(r: any, s: Response, n: NextFunction) {
  try {
    const record = await ReturnRequest.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
    return record ? sendSuccess(s, customerReturn(record)) : sendFailure(s, 404, 'RETURN_NOT_FOUND', 'Return not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
}

export async function getCustomerRefunds(r: any, s: Response, n: NextFunction) {
  try {
    const { page, limit } = r.query as any;
    const [result] = await Refund.aggregate([
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'ownedOrder',
          pipeline: [{ $match: { customer: new Types.ObjectId(r.auth!.userId) } }, { $project: { _id: 1 } }],
        },
      },
      { $match: { 'ownedOrder.0': { $exists: true } } },
      { $facet: { records: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } },
    ]);
    const total = result?.count[0]?.total ?? 0;
    return sendSuccess(s, (result?.records ?? []).map(customerRefund), 200, { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return n(e);
  }
}

export async function getCustomerOrderById(r: any, s: Response, n: NextFunction) {
  try {
    const order = await Order.findOne({ _id: r.params.orderId, customer: r.auth!.userId }).lean();
    return order ? sendSuccess(s, customerOrder(order)) : sendFailure(s, 404, 'ORDER_NOT_FOUND', 'Order not found.', r.requestId);
  } catch (e) {
    return n(e);
  }
}

export async function cancelCustomerOrder(r: any, s: Response, n: NextFunction) {
  try {
    return sendSuccess(s, customerOrder(await cancelOrder(r.auth!.userId, String(r.params.orderId), r.requestId)));
  } catch (e) {
    return fail(e, r, s, n);
  }
}
