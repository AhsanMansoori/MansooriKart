import type { NextFunction, Request, Response } from 'express';
import { ReturnRequest } from '../../models/return.js';
import { Refund } from '../../models/refund.js';
import {
  createRefund,
  OrderError,
  updateRefundStatus as updateRefundStatusService,
  updateReturnStatus as updateReturnStatusService,
} from '../../services/orderService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const meta = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

export const listReturns = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const q: any = request.query,
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
    return sendSuccess(response, data, 200, meta(q.page, q.limit, total));
  } catch (error) {
    return next(error);
  }
};

export const getReturnById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const record = await ReturnRequest.findById(request.params.id)
      .populate('customer', 'name email')
      .populate('order', 'orderNumber items total currency')
      .lean();
    return record ? sendSuccess(response, record) : sendFailure(response, 404, 'RETURN_NOT_FOUND', 'Return not found.', request.requestId);
  } catch (error) {
    return next(error);
  }
};

export const updateReturnStatus = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(
      response,
      await updateReturnStatusService(String(request.params.id), request.body.status, request.auth!.userId, request.body.reason, request.requestId)
    );
  } catch (error: any) {
    return error instanceof OrderError
      ? sendFailure(response, error.code === 'RETURN_NOT_FOUND' ? 404 : 400, error.code, error.message, request.requestId)
      : next(error);
  }
};

export const listRefunds = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const q: any = request.query,
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
    return sendSuccess(response, data, 200, meta(q.page, q.limit, total));
  } catch (error) {
    return next(error);
  }
};

export const getRefundById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const record = await Refund.findById(request.params.id).populate('order', 'orderNumber total currency').lean();
    return record ? sendSuccess(response, record) : sendFailure(response, 404, 'REFUND_NOT_FOUND', 'Refund not found.', request.requestId);
  } catch (error) {
    return next(error);
  }
};

export const updateRefundStatus = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await updateRefundStatusService(String(request.params.id), request.body.status, request.auth!.userId, request.requestId));
  } catch (error: any) {
    return error instanceof OrderError
      ? sendFailure(response, error.code === 'REFUND_NOT_FOUND' ? 404 : 400, error.code, error.message, request.requestId)
      : next(error);
  }
};

export const createOrderRefund = async (request: Request, response: Response, next: NextFunction) => {
  const key = request.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128)
    return sendFailure(response, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', request.requestId);
  try {
    return sendSuccess(
      response,
      await createRefund(String(request.params.orderId), request.auth!.userId, { ...request.body, idempotencyKey: key }, request.requestId),
      201
    );
  } catch (error: any) {
    return error instanceof OrderError
      ? sendFailure(response, error.code === 'ORDER_NOT_FOUND' ? 404 : 400, error.code, error.message, request.requestId)
      : next(error);
  }
};
