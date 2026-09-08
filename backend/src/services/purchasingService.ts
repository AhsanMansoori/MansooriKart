import { atomic } from './transaction.js';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { AuditLog } from '../models/auditLog.js';
import { GoodsReceipt, PurchaseReturn } from '../models/goodsReceipt.js';
import { Product } from '../models/product.js';
import { PurchaseOrder } from '../models/purchaseOrder.js';
import { StockLocation } from '../models/stockLocation.js';
import { Supplier } from '../models/supplier.js';
import { Warehouse } from '../models/warehouse.js';
import { adjustStock, ensureDefaultWarehouse, InventoryError } from './inventoryService.js';

export class PurchasingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

const money = (n: number) => Number(n.toFixed(2));
const sequence = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/** Creates a document, regenerating the server-owned number on a unique-number collision. */
const createWithNumber = async (model: any, field: string, prefix: string, payload: Record<string, unknown>) => {
  return model.create({ ...payload, [field]: sequence(prefix) });
};

/**
 * Purchase orders progress DRAFT -> PENDING_APPROVAL -> APPROVED and then move
 * through receiving. Only APPROVED and PARTIALLY_RECEIVED orders may receive
 * goods; approval alone never touches inventory.
 */
const transitions: Record<string, string[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CLOSED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};
export const canTransition = (from: string, to: string) => (transitions[from] ?? []).includes(to);

const history = (to: string, context: { actor?: string | undefined; requestId?: string | undefined; reason?: string | undefined }) => ({
  from: '$status',
  to,
  reason: context.reason ?? null,
  actor: context.actor ? new Types.ObjectId(context.actor) : null,
  requestId: context.requestId ?? null,
  at: new Date(),
});

/** Reads one field of the PO line identified by `lineId` as an aggregation expression. */
const lineField = (lineId: Types.ObjectId, field: string) => ({
  $let: {
    vars: { line: { $arrayElemAt: [{ $filter: { input: '$items', as: 'i', cond: { $eq: ['$$i._id', lineId] } } }, 0] } },
    in: { $ifNull: [`$$line.${field}`, null] },
  },
});

/**
 * Recomputes purchase-order status from the receiving counters. Completeness is
 * measured against delivered quantity (accepted + rejected), because a supplier
 * that delivered every ordered unit has fulfilled the order even when some units
 * failed inspection.
 */
const recomputeStatusStages = (context: { actor?: string | undefined; requestId?: string | undefined; reason?: string | undefined }) => [
  {
    $set: {
      __next: {
        $cond: [
          { $allElementsTrue: { $map: { input: '$items', as: 'i', in: { $gte: ['$$i.quantityReceived', '$$i.quantityOrdered'] } } } },
          'RECEIVED',
          { $cond: [{ $gt: [{ $sum: '$items.quantityReceived' }, 0] }, 'PARTIALLY_RECEIVED', 'APPROVED'] },
        ],
      },
    },
  },
  {
    $set: {
      statusHistory: {
        $cond: [{ $eq: ['$__next', '$status'] }, '$statusHistory', { $concatArrays: ['$statusHistory', [{ ...history('$__next', context), to: '$__next' }]] }],
      },
      status: '$__next',
    },
  },
  { $unset: '__next' },
];

type LineDelta = { lineId: Types.ObjectId; received: number; accepted: number; rejected: number };

/**
 * Atomically claims receiving capacity on every requested line in one conditional
 * update. Either the whole claim applies or none of it does, so two concurrent
 * receipts can never jointly exceed the ordered quantity.
 */
