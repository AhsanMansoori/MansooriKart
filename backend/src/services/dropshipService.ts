import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { AuditLog } from '../models/auditLog.js';
import { DropshipFulfillment } from '../models/dropshipFulfillment.js';

/**
 * Supplier-side fulfillment of dropship order lines.
 *
 * This module owns the whole lifecycle of a `DropshipFulfillment`: creating one per
 * supplier at checkout, advancing it through the supplier-side statuses, and recording
 * tracking. It is deliberately separate from PurchaseOrder/GoodsReceipt, which move
 * MansooriKart-owned stock into a warehouse — nothing here touches InventoryBalance or
 * InventoryMovement (§59).
 *
 * Two properties matter most and are enforced here rather than in a route:
 *
 * - **Idempotence.** `createFulfillments` is keyed on the `{order, supplier}` unique
 *   index, so a retried or concurrent checkout converges on one fulfillment per
 *   supplier instead of duplicating the supplier's obligation (§34, §44).
 * - **Honesty.** A status change records what MansooriKart believes, never a side
 *   effect at the supplier that MansooriKart did not perform. Cancelling a
 *   `SENT_TO_SUPPLIER` fulfillment marks MansooriKart's intent and says so; it does
 *   not claim the supplier cancelled anything (§37).
 *
 * The customer-facing workflow remains `Order.orderStatus`; this status is the
 * supplier-side one and moves independently (§33). See DROPSHIPPING_ARCHITECTURE.md.
 */

export class DropshipError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export interface DropshipLine {
  /** Zero-based index into `Order.items`. */
  index: number;
  supplier: string;
}

