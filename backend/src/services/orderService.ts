import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { BLOCKING_SUPPLIER_AVAILABILITY } from '../config/dropshipping.js';
import { Address } from '../models/address.js';
import { AuditLog } from '../models/auditLog.js';
import { Cart } from '../models/cart.js';
import { Coupon } from '../models/coupon.js';
import { CouponRedemption } from '../models/couponRedemption.js';
import { Order } from '../models/order.js';
import { Product } from '../models/product.js';
import { Refund } from '../models/refund.js';
import { ReturnRequest } from '../models/return.js';
import { ReturnAllocation } from '../models/returnAllocation.js';
import { SupplierCatalogItem } from '../models/supplierCatalogItem.js';
import {
  cancelFulfillmentsForOrder,
  createFulfillments,
  DropshipError,
  preferredSupplierSource,
  removeFulfillmentsForOrder,
  type DropshipLine,
} from './dropshipService.js';
import { adjustStock, InventoryError } from './inventoryService.js';
import { computeTax, getStoreConfiguration, isCashOnDeliveryAllowed, quoteShipping } from './storeConfigService.js';
import { sendOrderConfirmation } from './transactionalEmail.js';

export class OrderError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}
const money = (n: number) => Number(n.toFixed(2));
const orderNumber = () => `MK-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const transitions: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED'],
  CANCELLED: [],
  RETURN_REQUESTED: ['RETURN_APPROVED', 'RETURN_REJECTED'],
  RETURN_APPROVED: ['RETURNED'],
  RETURN_REJECTED: [],
  RETURNED: [],
};
const paymentTransitions: Record<string, string[]> = {
  PENDING: ['UNPAID', 'PAID', 'FAILED'],
  UNPAID: ['PAID'],
  PAID: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  FAILED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ['REFUNDED'],
};

async function couponFor(customer: string, code: string | undefined, subtotal: number) {
  if (!code) return { discount: 0, snapshot: undefined, coupon: undefined };
  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
  const now = new Date();
  if (
    !coupon ||
    !coupon.enabled ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.expiresAt && coupon.expiresAt <= now) ||
    (coupon.usageLimit !== undefined && coupon.usageCount >= coupon.usageLimit)
  )
    throw new OrderError('COUPON_UNAVAILABLE', 'Coupon is not available.');
  if (subtotal < (coupon.minimumOrderAmount || 0)) throw new OrderError('COUPON_MINIMUM_NOT_MET', 'Cart does not meet the coupon minimum.');
  const redeemed = await CouponRedemption.countDocuments({ coupon: coupon._id, customer });
  if (coupon.perCustomerLimit !== undefined && redeemed >= coupon.perCustomerLimit)
    throw new OrderError('COUPON_CUSTOMER_LIMIT', 'Coupon customer limit has been reached.');
  let discount = coupon.type === 'PERCENTAGE' ? subtotal * (coupon.value / 100) : coupon.value;
  if (coupon.maximumDiscount !== undefined) discount = Math.min(discount, coupon.maximumDiscount);
  discount = money(Math.min(discount, subtotal));
  return { coupon, discount, snapshot: { couponId: coupon._id, code: coupon.code, type: coupon.type, value: coupon.value, actualDiscount: discount } };
}

export async function checkout(
  customer: string,
  input: { addressId: string; couponCode?: string; idempotencyKey: string; paymentMethod: 'CASH_ON_DELIVERY' },
  requestId?: string
) {
  const existing = await Order.findOne({ customer, idempotencyKey: input.idempotencyKey }).lean();
  if (existing) return existing;
  const [cart, address, storeConfig] = await Promise.all([
    Cart.findOne({ user: customer }).lean(),
    Address.findOne({ _id: input.addressId, user: customer }).lean(),
    getStoreConfiguration(),
  ]);
  if (!address) throw new OrderError('ADDRESS_NOT_FOUND', 'Address not found.');
  if (!cart?.items?.length) throw new OrderError('CART_EMPTY', 'Cart is empty.');
  // Cash on delivery is the only payment method MansooriKart offers, so an operator who
  // switches it off is deliberately closing checkout. Enabled by default, which is the
  // behaviour every existing order was placed under.
  if (!isCashOnDeliveryAllowed(storeConfig)) throw new OrderError('PAYMENT_METHOD_UNAVAILABLE', 'Cash on delivery is currently unavailable.');
  const ids = cart.items.map((i: any) => i.product);
  const products = await Product.find({ _id: { $in: ids }, status: 'ACTIVE' }).lean();
  const byId = new Map<string, any>(products.map((p: any) => [String(p._id), p]));
  // Dropship lines are backed by a supplier source, not by warehouse stock, so the
  // governing source is resolved once for the whole cart and snapshotted per line.
  const dropshipIds = products.filter((p: any) => p.fulfillmentType === 'DROPSHIP').map((p: any) => p._id);
  const sources = dropshipIds.length
    ? await SupplierCatalogItem.find({ product: { $in: dropshipIds }, isActive: true })
        .select('product supplier supplierSku supplierCost supplierAvailability createdAt')
        .lean()
    : [];
  const sourcesByProduct = new Map<string, any[]>();
  for (const source of sources) {
    const key = String((source as any).product);
    const list = sourcesByProduct.get(key);
    if (list) list.push(source);
    else sourcesByProduct.set(key, [source]);
  }
  const items = cart.items.map((entry: any) => {
    const product: any = byId.get(String(entry.product));
    if (!product || entry.quantity < 1) throw new OrderError('STOCK_UNAVAILABLE', 'A cart item is unavailable.');
    const fulfillmentType = product.fulfillmentType === 'DROPSHIP' ? 'DROPSHIP' : 'OWN_STOCK';
    const candidates = sourcesByProduct.get(String(product._id)) ?? [];
    const source = fulfillmentType === 'DROPSHIP' && candidates.length ? preferredSupplierSource(candidates) : undefined;
    // Own stock is still governed by the warehouse balance mirrored on the product;
    // that check and its InventoryMovement trail are untouched by dropshipping (§39).
    if (fulfillmentType === 'OWN_STOCK') {
      if (entry.quantity > product.stock) throw new OrderError('STOCK_UNAVAILABLE', 'A cart item is unavailable.');
    } else {
      // A dropship line needs somebody to ship it, and an explicit OUT_OF_STOCK feed
      // blocks. UNKNOWN or stale-but-positive stock does not: a CSV feed that reports
      // no quantity is not evidence of absence (§24, §29).
      if (!source) throw new OrderError('DROPSHIP_UNAVAILABLE', 'A cart item has no active supplier source.');
      if (BLOCKING_SUPPLIER_AVAILABILITY.includes(String(source.supplierAvailability ?? 'UNKNOWN')))
        throw new OrderError('DROPSHIP_UNAVAILABLE', 'A cart item is out of stock at the supplier.');
    }
    // Server-derived cost snapshot on the LATEST_PURCHASE_COST basis: supplier cost for
    // a dropship line, `Product.costPrice` for own stock. Frozen at creation so a later
    // cost or supplier change cannot rewrite historical profit (§31). Both feed the one
    // existing COGS mechanism — `lineCost` — rather than a second profit formula (§57).
    // A line with no recorded cost stores no snapshot at all rather than a zero, so
    // finance reports cost coverage honestly instead of implying the goods were free.
    const supplierCost = source && typeof source.supplierCost === 'number' && source.supplierCost >= 0 ? money(source.supplierCost) : undefined;
    const ownCost = typeof product.costPrice === 'number' && product.costPrice >= 0 ? money(product.costPrice) : undefined;
    const unitCost = fulfillmentType === 'DROPSHIP' ? supplierCost : ownCost;
    return {
      productId: product._id,
      name: product.name,
      sku: product.sku,
      image: product.image,
      unitPrice: product.price,
      quantity: entry.quantity,
      lineSubtotal: money(product.price * entry.quantity),
      fulfillmentType,
      ...(source ? { supplier: source.supplier, supplierSku: source.supplierSku ?? undefined, ...(supplierCost === undefined ? {} : { supplierCost }) } : {}),
      ...(unitCost === undefined ? {} : { unitCost, lineCost: money(unitCost * entry.quantity) }),
    };
  });
  const subtotal = money(items.reduce((sum: number, item: any) => sum + item.lineSubtotal, 0));
  const couponInfo = await couponFor(customer, input.couponCode, subtotal);
  // Shipping and tax come from the one store-configuration authority, evaluated against
  // server-derived values only: the discounted subtotal the server just computed and the
  // city on the address the server loaded. Nothing the client sent can move either number,
  // and an unconfigured store yields the historical PKR 250 fee waived at PKR 5,000 with
  // zero tax. Both are then frozen onto the order as snapshots (§28, §30, §32).
  const discountedSubtotal = money(Math.max(0, subtotal - couponInfo.discount));
  const shipping = quoteShipping(storeConfig, discountedSubtotal, (address as any).city),
    tax = computeTax(storeConfig, discountedSubtotal),
    total = money(Math.max(0, discountedSubtotal + shipping + tax));
  const deducted: any[] = [];
  let created: any;
  try {
    for (const item of items) {
      // §29: a dropship line never decrements MansooriKart warehouse stock, and never
      // produces an InventoryMovement. The supplier ships from their own shelf.
      if (item.fulfillmentType !== 'OWN_STOCK') continue;
      await adjustStock({
        productId: String(item.productId),
        quantityDelta: -item.quantity,
        reason: 'Order checkout',
        actor: customer,
        requestId,
        type: 'ORDER',
      });
      deducted.push(item);
    }
    const number = orderNumber();
    created = await Order.create({
      customer,
      orderNumber: number,
      invoiceNumber: `INV-${number}`,
      idempotencyKey: input.idempotencyKey,
      items,
      shippingAddress: address,
      subtotal,
      discount: couponInfo.discount,
      shipping,
      tax,
      total,
      coupon: couponInfo.snapshot,
      paymentMethod: input.paymentMethod,
      paymentStatus: 'UNPAID',
      orderStatus: 'PENDING',
      statusHistory: [{ status: 'PENDING', from: null, to: 'PENDING', reason: 'Order created', actor: customer, requestId }],
    });
    if (couponInfo.coupon) {
      await Coupon.updateOne({ _id: couponInfo.coupon._id }, { $inc: { usageCount: 1 } });
      await CouponRedemption.create({ coupon: couponInfo.coupon._id, customer, order: created._id });
    }
    // One fulfillment per supplier, created inside the compensated block so a failure
    // here rolls the whole order back rather than leaving a customer order whose
    // dropship lines nobody was asked to ship (§34).
    const dropshipLines: DropshipLine[] = [];
    items.forEach((item: any, index: number) => {
      if (item.fulfillmentType === 'DROPSHIP') dropshipLines.push({ index, supplier: String(item.supplier ?? '') });
    });
    if (dropshipLines.length) await createFulfillments(created, dropshipLines, customer, requestId);
    await AuditLog.create({
      actor: customer,
      action: 'ORDER_CREATED',
      resourceType: 'Order',
      resourceId: String(created._id),
      requestId,
      metadata: { orderNumber: created.orderNumber, total },
    });
    await Cart.updateOne({ user: customer }, { $set: { items: [] } });
    // Delivery is deliberately post-commit: a provider failure cannot invalidate a paid business operation.
    void sendOrderConfirmation(created.toObject()).catch(() => undefined);
    return created.toObject();
  } catch (error: any) {
    if (created) {
      await Order.deleteOne({ _id: created._id });
      await CouponRedemption.deleteOne({ order: created._id });
      // Supplier obligations must not outlive the order they belonged to.
      await removeFulfillmentsForOrder(created._id).catch(() => undefined);
      if (couponInfo.coupon) await Coupon.updateOne({ _id: couponInfo.coupon._id, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
    }
    for (const item of deducted.reverse())
      await adjustStock({
        productId: String(item.productId),
        quantityDelta: item.quantity,
        reason: 'Checkout compensation',
        actor: customer,
        requestId,
        type: 'CANCELLATION',
      }).catch(() => undefined);
    if (error?.code === 11000) {
      const replay = await Order.findOne({ customer, idempotencyKey: input.idempotencyKey }).lean();
      if (replay) return replay;
    }
    if (error instanceof OrderError) throw error;
    if (error instanceof InventoryError) throw new OrderError('STOCK_UNAVAILABLE', 'A cart item is unavailable.');
    if (error instanceof DropshipError) throw new OrderError('DROPSHIP_UNAVAILABLE', 'A dropship item could not be routed to a supplier.');
    throw new OrderError('CHECKOUT_FAILED', 'Checkout could not be completed.');
  }
}

export async function cancelOrder(customer: string, id: string, requestId?: string, actor = customer, byAdmin = false) {
  const scope: Record<string, unknown> = byAdmin ? { _id: id } : { _id: id, customer };
  // Atomically claim the cancellation. Only one concurrent caller (customer or admin) can move an
  // eligible order to CANCELLED, so the inventory restore below runs exactly once per order.
  const claimed = await Order.findOneAndUpdate(
    { ...scope, orderStatus: { $in: ['PENDING', 'CONFIRMED'] } },
    [
      {
        $set: {
          orderStatus: 'CANCELLED',
          statusHistory: {
            $concatArrays: [
              { $ifNull: ['$statusHistory', []] },
              [
                {
                  status: 'CANCELLED',
                  from: '$orderStatus',
                  to: 'CANCELLED',
                  reason: byAdmin ? 'Admin cancellation' : 'Customer cancellation',
                  actor: new Types.ObjectId(actor),
                  requestId: requestId ?? null,
                  at: '$$NOW',
                },
              ],
            ],
          },
        },
      },
    ],
    { new: true }
  );
  if (!claimed) {
    const exists = await Order.findOne(scope).select('_id').lean();
    throw exists ? new OrderError('ORDER_NOT_CANCELLABLE', 'Order cannot be cancelled.') : new OrderError('ORDER_NOT_FOUND', 'Order not found.');
  }
  for (const item of claimed.items) {
    // Only owned stock was ever deducted, so only owned stock is restored. A dropship
    // line has no warehouse balance to give back (§29, §39).
    if ((item.fulfillmentType ?? 'OWN_STOCK') !== 'OWN_STOCK') continue;
    await adjustStock({
      productId: String(item.productId),
      quantityDelta: item.quantity,
      reason: 'Order cancellation',
      actor,
      requestId,
      type: 'CANCELLATION',
      referenceType: 'Order',
      referenceId: String(claimed._id),
    });
  }
  // Withdraw the supplier obligations too. This records MansooriKart's intent and the
  // supplier-contact caveat; it does not claim the supplier cancelled anything (§37).
  const cancelledFulfillments = await cancelFulfillmentsForOrder(
    String(claimed._id),
    actor,
    byAdmin ? 'Order cancelled by admin' : 'Order cancelled by customer',
    requestId
  );
  await AuditLog.create({
    actor,
    action: byAdmin ? 'ORDER_ADMIN_CANCELLED' : 'ORDER_CANCELLED',
    resourceType: 'Order',
    resourceId: String(claimed._id),
    requestId,
    metadata: { cancelledFulfillments },
  });
  return claimed;
}

export async function updateOrderStatus(id: string, nextStatus: string, actor: string, reason: string, requestId?: string) {
  const order = await Order.findById(id);
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found.');
  const from = order.orderStatus;
  if (!(transitions[from] || []).includes(nextStatus)) throw new OrderError('ORDER_TRANSITION_INVALID', 'Order transition is invalid.');
  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, from, to: nextStatus, reason, actor, requestId });
  await order.save();
  await AuditLog.create({
    actor,
    action: 'ORDER_STATUS_UPDATED',
    resourceType: 'Order',
    resourceId: String(order._id),
    requestId,
    metadata: { from, to: nextStatus, reason },
  });
  return order;
}

export async function updatePaymentStatus(id: string, nextStatus: string, actor: string, reason: string, requestId?: string) {
  const order = await Order.findById(id);
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found.');
  if (!(paymentTransitions[order.paymentStatus] || []).includes(nextStatus))
    throw new OrderError('PAYMENT_TRANSITION_INVALID', 'Payment transition is invalid.');
  const from = order.paymentStatus;
  order.paymentStatus = nextStatus;
  await order.save();
  await AuditLog.create({
    actor,
    action: 'ORDER_PAYMENT_UPDATED',
    resourceType: 'Order',
    resourceId: String(order._id),
    requestId,
    metadata: { from, to: nextStatus, reason },
  });
  return order;
}

const sequence = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const returnTransitions: Record<string, string[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['RECEIVED'],
  REJECTED: [],
  RECEIVED: ['COMPLETED'],
  COMPLETED: [],
};

export async function requestReturn(
  customer: string,
  orderId: string,
  input: { items: { productId: string; quantity: number }[]; reason: string },
  requestId?: string
) {
  const order = await Order.findOne({ _id: orderId, customer }).lean();
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found.');
  if (order.orderStatus !== 'DELIVERED') throw new OrderError('RETURN_NOT_ELIGIBLE', 'Only delivered orders may be returned.');
  const totals = new Map<string, number>();
  for (const line of input.items) totals.set(line.productId, (totals.get(line.productId) || 0) + line.quantity);
  if (totals.size !== input.items.length) throw new OrderError('RETURN_ITEMS_DUPLICATE', 'Return items must be unique.');
  const reserved: { productId: string; quantity: number }[] = [];
  for (const [productId, quantity] of totals) {
    const ordered = order.items.find((item: any) => String(item.productId) === productId)?.quantity || 0;
    if (!ordered || quantity > ordered) throw new OrderError('RETURN_QUANTITY_INVALID', 'Return quantity exceeds purchased quantity.');
    const filter = { order: orderId, product: productId, requestedQuantity: { $lte: ordered - quantity } };
    let allocation: any;
    try {
      allocation = await ReturnAllocation.findOneAndUpdate(
        filter,
        { $setOnInsert: { orderedQuantity: ordered }, $inc: { requestedQuantity: quantity } },
        { new: true, upsert: true }
      );
    } catch (error: any) {
      if (error?.code === 11000) allocation = await ReturnAllocation.findOneAndUpdate(filter, { $inc: { requestedQuantity: quantity } }, { new: true });
      else throw error;
    }
    if (!allocation) {
      for (const item of reserved)
        await ReturnAllocation.updateOne(
          { order: orderId, product: item.productId, requestedQuantity: { $gte: item.quantity } },
          { $inc: { requestedQuantity: -item.quantity } }
        );
      throw new OrderError('RETURN_QUANTITY_INVALID', 'Return quantity exceeds purchased quantity.');
    }
    reserved.push({ productId, quantity });
  }
  let record: any;
  try {
    record = await ReturnRequest.create({
      returnNumber: sequence('RET'),
      order: orderId,
      customer,
      items: input.items,
      reason: input.reason,
      history: [{ from: null, to: 'REQUESTED', reason: input.reason, actor: customer, requestId }],
    });
  } catch (error) {
    for (const item of reserved)
      await ReturnAllocation.updateOne(
        { order: orderId, product: item.productId, requestedQuantity: { $gte: item.quantity } },
        { $inc: { requestedQuantity: -item.quantity } }
      );
    throw error;
  }
  await AuditLog.create({
    actor: customer,
    action: 'RETURN_REQUESTED',
    resourceType: 'Return',
    resourceId: String(record._id),
    requestId,
    metadata: { orderId },
  });
  return record;
}

export async function updateReturnStatus(id: string, status: string, actor: string, reason: string, requestId?: string) {
  const record = await ReturnRequest.findById(id);
  if (!record) throw new OrderError('RETURN_NOT_FOUND', 'Return not found.');
  const from = record.status;
  if (!(returnTransitions[from] || []).includes(status)) throw new OrderError('RETURN_TRANSITION_INVALID', 'Return transition is invalid.');
  record.status = status;
  record.history.push({ from, to: status, reason, actor, requestId });
  if (['APPROVED', 'REJECTED'].includes(status)) Object.assign(record, { reviewedAt: new Date(), reviewedBy: actor, resolution: reason });
  await record.save();
  if (status === 'REJECTED')
    for (const item of record.items)
      await ReturnAllocation.updateOne(
        { order: record.order, product: item.productId, requestedQuantity: { $gte: item.quantity } },
        { $inc: { requestedQuantity: -item.quantity } }
      );
  await AuditLog.create({
    actor,
    action: 'RETURN_STATUS_UPDATED',
    resourceType: 'Return',
    resourceId: String(record._id),
    requestId,
    metadata: { from, to: status },
  });
  return record;
}

export async function createRefund(
  orderId: string,
  actor: string,
  input: { amount: number; reason: string; idempotencyKey: string; returnId?: string },
  requestId?: string
) {
  const replay = await Refund.findOne({ order: orderId, idempotencyKey: input.idempotencyKey }).lean();
  if (replay) return replay;
  const order = await Order.findById(orderId).lean();
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found.');
  const amount = money(input.amount);
  // Atomically reserve refundable headroom against the persisted accumulator. Two concurrent
  // refunds can never push the non-FAILED refunded total past the order total.
  const reserved = await Order.findOneAndUpdate(
    { _id: order._id, $expr: { $lte: [{ $add: [{ $ifNull: ['$refundedTotal', 0] }, amount] }, '$total'] } },
    { $inc: { refundedTotal: amount } },
    { new: true }
  );
  if (!reserved) throw new OrderError('REFUND_AMOUNT_INVALID', 'Refund exceeds remaining refundable amount.');
  try {
    const refund = await Refund.create({
      refundNumber: sequence('RFD'),
      order: orderId,
      returnRequest: input.returnId || null,
      amount,
      currency: order.currency,
      reason: input.reason,
      paymentMethod: order.paymentMethod,
      processedBy: actor,
      idempotencyKey: input.idempotencyKey,
    });
    await AuditLog.create({
      actor,
      action: 'REFUND_CREATED',
      resourceType: 'Refund',
      resourceId: String(refund._id),
      requestId,
      metadata: { orderId, amount },
    });
    return refund;
  } catch (error: any) {
    // Release the reservation so a failed or duplicate attempt never consumes refundable headroom.
    await Order.updateOne({ _id: order._id }, { $inc: { refundedTotal: -amount } });
    if (error?.code === 11000) {
      const existing = await Refund.findOne({ order: orderId, idempotencyKey: input.idempotencyKey }).lean();
      if (existing) return existing;
    }
    throw error;
  }
}
const refundTransitions: Record<string, string[]> = { PENDING: ['APPROVED', 'FAILED'], APPROVED: ['COMPLETED', 'FAILED'], COMPLETED: [], FAILED: [] };
export async function updateRefundStatus(id: string, status: string, actor: string, requestId?: string) {
  const refund = await Refund.findById(id);
  if (!refund) throw new OrderError('REFUND_NOT_FOUND', 'Refund not found.');
  if (!(refundTransitions[refund.status] || []).includes(status)) throw new OrderError('REFUND_TRANSITION_INVALID', 'Refund transition is invalid.');
  const from = refund.status;
  refund.status = status;
  await refund.save();
  // A FAILED refund no longer consumes refundable headroom, matching the non-FAILED accounting
  // used by the sales dashboard.
  if (status === 'FAILED') await Order.updateOne({ _id: refund.order }, { $inc: { refundedTotal: -refund.amount } });
  await AuditLog.create({
    actor,
    action: 'REFUND_STATUS_UPDATED',
    resourceType: 'Refund',
    resourceId: String(refund._id),
    requestId,
    metadata: { from, to: status },
  });
  return refund;
}
export { transitions, paymentTransitions };
