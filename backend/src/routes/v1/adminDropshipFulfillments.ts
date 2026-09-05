import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
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

/**
 * Admin dropship fulfillment routes (§43).
 *
 * A fulfillment is MansooriKart's record of an obligation on a supplier, created at
 * checkout and never by hand — so there is no create route here, only the operational
 * surface: list, detail, and the guarded PATCH that advances status or records the
 * supplier's reference and tracking.
 *
 * Two boundaries are deliberate. The customer's order status is not touched from here
 * (§33), and advancing a fulfillment to `CANCELLED` records MansooriKart's own intent
 * only — it performs no external cancellation, which is why every response carries the
 * cancellation policy for its current status (§37).
 */
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const STATUSES = ['PENDING', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;
const fail = (error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) =>
  error instanceof DropshipError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);

const listQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    status: z.enum(STATUSES).optional(),
    orderId: z.string().regex(oid).optional(),
    orderNumber: z.string().trim().min(3).max(64).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'status', 'fulfillmentNumber']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
/**
 * Status, supplier reference, tracking and internal notes are the only writable fields.
 * The fulfillment number, the order it belongs to, its line indexes and every stage
 * timestamp are server-owned and stamped by the transition itself (§48).
 */
const patchBody = z
  .object({
    status: z.enum(STATUSES).optional(),
    supplierOrderReference: z.string().trim().min(1).max(160).optional(),
    supplierTrackingNumber: z.string().trim().min(1).max(160).optional(),
    carrier: z.string().trim().min(1).max(120).optional(),
    trackingUrl: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    /** Recorded on the history entry for a status change. */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(body => Object.keys(body).length > 0, { message: 'At least one field is required.' });

const asId = (value: unknown) => (value ? String(value) : null);
/** `supplier` arrives populated from the service, or as a bare id when it was not. */
const supplierView = (value: any) =>
  value && typeof value === 'object' && (value.name || value.code)
    ? { id: asId(value._id), name: value.name ?? null, code: value.code ?? null, email: value.email ?? null, phone: value.phone ?? null }
    : { id: asId(value), name: null, code: null, email: null, phone: null };

/**
 * Fulfillment projection.
 *
 * `orderItems` are the line indexes of the order this obligation covers, which is how one
 * customer order split across two suppliers stays traceable to its lines (§32). The
 * per-stage timestamps are grouped as a timeline so "when was this sent, confirmed,
 * shipped" is answerable at a glance, and `allowedTransitions` states the legal next
 * moves rather than leaving a client to guess them.
 */
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
  // What cancelling would and would not do from here. Never a claim of an external effect.
  cancellationPolicy: CANCELLATION_POLICY[String(item.status ?? 'PENDING')] ?? null,
  createdBy: asId(item.createdBy),
  updatedBy: asId(item.updatedBy),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

/** The documented meaning of cancellation at each stage (§37). Declared before `/:id`. */
router.get('/dropship-fulfillments/cancellation-policy', (_request, response) =>
  sendSuccess(response, {
    statuses: Object.entries(CANCELLATION_POLICY).map(([status, policy]) => ({ status, ...policy, allowedTransitions: allowedTransitions(status) })),
    note: 'MansooriKart records its own intent only. No supplier-side cancellation is performed by this API.',
  })
);

router.get('/dropship-fulfillments', validate(listQuery, 'query'), async (request, response, next) => {
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
});

router.get('/dropship-fulfillments/:id', validate(idParam, 'params'), async (request, response, next) => {
  try {
    return sendSuccess(response, fulfillmentView(await getFulfillment(String(request.params.id))));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.patch('/dropship-fulfillments/:id', validate(idParam, 'params'), validate(patchBody), async (request, response, next) => {
  try {
    return sendSuccess(response, fulfillmentView(await updateFulfillment(request.auth!.userId, String(request.params.id), request.body, request.requestId)));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

export default router;