const reserveReceipt = async (purchaseOrderId: string, deltas: LineDelta[], context: { actor?: string | undefined; requestId?: string | undefined }) =>
  PurchaseOrder.findOneAndUpdate(
    {
      _id: purchaseOrderId,
      status: { $in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
      $expr: {
        $and: deltas.map(delta => ({
          $and: [
            { $ne: [lineField(delta.lineId, 'quantityOrdered'), null] },
            { $lte: [{ $add: [lineField(delta.lineId, 'quantityReceived'), delta.received] }, lineField(delta.lineId, 'quantityOrdered')] },
          ],
        })),
      },
    },
    [
      {
        $set: {
          items: {
            $map: {
              input: '$items',
              as: 'it',
              in: {
                $switch: {
                  branches: deltas.map(delta => ({
                    case: { $eq: ['$$it._id', delta.lineId] },
                    then: {
                      $mergeObjects: [
                        '$$it',
                        {
                          quantityReceived: { $add: ['$$it.quantityReceived', delta.received] },
                          quantityAccepted: { $add: ['$$it.quantityAccepted', delta.accepted] },
                          quantityRejected: { $add: ['$$it.quantityRejected', delta.rejected] },
                        },
                      ],
                    },
                  })),
                  default: '$$it',
                },
              },
            },
          },
          firstReceivedAt: { $ifNull: ['$firstReceivedAt', new Date()] },
          lastReceivedAt: new Date(),
        },
      },
      ...recomputeStatusStages({ ...context, reason: 'Goods received' }),
    ],
    { new: true }
  );

const oid = (value: unknown) => new Types.ObjectId(String(value));

const auditOrThrow = async (payload: Record<string, unknown>, code: string) => {
  try {
    await AuditLog.create(payload);
  } catch (error) {
    if ((error as any)?.hasErrorLabel?.('TransientTransactionError')) throw error;
    throw new PurchasingError(code, 'The operation was reverted because its audit record could not be written.', 500);
  }
};

/* -------------------------------------------------------------------------- */
/* Purchase order lifecycle                                                    */
/* -------------------------------------------------------------------------- */

export const resolveDestination = async (warehouseId?: string, locationId?: string) => {
  if (!warehouseId && !locationId) {
    const fallback = await ensureDefaultWarehouse();
    return { warehouse: oid(fallback.warehouse._id), location: oid(fallback.location._id) };
  }
  if (!warehouseId) throw new PurchasingError('PURCHASE_DESTINATION_INVALID', 'A locationId requires its warehouseId.');
  const warehouse = await Warehouse.findOne({ _id: warehouseId, status: { $ne: 'ARCHIVED' } }).lean();
  if (!warehouse) throw new PurchasingError('WAREHOUSE_NOT_FOUND', 'Warehouse not found.', 404);
  if (!locationId) {
    const primary = await StockLocation.findOne({ warehouse: warehouse._id, status: { $ne: 'ARCHIVED' } })
      .sort({ createdAt: 1 })
      .lean();
    if (!primary) throw new PurchasingError('STOCK_LOCATION_NOT_FOUND', 'The warehouse has no usable stock location.', 404);
    return { warehouse: oid(warehouse._id), location: oid(primary._id) };
  }
  const location = await StockLocation.findOne({ _id: locationId, warehouse: warehouse._id, status: { $ne: 'ARCHIVED' } }).lean();
  if (!location) throw new PurchasingError('STOCK_LOCATION_NOT_FOUND', 'Stock location not found in the given warehouse.', 404);
  return { warehouse: oid(warehouse._id), location: oid(location._id) };
};

/**
 * Builds authoritative purchase-order lines. Product name, sku and every money
 * figure are derived on the server: a submitted total is never trusted, and
 * creating a purchase order never changes stock.
 */
export const buildPurchaseOrderTotals = async (
  items: { productId: string; quantity: number; unitCost: number }[],
  charges: { shippingCost?: number | undefined; taxAmount?: number | undefined; discount?: number | undefined }
) => {
  const ids = items.map(item => item.productId);
  if (new Set(ids).size !== ids.length) throw new PurchasingError('PURCHASE_ITEMS_DUPLICATED', 'Each product may appear only once on a purchase order.');
  const products = await Product.find({ _id: { $in: ids }, status: { $ne: 'ARCHIVED' } })
    .select('_id name sku costPrice')
    .lean();
  const byId = new Map<string, any>(products.map((product: any) => [String(product._id), product]));
  const lines = items.map(item => {
    const product = byId.get(item.productId);
    if (!product) throw new PurchasingError('PRODUCT_NOT_FOUND', 'One or more products do not exist or are archived.', 404);
    return {
      product: oid(product._id),
      name: product.name,
      sku: product.sku ?? undefined,
      quantityOrdered: item.quantity,
      unitCost: money(item.unitCost),
      lineSubtotal: money(item.unitCost * item.quantity),
      quantityReceived: 0,
      quantityAccepted: 0,
      quantityRejected: 0,
      quantityReturned: 0,
    };
  });
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineSubtotal, 0));
  const shippingCost = money(charges.shippingCost ?? 0);
  const taxAmount = money(charges.taxAmount ?? 0);
  const discount = money(Math.min(charges.discount ?? 0, subtotal + shippingCost + taxAmount));
  return { lines, subtotal, shippingCost, taxAmount, discount, total: money(Math.max(0, subtotal + shippingCost + taxAmount - discount)) };
};

