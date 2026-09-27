import type { NextFunction, Request, Response } from 'express';
import { Order } from '../../models/order.js';
import { User } from '../../models/user.js';
import {
  cancelOrder,
  OrderError,
  updateOrderStatus as updateOrderStatusService,
  updatePaymentStatus as updatePaymentStatusService,
} from '../../services/orderService.js';
import { fulfillmentsForOrder } from '../../services/dropshipService.js';
import { buildInvoice } from '../../services/invoice.js';
import { renderInvoicePdf } from '../../services/invoicePdf.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

export const listOrders = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any,
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
      const users = await User.find({ $or: [{ email: query.customer.toLowerCase() }, { name: query.customer }] })
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
    return sendSuccess(response, data, 200, { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return next(error);
  }
};

export const getOrderById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const order = await Order.findById(request.params.orderId).populate('customer', 'name email').lean();
    if (!order) return sendFailure(response, 404, 'ORDER_NOT_FOUND', 'Order not found.', request.requestId);
    return sendSuccess(response, { ...order, dropshipFulfillments: await fulfillmentsForOrder(String(request.params.orderId)) });
  } catch (error) {
    return next(error);
  }
};

export const getOrderInvoice = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const order = await Order.findById(request.params.orderId).populate('customer', 'name email').lean();
    if (!order) return sendFailure(response, 404, 'ORDER_NOT_FOUND', 'Order not found.', request.requestId);
    return sendSuccess(response, buildInvoice(order));
  } catch (error) {
    return next(error);
  }
};

export const getOrderInvoicePdf = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const order = await Order.findById(request.params.orderId).populate('customer', 'name email').lean();
    if (!order) return sendFailure(response, 404, 'ORDER_NOT_FOUND', 'Order not found.', request.requestId);
    const invoice = buildInvoice(order);
    const pdf = await renderInvoicePdf(invoice);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    response.setHeader('Content-Length', String(pdf.length));
    return response.status(200).end(pdf);
  } catch (error) {
    return next(error);
  }
};

export const updateOrderStatus = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(
      response,
      await updateOrderStatusService(
        String(request.params.orderId),
        request.body.status,
        request.auth!.userId,
        request.body.reason || 'Admin status update',
        request.requestId
      )
    );
  } catch (error: any) {
    if (error instanceof OrderError) return sendFailure(response, error.code === 'ORDER_NOT_FOUND' ? 404 : 400, error.code, error.message, request.requestId);
    return next(error);
  }
};

export const updateOrderPaymentStatus = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(
      response,
      await updatePaymentStatusService(
        String(request.params.orderId),
        request.body.paymentStatus,
        request.auth!.userId,
        request.body.reason || 'Admin payment update',
        request.requestId
      )
    );
  } catch (error: any) {
    if (error instanceof OrderError) return sendFailure(response, error.code === 'ORDER_NOT_FOUND' ? 404 : 400, error.code, error.message, request.requestId);
    return next(error);
  }
};

export const cancelAdminOrder = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cancelOrder('', String(request.params.orderId), request.requestId, request.auth!.userId, true));
  } catch (error: any) {
    return error instanceof OrderError
      ? sendFailure(response, error.code === 'ORDER_NOT_FOUND' ? 404 : 400, error.code, error.message, request.requestId)
      : next(error);
  }
};
