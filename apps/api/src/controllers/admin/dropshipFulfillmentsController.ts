import type { NextFunction, Request, Response } from 'express';
import {
  allowedTransitions,
  CANCELLATION_POLICY,
  DropshipError,
  getFulfillment,
  listFulfillments,
  updateFulfillment,
  type FulfillmentListQuery,
} from '../../services/dropshipService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const fail = (error: unknown, request: Request, response: Response, next: NextFunction) =>
  error instanceof DropshipError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);

const asId = (value: unknown) => (value ? String(value) : null);

const supplierView = (value: any) =>
  value && typeof value === 'object' && (value.name || value.code)
    ? { id: asId(value._id), name: value.name ?? null, code: value.code ?? null, email: value.email ?? null, phone: value.phone ?? null }
    : { id: asId(value), name: null, code: null, email: null, phone: null };

const fulfillmentView = (item: any) => ({
  id: asId(item._id),
  fulfillmentNumber: item.fulfillmentNumber,
  order: asId(item.order),
  orderNumber: item.orderNumber ?? null,
  orderItems: item.orderItems ?? [],
  supplier: supplierView(item.supplier),
  status: item.status ?? 'PENDING',
  supplierOrderReference: item.supplierOrderReference ?? null,
  supplierTrackingNumber: item.supplierTrackingNumber ?? null,
  carrier: item.carrier ?? null,
  trackingUrl: item.trackingUrl ?? null,
  timeline: {
    sentToSupplierAt: item.sentToSupplierAt ?? null,
    confirmedAt: item.confirmedAt ?? null,
    shippedAt: item.shippedAt ?? null,
    deliveredAt: item.deliveredAt ?? null,
    failedAt: item.failedAt ?? null,
    cancelledAt: item.cancelledAt ?? null,
  },
  notes: item.notes ?? null,
  statusHistory: ((item.statusHistory as any[]) ?? []).map((entry: any) => ({
    from: entry.from ?? null,
    to: entry.to,
    reason: entry.reason ?? null,
    actor: asId(entry.actor),
    at: entry.at ?? null,
  })),
  allowedTransitions: allowedTransitions(String(item.status ?? 'PENDING')),
  cancellationPolicy: CANCELLATION_POLICY[String(item.status ?? 'PENDING')] ?? null,
  createdBy: asId(item.createdBy),
  updatedBy: asId(item.updatedBy),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const getCancellationPolicy = (_request: Request, response: Response) =>
  sendSuccess(response, {
    statuses: Object.entries(CANCELLATION_POLICY).map(([status, policy]) => ({ status, ...policy, allowedTransitions: allowedTransitions(status) })),
    note: 'MansooriKart records its own intent only. No supplier-side cancellation is performed by this API.',
  });

export const listDropshipFulfillments = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const filter: FulfillmentListQuery = {
      ...(query.supplierId ? { supplier: String(query.supplierId) } : {}),
      ...(query.status ? { status: String(query.status) } : {}),
      ...(query.orderId ? { order: String(query.orderId) } : {}),
      ...(query.orderNumber ? { orderNumber: String(query.orderNumber) } : {}),
      ...(query.from ? { from: new Date(query.from).toISOString() } : {}),
      ...(query.to ? { to: new Date(query.to).toISOString() } : {}),
      sort: String(query.sortBy),
      direction: query.sortOrder === 'asc' ? 'asc' : 'desc',
      page: query.page,
      limit: query.limit,
    };
    const { items, total } = await listFulfillments(filter);
    return sendSuccess(response, items.map(fulfillmentView), 200, {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      hasNextPage: query.page * query.limit < total,
      hasPreviousPage: query.page > 1,
    });
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const getDropshipFulfillmentById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, fulfillmentView(await getFulfillment(String(request.params.id))));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const patchDropshipFulfillment = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, fulfillmentView(await updateFulfillment(request.auth!.userId, String(request.params.id), request.body, request.requestId)));
  } catch (error) {
    return fail(error, request, response, next);
  }
};