const createPurchaseOrderImpl = async (input: {
  supplierId: string;
  items: { productId: string; quantity: number; unitCost: number }[];
  warehouseId?: string | undefined;
  locationId?: string | undefined;
  expectedDate?: Date | undefined;
  reference?: string | undefined;
  notes?: string | undefined;
  shippingCost?: number | undefined;
  taxAmount?: number | undefined;
  discount?: number | undefined;
  actor: string;
  requestId?: string | undefined;
}) => {
  const supplier = await Supplier.findById(input.supplierId).lean();
  if (!supplier) throw new PurchasingError('SUPPLIER_NOT_FOUND', 'Supplier not found.', 404);
  if (supplier.status !== 'ACTIVE') throw new PurchasingError('SUPPLIER_NOT_ACTIVE', 'Purchase orders can only be raised against an active supplier.');
  const destination = await resolveDestination(input.warehouseId, input.locationId);
  const totals = await buildPurchaseOrderTotals(input.items, input);
  const created = await createWithNumber(PurchaseOrder, 'poNumber', 'PO', {
    supplier: supplier._id,
    warehouse: destination.warehouse,
    location: destination.location,
    status: 'DRAFT',
    items: totals.lines,
    currency: supplier.currency ?? 'PKR',
    subtotal: totals.subtotal,
    shippingCost: totals.shippingCost,
    taxAmount: totals.taxAmount,
    discount: totals.discount,
    total: totals.total,
    expectedDate: input.expectedDate ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    statusHistory: [{ to: 'DRAFT', actor: oid(input.actor), requestId: input.requestId ?? null, at: new Date() }],
    createdBy: oid(input.actor),
  });
  await auditOrThrow(
    {
      actor: input.actor,
      action: 'PURCHASE_ORDER_CREATED',
      resourceType: 'PurchaseOrder',
      resourceId: String(created._id),
      requestId: input.requestId,
      metadata: { poNumber: created.poNumber, supplier: String(supplier._id), total: totals.total, lines: totals.lines.length },
    },
    'PURCHASE_ORDER_AUDIT_FAILED'
  );
  return created;
};

const updatePurchaseOrderImpl = async (
  purchaseOrderId: string,
  input: {
    items?: { productId: string; quantity: number; unitCost: number }[] | undefined;
    expectedDate?: Date | undefined;
    reference?: string | undefined;
    notes?: string | undefined;
    shippingCost?: number | undefined;
    taxAmount?: number | undefined;
    discount?: number | undefined;
    warehouseId?: string | undefined;
    locationId?: string | undefined;
  },
  context: { actor: string; requestId?: string | undefined }
) => {
  const existing = await PurchaseOrder.findById(purchaseOrderId).lean();
  if (!existing) throw new PurchasingError('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.', 404);
  if (existing.status !== 'DRAFT')
    throw new PurchasingError('PURCHASE_ORDER_NOT_EDITABLE', 'Only a DRAFT purchase order can be edited. Cancel and raise a new order instead.', 409);
  const update: Record<string, unknown> = {};
  if (input.expectedDate !== undefined) update['expectedDate'] = input.expectedDate;
  if (input.reference !== undefined) update['reference'] = input.reference;
  if (input.notes !== undefined) update['notes'] = input.notes;
  if (input.warehouseId !== undefined || input.locationId !== undefined) {
    const destination = await resolveDestination(input.warehouseId ?? String(existing.warehouse), input.locationId);
    update['warehouse'] = destination.warehouse;
    update['location'] = destination.location;
  }
  const needsTotals = input.items !== undefined || input.shippingCost !== undefined || input.taxAmount !== undefined || input.discount !== undefined;
  if (needsTotals) {
    const items =
      input.items ?? existing.items.map((line: any) => ({ productId: String(line.product), quantity: line.quantityOrdered, unitCost: line.unitCost }));
    const totals = await buildPurchaseOrderTotals(items, {
      shippingCost: input.shippingCost ?? existing.shippingCost,
      taxAmount: input.taxAmount ?? existing.taxAmount,
      discount: input.discount ?? existing.discount,
    });
    Object.assign(update, {
      items: totals.lines,
      subtotal: totals.subtotal,
      shippingCost: totals.shippingCost,
      taxAmount: totals.taxAmount,
      discount: totals.discount,
      total: totals.total,
    });
  }
  const updated = await PurchaseOrder.findOneAndUpdate({ _id: purchaseOrderId, status: 'DRAFT' }, { $set: update }, { new: true });
  if (!updated) throw new PurchasingError('PURCHASE_ORDER_NOT_EDITABLE', 'The purchase order left DRAFT before the update was applied.', 409);
  await AuditLog.create({
    actor: context.actor,
    action: 'PURCHASE_ORDER_UPDATED',
    resourceType: 'PurchaseOrder',
    resourceId: String(updated._id),
    requestId: context.requestId,
    metadata: { poNumber: updated.poNumber, fields: Object.keys(update), total: updated.total },
  });
  return updated;
};