const sequence = () => `DSF-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Legal supplier-side transitions.
 *
 * `FAILED` is reachable from every open state because a supplier can reject a job at
 * any point before delivery, and `CANCELLED` from every state before `DELIVERED`
 * because MansooriKart may pull the job — later cancellations are a return, which
 * remains the Return/Refund domain's business (§38). `DELIVERED` is terminal.
 */
const transitions: Record<string, string[]> = {
  PENDING: ['SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'FAILED', 'CANCELLED'],
  SENT_TO_SUPPLIER: ['SUPPLIER_CONFIRMED', 'SHIPPED', 'FAILED', 'CANCELLED'],
  SUPPLIER_CONFIRMED: ['SHIPPED', 'FAILED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'FAILED', 'CANCELLED'],
  DELIVERED: [],
  FAILED: [],
  CANCELLED: [],
};

export const canTransition = (from: string, to: string): boolean => (transitions[from] ?? []).includes(to);

/** The moves available from a status, so an admin surface can offer exactly those and no others. */
export const allowedTransitions = (from: string): string[] => [...(transitions[from] ?? [])];

/** The timestamp field each status stamps on arrival, so "when did this happen" is answerable per stage. */
const stampFor: Record<string, string> = {
  SENT_TO_SUPPLIER: 'sentToSupplierAt',
  SUPPLIER_CONFIRMED: 'confirmedAt',
  SHIPPED: 'shippedAt',
  DELIVERED: 'deliveredAt',
  FAILED: 'failedAt',
  CANCELLED: 'cancelledAt',
};

/**
 * Creates one fulfillment, treating a `{order, supplier}` collision as success.
 *
 * Two things can raise 11000 here: the generated `fulfillmentNumber` (regenerate and
 * retry) or the `{order, supplier}` pair (a concurrent or retried checkout already
 * created this obligation, so the existing document is the correct answer).
 */
async function createOne(order: any, supplier: string, orderItems: number[], actor?: string, requestId?: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await DropshipFulfillment.create({
        fulfillmentNumber: sequence(),
        order: order._id,
        orderNumber: order.orderNumber,
        orderItems,
        supplier,
        status: 'PENDING',
        statusHistory: [
          {
            from: null,
            to: 'PENDING',
            reason: 'Dropship fulfillment created at checkout',
            actor: actor ? new Types.ObjectId(actor) : null,
            at: new Date(),
          },
        ],
        ...(actor ? { createdBy: new Types.ObjectId(actor) } : {}),
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      lastError = error;
      const existing = await DropshipFulfillment.findOne({ order: order._id, supplier });
      if (existing) return existing;
    }
  }
  throw new DropshipError(
    'DROPSHIP_FULFILLMENT_FAILED',
    `The dropship fulfillment could not be created (${String((lastError as any)?.code ?? 'unknown')}).`,
    500
  );
}

/**
 * Creates the supplier obligations for one order's dropship lines, grouped by supplier.
 *
 * A mixed order yields one fulfillment per distinct supplier and leaves own-stock lines
 * entirely to the existing warehouse flow (§30, §39). Callers pass `requestId` so the
 * single audit entry ties back to the checkout request.
 */
export async function createFulfillments(order: any, lines: DropshipLine[], actor?: string, requestId?: string): Promise<any[]> {
  const grouped = new Map<string, number[]>();
  for (const line of lines) {
    if (!line.supplier) throw new DropshipError('DROPSHIP_SUPPLIER_REQUIRED', 'A dropship order line requires an active supplier source.', 409);
    const key = String(line.supplier);
    const list = grouped.get(key);
    if (list) list.push(line.index);
    else grouped.set(key, [line.index]);
  }
  const created: any[] = [];
  for (const [supplier, orderItems] of grouped) created.push(await createOne(order, supplier, orderItems, actor, requestId));
  if (created.length && actor) {
    await AuditLog.create({
      actor,
      action: 'DROPSHIP_FULFILLMENT_CREATED',
      resourceType: 'DropshipFulfillment',
      resourceId: String(created[0]!._id),
      requestId,
      metadata: {
        orderNumber: order.orderNumber ?? null,
        suppliers: created.length,
        fulfillmentNumbers: created.map((item: any) => String(item.fulfillmentNumber)),
      },
    });
  }
  return created;
}

/**
 * Removes an order's fulfillments. Used only as checkout compensation: when the order
 * document itself is rolled back, its supplier obligations must not survive it (§34).
 */
export async function removeFulfillmentsForOrder(orderId: string | Types.ObjectId): Promise<number> {
  const result = await DropshipFulfillment.deleteMany({ order: orderId });
  return Number((result as any)?.deletedCount ?? 0);
}

export interface FulfillmentListQuery {
  supplier?: string;
  status?: string;
  order?: string;
  orderNumber?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

/** Sorting is an allowlist, so a query string can never sort by an unindexed or internal field. */
const SORTABLE: Record<string, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  status: 'status',
  fulfillmentNumber: 'fulfillmentNumber',
};

/** Paginated admin listing, filterable by supplier, status, order and date window (§43). */
export async function listFulfillments(query: FulfillmentListQuery): Promise<{ items: any[]; total: number }> {
  const filter: Record<string, unknown> = {};
  if (query.supplier) filter.supplier = query.supplier;
  if (query.status) filter.status = query.status;
  if (query.order) filter.order = query.order;
  if (query.orderNumber) filter.orderNumber = query.orderNumber;
  const window: Record<string, Date> = {};
  if (query.from) window.$gte = new Date(query.from);
  if (query.to) window.$lte = new Date(query.to);
  if (Object.keys(window).length) filter.createdAt = window;
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
  const field = SORTABLE[query.sort ?? 'createdAt'] ?? 'createdAt';
  const order = query.direction === 'asc' ? 1 : -1;
  const [items, total] = await Promise.all([
    DropshipFulfillment.find(filter)
      .populate('supplier', 'name code')
      .sort({ [field]: order })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    DropshipFulfillment.countDocuments(filter),
  ]);
  return { items, total };
}

/** One fulfillment with its supplier contact resolved. */
export async function getFulfillment(fulfillmentId: string): Promise<any> {
  const found = await DropshipFulfillment.findById(fulfillmentId).populate('supplier', 'name code email phone').lean();
  if (!found) throw new DropshipError('DROPSHIP_FULFILLMENT_NOT_FOUND', 'The dropship fulfillment was not found.', 404);
  return found;
}

/**
 * What cancelling means at each stage, recorded on the fulfillment itself.
 *
 * MansooriKart can only change its own records. Once a job has been sent, cancellation
 * is an internal intent plus an out-of-band conversation with the supplier — never a
 * claim that the supplier stopped anything (§37).
 */
export const CANCELLATION_POLICY: Record<string, { note: string; requiresSupplierContact: boolean }> = {
  PENDING: { note: 'Nothing had been sent to the supplier, so the cancellation is entirely internal.', requiresSupplierContact: false },
  SENT_TO_SUPPLIER: {
    note: 'MansooriKart recorded its intent to cancel. The supplier must be contacted out of band; no external cancellation has been performed.',
    requiresSupplierContact: true,
  },
  SUPPLIER_CONFIRMED: {
    note: 'The supplier had already accepted the job. MansooriKart recorded its intent to cancel and the supplier must confirm separately.',
    requiresSupplierContact: true,
  },
  SHIPPED: {
    note: 'The parcel was already in transit, so this records intent only. Recovering the goods is a return, handled by the Return and Refund domain.',
    requiresSupplierContact: true,
  },
};

export interface FulfillmentPatch {
  status?: string;
  supplierOrderReference?: string;
  supplierTrackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  notes?: string;
  reason?: string;
}

const TRACKING_FIELDS = ['supplierOrderReference', 'supplierTrackingNumber', 'carrier', 'trackingUrl'] as const;

/** Tracking links are stored for operators to click, so only absolute http(s) URLs are accepted. */
function assertTrackingUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DropshipError('TRACKING_URL_INVALID', 'The tracking URL is not a valid absolute URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new DropshipError('TRACKING_URL_INVALID', 'The tracking URL must use http or https.');
}

/**
 * Advances a fulfillment and/or records supplier reference and tracking.
 *
 * The write is guarded on the status that was read, so two concurrent PATCHes cannot
 * both advance the same fulfillment — the loser gets 409 rather than silently
 * overwriting the winner. Repeating the current status is accepted as a no-op so a
 * retried request does not fail or duplicate a history entry, while any *other*
 * illegal move is refused outright (§33).
 *
 * The customer's order status is untouched: that workflow stays where it was (§33), and
 * inventory is never involved for a dropship line (§29).
 */
export async function updateFulfillment(actor: string, fulfillmentId: string, patch: FulfillmentPatch, requestId?: string): Promise<any> {
  const current = await DropshipFulfillment.findById(fulfillmentId).lean();
  if (!current) throw new DropshipError('DROPSHIP_FULFILLMENT_NOT_FOUND', 'The dropship fulfillment was not found.', 404);
  const from = String(current.status ?? 'PENDING');
  const to = patch.status && patch.status !== from ? patch.status : null;
  if (to && !canTransition(from, to)) throw new DropshipError('DROPSHIP_TRANSITION_INVALID', `A fulfillment cannot move from ${from} to ${to}.`, 409);
  if (patch.trackingUrl) assertTrackingUrl(patch.trackingUrl);
  const now = new Date();
  const update: Record<string, unknown> = { updatedBy: new Types.ObjectId(actor) };
  const changedTracking: string[] = [];
  for (const field of TRACKING_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    update[field] = value;
    if (String(current[field] ?? '') !== String(value)) changedTracking.push(field);
  }
  if (patch.notes !== undefined) update.notes = patch.notes;
  const cancellation = to === 'CANCELLED' ? (CANCELLATION_POLICY[from] ?? null) : null;
  if (to) {
    update.status = to;
    const stamp = stampFor[to];
    if (stamp && !current[stamp]) update[stamp] = now;
  }
  const push = to
    ? {
        $push: {
          statusHistory: {
            from,
            to,
            reason: patch.reason ?? cancellation?.note ?? null,
            actor: new Types.ObjectId(actor),
            at: now,
          },
        },
      }
    : {};
  const saved = await DropshipFulfillment.findOneAndUpdate({ _id: fulfillmentId, status: from }, { $set: update, ...push }, { new: true })
    .populate('supplier', 'name code email phone')
    .lean();
  if (!saved) throw new DropshipError('DROPSHIP_FULFILLMENT_CONFLICT', 'The fulfillment changed while this update was being prepared.', 409);
  if (to)
    await AuditLog.create({
      actor,
      action: 'DROPSHIP_FULFILLMENT_STATUS_CHANGED',
      resourceType: 'DropshipFulfillment',
      resourceId: String(fulfillmentId),
      requestId,
      metadata: {
        fulfillmentNumber: String(saved.fulfillmentNumber ?? ''),
        orderNumber: String(saved.orderNumber ?? ''),
        from,
        to,
        reason: patch.reason ?? null,
        ...(cancellation ? { requiresSupplierContact: cancellation.requiresSupplierContact, cancellationNote: cancellation.note } : {}),
      },
    });
  if (changedTracking.length)
    await AuditLog.create({
      actor,
      action: 'DROPSHIP_FULFILLMENT_TRACKING_UPDATED',
      resourceType: 'DropshipFulfillment',
      resourceId: String(fulfillmentId),
      requestId,
      metadata: {
        fulfillmentNumber: String(saved.fulfillmentNumber ?? ''),
        fields: changedTracking.join(','),
        carrier: saved.carrier ?? null,
        supplierTrackingNumber: saved.supplierTrackingNumber ?? null,
      },
    });
  return saved;
}

/**
 * The one supplier source that governs a product when several suppliers list it.
 *
 * Deterministic on purpose — cheapest cost first, then the oldest record, then the id —
 * so pricing previews, checkout snapshots and fulfillment routing all agree, and a
 * repeated run cannot pick a different supplier because the driver returned rows in
 * another order.
 */
export function preferredSupplierSource(sources: any[]): any {
  return [...sources].sort((a: any, b: any) => {
    const byCost = (a.supplierCost ?? 0) - (b.supplierCost ?? 0);
    if (byCost !== 0) return byCost;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a._id).localeCompare(String(b._id));
  })[0];
}

/**
 * Cancels every still-open fulfillment of an order, used when the customer order itself
 * is cancelled.
 *
 * Terminal fulfillments (DELIVERED, FAILED, already CANCELLED) are left alone, and each
 * cancellation goes through the same guarded transition as an admin PATCH so the
 * recorded history and the supplier-contact caveat are identical (§37).
 */
export async function cancelFulfillmentsForOrder(orderId: string, actor: string, reason: string, requestId?: string): Promise<number> {
  const open = await DropshipFulfillment.find({ order: orderId, status: { $in: ['PENDING', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'SHIPPED'] } })
    .select('_id')
    .lean();
  let cancelled = 0;
  for (const item of open) {
    const done = await updateFulfillment(actor, String((item as any)._id), { status: 'CANCELLED', reason }, requestId).catch(() => null);
    if (done) cancelled += 1;
  }
  return cancelled;
}

/** Every fulfillment attached to one order, for the admin order detail view. */
export async function fulfillmentsForOrder(orderId: string): Promise<any[]> {
  return DropshipFulfillment.find({ order: orderId }).populate('supplier', 'name code').sort({ createdAt: 1 }).lean();
}