/** Applies a lifecycle transition with a single atomic conditional update. */
const transitionPurchaseOrderImpl = async (
  purchaseOrderId: string,
  to: 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED' | 'CLOSED',
  context: { actor: string; requestId?: string | undefined; reason?: string | undefined }
) => {
  const existing = await PurchaseOrder.findById(purchaseOrderId).select('_id status items poNumber').lean();
  if (!existing) throw new PurchasingError('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.', 404);
  // Checked before the generic transition table so the refusal names its real
  // cause: goods are physically in the warehouse and that history is never erased.
  if (to === 'CANCELLED' && existing.items.some((item: any) => (item.quantityReceived ?? 0) > 0))
    throw new PurchasingError('PURCHASE_ORDER_NOT_CANCELLABLE', 'A purchase order with received goods cannot be cancelled.', 409);
  if (!canTransition(existing.status, to))
    throw new PurchasingError('PURCHASE_ORDER_TRANSITION_INVALID', `A ${existing.status} purchase order cannot move to ${to}.`, 409);
  const filter: Record<string, unknown> = { _id: purchaseOrderId, status: existing.status };
  const extra: Record<string, unknown> = {};
  if (to === 'CANCELLED') {
    // Received goods are physically in the warehouse; that history is never erased.
    filter['items'] = { $not: { $elemMatch: { quantityReceived: { $gt: 0 } } } };
    extra['cancelledAt'] = new Date();
  }
  if (to === 'APPROVED') {
    extra['approvedAt'] = new Date();
    extra['approvedBy'] = oid(context.actor);
  }
  if (to === 'CLOSED') extra['closedAt'] = new Date();
  const updated = await PurchaseOrder.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          ...extra,
          status: to,
          statusHistory: { $concatArrays: ['$statusHistory', [history(to, { ...context, reason: context.reason ?? undefined })]] },
        },
      },
    ],
    { new: true }
  );
  if (!updated) {
    if (to === 'CANCELLED') throw new PurchasingError('PURCHASE_ORDER_NOT_CANCELLABLE', 'A purchase order with received goods cannot be cancelled.', 409);
    throw new PurchasingError('PURCHASE_ORDER_TRANSITION_INVALID', 'The purchase order changed state before the transition was applied.', 409);
  }
  await AuditLog.create({
    actor: context.actor,
    action: `PURCHASE_ORDER_${to}`,
    resourceType: 'PurchaseOrder',
    resourceId: String(updated._id),
    requestId: context.requestId,
    metadata: { poNumber: updated.poNumber, from: existing.status, to, reason: context.reason ?? null },
  });
  return updated;
};

/* -------------------------------------------------------------------------- */
/* Goods receipt                                                               */
/* -------------------------------------------------------------------------- */

type ReceiptLineInput = { purchaseOrderItemId: string; quantityAccepted: number; quantityRejected?: number | undefined; rejectionReason?: string | undefined };

/**
 * Records a delivery against a purchase order.
 *
 * Ordering matters. Line capacity is claimed atomically first, then the receipt
 * document is written (its unique `(purchaseOrder, idempotencyKey)` index is the
 * durable replay authority and is therefore consulted before any stock moves),
 * then accepted quantities are added to inventory through the inventory service.
 * Receipt, counters, stock, costs and audit commit in one MongoDB transaction.
 * An aborted transaction leaves no partial receipt or compensating movements.
 */
const receiveGoodsImpl = async (
  purchaseOrderId: string,
  input: { items: ReceiptLineInput[]; receivedAt?: Date | undefined; note?: string | undefined },
  context: { actor: string; requestId?: string | undefined; idempotencyKey: string }
) => {
  const replay = async () => {
    const existing = await GoodsReceipt.findOne({ purchaseOrder: purchaseOrderId, idempotencyKey: context.idempotencyKey });
    return existing ? Object.assign(existing, { __replayed: true }) : null;
  };
  const alreadyDone = await replay();
  if (alreadyDone) return alreadyDone;

  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId).lean();
  if (!purchaseOrder) throw new PurchasingError('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.', 404);
  if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(purchaseOrder.status))
    throw new PurchasingError('PURCHASE_ORDER_NOT_RECEIVABLE', `Goods cannot be received against a ${purchaseOrder.status} purchase order.`, 409);

  const seen = new Set<string>();
  const deltas: LineDelta[] = [];
  const receiptItems: Record<string, unknown>[] = [];
  let totalAccepted = 0;
  let totalRejected = 0;
  let acceptedValue = 0;
  for (const requested of input.items) {
    if (seen.has(requested.purchaseOrderItemId))
      throw new PurchasingError('PURCHASE_RECEIPT_ITEMS_DUPLICATED', 'Each purchase order line may appear only once per receipt.');
    seen.add(requested.purchaseOrderItemId);
    const line = purchaseOrder.items.find((item: any) => String(item._id) === requested.purchaseOrderItemId);
    if (!line) throw new PurchasingError('PURCHASE_ORDER_ITEM_NOT_FOUND', 'A referenced purchase order line does not exist.', 404);
    const accepted = requested.quantityAccepted;
    const rejected = requested.quantityRejected ?? 0;
    const received = accepted + rejected;
    if (received < 1) throw new PurchasingError('PURCHASE_RECEIPT_QUANTITY_INVALID', 'Each receipt line must record at least one received unit.');
    // Well-formed but in conflict with what the line has already received: 409, the
    // same code the atomic reservation returns when two receipts race for capacity.
    if (line.quantityReceived + received > line.quantityOrdered)
      throw new PurchasingError(
        'PURCHASE_RECEIPT_QUANTITY_INVALID',
        `Receiving ${received} unit(s) would exceed the ${line.quantityOrdered} unit(s) ordered on this line.`,
        409
      );
    deltas.push({ lineId: oid(line._id), received, accepted, rejected });
    receiptItems.push({
      purchaseOrderItem: oid(line._id),
      product: oid(line.product),
      name: line.name,
      sku: line.sku ?? undefined,
      unitCost: line.unitCost,
      quantityAccepted: accepted,
      quantityRejected: rejected,
      rejectionReason: requested.rejectionReason ?? undefined,
    });
    totalAccepted += accepted;
    totalRejected += rejected;
    acceptedValue += line.unitCost * accepted;
  }
  if (!deltas.length) throw new PurchasingError('PURCHASE_RECEIPT_QUANTITY_INVALID', 'A receipt must contain at least one line.');

  const reserved = await reserveReceipt(purchaseOrderId, deltas, context);
  if (!reserved) {
    const raced = await replay();
    if (raced) return raced;
    const current = await PurchaseOrder.findById(purchaseOrderId).select('status').lean();
    if (current && !['APPROVED', 'PARTIALLY_RECEIVED'].includes(current.status))
      throw new PurchasingError('PURCHASE_ORDER_NOT_RECEIVABLE', `Goods cannot be received against a ${current.status} purchase order.`, 409);
    throw new PurchasingError('PURCHASE_RECEIPT_QUANTITY_INVALID', 'Another receipt consumed the remaining ordered quantity.', 409);
  }

  const receipt = await createWithNumber(GoodsReceipt, 'receiptNumber', 'GRN', {
    purchaseOrder: oid(purchaseOrderId),
    supplier: oid(purchaseOrder.supplier),
    warehouse: oid(purchaseOrder.warehouse),
    location: oid(purchaseOrder.location),
    items: receiptItems,
    totalAccepted,
    totalRejected,
    acceptedValue: money(acceptedValue),
    currency: purchaseOrder.currency ?? 'PKR',
    receivedAt: input.receivedAt ?? new Date(),
    note: input.note ?? null,
    receivedBy: oid(context.actor),
    idempotencyKey: context.idempotencyKey,
    requestId: context.requestId ?? null,
  });

  // Only accepted units reach inventory, and only through the inventory service.
  try {
    for (const item of receiptItems) {
      const quantity = item['quantityAccepted'] as number;
      if (quantity <= 0) continue;
      await adjustStock({
        productId: String(item['product']),
        quantityDelta: quantity,
        reason: `Goods receipt ${receipt.receiptNumber} for ${purchaseOrder.poNumber}`,
        actor: context.actor,
        requestId: context.requestId,
        referenceType: 'PurchaseOrder',
        referenceId: String(purchaseOrderId),
        warehouseId: String(purchaseOrder.warehouse),
        locationId: String(purchaseOrder.location),
        type: 'PURCHASE_RECEIPT',
      });
    }
  } catch (error) {
    if (error instanceof InventoryError) throw new PurchasingError(error.code, error.message, 409);
    throw error;
  }

  // Cost price policy: LATEST_PURCHASE_COST. Never a valuation method.
  const costPriceSynced = true;
  {
    for (const item of receiptItems) {
      if ((item['quantityAccepted'] as number) <= 0) continue;
      const before = await Product.findOneAndUpdate({ _id: item['product'] }, { $set: { costPrice: item['unitCost'] } }, { new: false })
        .select('costPrice')
        .lean();
      item['previousCostPrice'] = before?.costPrice ?? undefined;
    }
  }
  await GoodsReceipt.updateOne({ _id: receipt._id }, { $set: { costPriceSynced, items: receiptItems } });

  await auditOrThrow(
    {
      actor: context.actor,
      action: 'PURCHASE_GOODS_RECEIVED',
      resourceType: 'GoodsReceipt',
      resourceId: String(receipt._id),
      requestId: context.requestId,
      metadata: {
        receiptNumber: receipt.receiptNumber,
        poNumber: purchaseOrder.poNumber,
        purchaseOrder: String(purchaseOrderId),
        totalAccepted,
        totalRejected,
        acceptedValue: money(acceptedValue),
        costPriceSynced,
      },
    },
    'PURCHASE_RECEIPT_AUDIT_FAILED'
  );
  return await GoodsReceipt.findById(receipt._id);
};

/* -------------------------------------------------------------------------- */
/* Purchase return                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Returns previously accepted goods to a supplier. Inventory is decremented
 * through the same inventory service that received it, capped per line by
 * `quantityAccepted - quantityReturned` and capped again by the inventory
 * service's own non-negative balance guard. No financial settlement, supplier
 * refund, or credit note is implied or recorded.
 */
const returnToSupplierImpl = async (
  purchaseOrderId: string,
  input: { items: { purchaseOrderItemId: string; quantity: number }[]; reason: string; returnedAt?: Date | undefined },
  context: { actor: string; requestId?: string | undefined; idempotencyKey: string }
) => {
  const replay = async () => {
    const existing = await PurchaseReturn.findOne({ purchaseOrder: purchaseOrderId, idempotencyKey: context.idempotencyKey });
    return existing ? Object.assign(existing, { __replayed: true }) : null;
  };
  const alreadyDone = await replay();
  if (alreadyDone) return alreadyDone;

  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId).lean();
  if (!purchaseOrder) throw new PurchasingError('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.', 404);
  if (!['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(purchaseOrder.status))
    throw new PurchasingError('PURCHASE_RETURN_NOT_ELIGIBLE', 'Only goods that were actually received can be returned to a supplier.', 409);

  const seen = new Set<string>();
  const lines: { lineId: Types.ObjectId; quantity: number }[] = [];
  const returnItems: Record<string, unknown>[] = [];
  let totalQuantity = 0;
  let returnedValue = 0;
  for (const requested of input.items) {
    if (seen.has(requested.purchaseOrderItemId))
      throw new PurchasingError('PURCHASE_RETURN_ITEMS_DUPLICATED', 'Each purchase order line may appear only once per return.');
    seen.add(requested.purchaseOrderItemId);
    const line = purchaseOrder.items.find((item: any) => String(item._id) === requested.purchaseOrderItemId);
    if (!line) throw new PurchasingError('PURCHASE_ORDER_ITEM_NOT_FOUND', 'A referenced purchase order line does not exist.', 404);
    if ((line.quantityReturned ?? 0) + requested.quantity > line.quantityAccepted)
      throw new PurchasingError(
        'PURCHASE_RETURN_QUANTITY_INVALID',
        `Returning ${requested.quantity} unit(s) would exceed the ${line.quantityAccepted - (line.quantityReturned ?? 0)} accepted unit(s) still held.`,
        409
      );
    lines.push({ lineId: oid(line._id), quantity: requested.quantity });
    returnItems.push({
      purchaseOrderItem: oid(line._id),
      product: oid(line.product),
      name: line.name,
      sku: line.sku ?? undefined,
      unitCost: line.unitCost,
      quantity: requested.quantity,
    });
    totalQuantity += requested.quantity;
    returnedValue += line.unitCost * requested.quantity;
  }
  if (!lines.length) throw new PurchasingError('PURCHASE_RETURN_QUANTITY_INVALID', 'A supplier return must contain at least one line.');

  const reserved = await PurchaseOrder.findOneAndUpdate(
    {
      _id: purchaseOrderId,
      status: { $in: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'] },
      $expr: {
        $and: lines.map(line => ({
          $lte: [{ $add: [{ $ifNull: [lineField(line.lineId, 'quantityReturned'), 0] }, line.quantity] }, lineField(line.lineId, 'quantityAccepted')],
        })),
      },
    },
    [
      {
        $set: {
          items: {
            $map: {
              input: '$items',
              as: 'it',
              in: {
                $switch: {
                  branches: lines.map(line => ({
                    case: { $eq: ['$$it._id', line.lineId] },
                    then: { $mergeObjects: ['$$it', { quantityReturned: { $add: [{ $ifNull: ['$$it.quantityReturned', 0] }, line.quantity] } }] },
                  })),
                  default: '$$it',
                },
              },
            },
          },
        },
      },
    ],
    { new: true }
  );
  if (!reserved) {
    const raced = await replay();
    if (raced) return raced;
    throw new PurchasingError('PURCHASE_RETURN_QUANTITY_INVALID', 'Another return consumed the remaining accepted quantity.', 409);
  }
  const record = await createWithNumber(PurchaseReturn, 'returnNumber', 'PRT', {
    purchaseOrder: oid(purchaseOrderId),
    supplier: oid(purchaseOrder.supplier),
    warehouse: oid(purchaseOrder.warehouse),
    location: oid(purchaseOrder.location),
    items: returnItems,
    totalQuantity,
    returnedValue: money(returnedValue),
    currency: purchaseOrder.currency ?? 'PKR',
    reason: input.reason,
    returnedAt: input.returnedAt ?? new Date(),
    createdBy: oid(context.actor),
    idempotencyKey: context.idempotencyKey,
    requestId: context.requestId ?? null,
  });

  try {
    for (const item of returnItems) {
      await adjustStock({
        productId: String(item['product']),
        quantityDelta: -(item['quantity'] as number),
        reason: `Supplier return ${record.returnNumber} for ${purchaseOrder.poNumber}`,
        actor: context.actor,
        requestId: context.requestId,
        referenceType: 'PurchaseOrder',
        referenceId: String(purchaseOrderId),
        warehouseId: String(purchaseOrder.warehouse),
        locationId: String(purchaseOrder.location),
        type: 'PURCHASE_RETURN',
      });
    }
  } catch (error) {
    if (error instanceof InventoryError) throw new PurchasingError(error.code, error.message, 409);
    throw error;
  }

  await auditOrThrow(
    {
      actor: context.actor,
      action: 'PURCHASE_RETURN_CREATED',
      resourceType: 'PurchaseReturn',
      resourceId: String(record._id),
      requestId: context.requestId,
      metadata: {
        returnNumber: record.returnNumber,
        poNumber: purchaseOrder.poNumber,
        purchaseOrder: String(purchaseOrderId),
        totalQuantity,
        returnedValue: money(returnedValue),
      },
    },
    'PURCHASE_RETURN_AUDIT_FAILED'
  );
  return record;
};

export const createPurchaseOrder = (...args: Parameters<typeof createPurchaseOrderImpl>) => atomic(() => createPurchaseOrderImpl(...args));

export const updatePurchaseOrder = (...args: Parameters<typeof updatePurchaseOrderImpl>) => atomic(() => updatePurchaseOrderImpl(...args));

export const transitionPurchaseOrder = (...args: Parameters<typeof transitionPurchaseOrderImpl>) => atomic(() => transitionPurchaseOrderImpl(...args));

export const receiveGoods = (...args: Parameters<typeof receiveGoodsImpl>) => atomic(() => receiveGoodsImpl(...args));

export const returnToSupplier = (...args: Parameters<typeof returnToSupplierImpl>) => atomic(() => returnToSupplierImpl(...args));
