import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { AuditLog } from '../models/auditLog.js';
import { Expense } from '../models/expense.js';
import { GoodsReceipt } from '../models/goodsReceipt.js';
import { Order } from '../models/order.js';
import { PurchaseOrder } from '../models/purchaseOrder.js';
import { Refund } from '../models/refund.js';
import { Supplier } from '../models/supplier.js';

export class FinanceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export const money = (value: number) => Number((value ?? 0).toFixed(2));
const sequence = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/* -------------------------------------------------------------------------- */
/* Shared date range                                                           */
/* -------------------------------------------------------------------------- */

/** Longest window any finance or report endpoint will aggregate in one request. */
export const MAX_RANGE_DAYS = 366;
const DAY = 86_400_000;

export type Range = { from: Date; to: Date; days: number };

/**
 * Single date-range resolver for every finance and report endpoint. Accepts
 * either a named range or an explicit `from`/`to` pair, rejects reversed or
 * unparseable bounds, and refuses windows longer than `MAX_RANGE_DAYS` so no
 * request can ask the database for an unbounded scan.
 */
export function resolveRange(input: { range?: string | undefined; from?: Date | undefined; to?: Date | undefined }): Range {
  if (input.range && (input.from || input.to)) throw new FinanceError('RANGE_INVALID', 'Use either a named range or an explicit from/to pair, not both.');
  if (Boolean(input.from) !== Boolean(input.to)) throw new FinanceError('RANGE_INVALID', 'Both from and to are required when using an explicit range.');
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.getTime() - (input.range ? Number(input.range.slice(0, -1)) : 30) * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new FinanceError('RANGE_INVALID', 'The reporting range contains an invalid date.');
  if (from.getTime() > to.getTime()) throw new FinanceError('RANGE_INVALID', 'The reporting range must start on or before it ends.');
  const days = Math.ceil((to.getTime() - from.getTime()) / DAY);
  if (days > MAX_RANGE_DAYS) throw new FinanceError('RANGE_TOO_LARGE', `The reporting range may not exceed ${MAX_RANGE_DAYS} days.`);
  return { from, to, days };
}

/* -------------------------------------------------------------------------- */
/* Canonical revenue semantics                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The one definition of realized revenue in the system, reused verbatim from the
 * Phase D sales dashboard: an order is revenue only once it has been delivered
 * *and* its cash has been collected. Unpaid COD and cancelled orders therefore
 * never contribute, no matter how far the order travelled.
 */
export const REALIZED_ORDER = {
  orderStatus: { $in: ['DELIVERED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED'] },
  paymentStatus: { $in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
};
export const REALIZED_EXPRESSION = {
  $and: [{ $in: ['$orderStatus', REALIZED_ORDER.orderStatus.$in] }, { $in: ['$paymentStatus', REALIZED_ORDER.paymentStatus.$in] }],
};

/** Refund value counts unless the refund itself failed, matching the sales dashboard. */
export const COUNTED_REFUND = { status: { $ne: 'FAILED' } } as const;

/** Only APPROVED expenses are realized. DRAFT and VOIDED records are never totalled. */
export const REALIZED_EXPENSE = { status: 'APPROVED' } as const;

const orderWindow = (range: Range) => ({ createdAt: { $gte: range.from, $lte: range.to } });
export const realizedOrderMatch = (range: Range) => ({ ...orderWindow(range), ...REALIZED_ORDER });
export const refundMatch = (range: Range) => ({ createdAt: { $gte: range.from, $lte: range.to }, ...COUNTED_REFUND });
export const expenseMatch = (range: Range) => ({ expenseDate: { $gte: range.from, $lte: range.to }, ...REALIZED_EXPENSE });

export type FinanceTotals = {
  orders: number;
  realizedOrders: number;
  cancelledOrders: number;
  grossSales: number;
  realizedRevenue: number;
  refunds: number;
  netSales: number;
  netRealizedRevenue: number;
  taxCollected: number;
  shippingCharged: number;
  discountsGiven: number;
  costOfGoodsSold: number;
  grossProfit: number;
  grossMargin: number | null;
  operatingExpenses: number;
  operatingExpenseTax: number;
  operatingProfit: number;
  operatingMargin: number | null;
  averageOrderValue: number;
  cogs: { linesTotal: number; linesWithCostSnapshot: number; coverage: number | null; complete: boolean };
};

/**
 * Computes every headline finance figure for a window with real aggregation and
 * nothing else. Each endpoint that reports money calls this function, so the
 * sales dashboard, finance dashboard, profit-and-loss statement and the report
 * family cannot drift apart: there is exactly one formula per figure.
 *
 * Deliberate limitations, documented rather than hidden:
 *  - Refunds reduce revenue but do not reverse the cost of the returned goods,
 *    so gross profit is conservative when refunds are large.
 *  - Cost of goods sold uses the immutable per-line cost snapshot persisted at
 *    checkout. Orders created before snapshots existed contribute revenue but no
 *    cost, which is why `cogs.coverage` and `cogs.complete` are reported.
 */
export async function computeFinance(range: Range): Promise<FinanceTotals> {
  const window = orderWindow(range);
  const [all, realized, cancelled, refunds, expenses, cost] = await Promise.all([
    Order.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          gross: { $sum: '$total' },
          discount: { $sum: { $ifNull: ['$discount', 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: realizedOrderMatch(range) },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          value: { $sum: '$total' },
          tax: { $sum: { $ifNull: ['$tax', 0] } },
          shipping: { $sum: { $ifNull: ['$shipping', 0] } },
        },
      },
    ]),
    Order.countDocuments({ ...window, orderStatus: 'CANCELLED' }),
    Refund.aggregate([{ $match: refundMatch(range) }, { $group: { _id: null, value: { $sum: '$amount' } } }]),
    Expense.aggregate([
      { $match: expenseMatch(range) },
      { $group: { _id: null, net: { $sum: '$amount' }, tax: { $sum: { $ifNull: ['$taxAmount', 0] } }, total: { $sum: '$totalAmount' } } },
    ]),
    // Cost of goods sold is measured on realized orders only, from the snapshot
    // persisted on each order line. Product cost changes later cannot move it.
    Order.aggregate([
      { $match: realizedOrderMatch(range) },
      { $unwind: '$items' },
      {
        $group: {
          _id: null,
          cost: { $sum: { $ifNull: ['$items.lineCost', 0] } },
          lines: { $sum: 1 },
          withSnapshot: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$items.lineCost', null] }, null] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const orders = all[0]?.count ?? 0;
  const grossSales = money(all[0]?.gross ?? 0);
  const realizedRevenue = money(realized[0]?.value ?? 0);
  const refundTotal = money(refunds[0]?.value ?? 0);
  const costOfGoodsSold = money(cost[0]?.cost ?? 0);
  const operatingExpenses = money(expenses[0]?.total ?? 0);
  const netRealizedRevenue = money(realizedRevenue - refundTotal);
  const grossProfit = money(netRealizedRevenue - costOfGoodsSold);
  const operatingProfit = money(grossProfit - operatingExpenses);
  const lines = cost[0]?.lines ?? 0;
  const withSnapshot = cost[0]?.withSnapshot ?? 0;

  return {
    orders,
    realizedOrders: realized[0]?.count ?? 0,
    cancelledOrders: cancelled,
    grossSales,
    realizedRevenue,
    refunds: refundTotal,
    netSales: money(grossSales - refundTotal),
    netRealizedRevenue,
    taxCollected: money(realized[0]?.tax ?? 0),
    shippingCharged: money(realized[0]?.shipping ?? 0),
    discountsGiven: money(all[0]?.discount ?? 0),
    costOfGoodsSold,
    grossProfit,
    grossMargin: netRealizedRevenue > 0 ? money((grossProfit / netRealizedRevenue) * 100) : null,
    operatingExpenses,
    operatingExpenseTax: money(expenses[0]?.tax ?? 0),
    operatingProfit,
    operatingMargin: netRealizedRevenue > 0 ? money((operatingProfit / netRealizedRevenue) * 100) : null,
    averageOrderValue: orders ? money(grossSales / orders) : 0,
    cogs: {
      linesTotal: lines,
      linesWithCostSnapshot: withSnapshot,
      coverage: lines ? money((withSnapshot / lines) * 100) : null,
      complete: lines === withSnapshot,
    },
  };
}

/** Per-day revenue series using exactly the totals defined above. */
export async function revenueByDate(range: Range) {
  const rows = await Order.aggregate([
    { $match: orderWindow(range) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        grossSales: { $sum: '$total' },
        realizedRevenue: {
          $sum: {
            $cond: [REALIZED_EXPRESSION, '$total', 0],
          },
        },
        costOfGoodsSold: {
          $sum: {
            $cond: [REALIZED_EXPRESSION, { $sum: { $map: { input: { $ifNull: ['$items', []] }, as: 'i', in: { $ifNull: ['$$i.lineCost', 0] } } } }, 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row: any) => ({
    date: row._id,
    orders: row.orders,
    grossSales: money(row.grossSales),
    realizedRevenue: money(row.realizedRevenue),
    costOfGoodsSold: money(row.costOfGoodsSold),
    grossProfit: money(row.realizedRevenue - row.costOfGoodsSold),
  }));
}

/** Per-day refund series, using the same non-FAILED refund rule. */
export async function refundsByDate(range: Range) {
  const rows = await Refund.aggregate([
    { $match: refundMatch(range) },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, value: { $sum: '$amount' } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row: any) => ({ date: row._id, refunds: row.count, value: money(row.value) }));
}

/** Realized operating expenses grouped by category. */
export async function expensesByCategory(range: Range) {
  const rows = await Expense.aggregate([
    { $match: expenseMatch(range) },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        net: { $sum: '$amount' },
        tax: { $sum: { $ifNull: ['$taxAmount', 0] } },
        total: { $sum: '$totalAmount' },
      },
    },
    { $sort: { total: -1, _id: 1 } },
  ]);
  return rows.map((row: any) => ({ category: row._id, count: row.count, amount: money(row.net), taxAmount: money(row.tax), totalAmount: money(row.total) }));
}

/** Per-day realized operating expenses, keyed on `expenseDate` rather than creation time. */
export async function expensesByDate(range: Range) {
  const rows = await Expense.aggregate([
    { $match: expenseMatch(range) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$expenseDate' } },
        count: { $sum: 1 },
        net: { $sum: '$amount' },
        tax: { $sum: { $ifNull: ['$taxAmount', 0] } },
        total: { $sum: '$totalAmount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row: any) => ({ date: row._id, expenses: row.count, amount: money(row.net), taxAmount: money(row.tax), totalAmount: money(row.total) }));
}

/**
 * Per-day tax recorded on realized orders. This is the tax the checkout actually
 * wrote onto the order, not a computed liability: MansooriKart has no tax engine,
 * no jurisdiction resolution and no filing automation.
 */
export async function taxByDate(range: Range) {
  const rows = await Order.aggregate([
    { $match: realizedOrderMatch(range) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        taxCollected: { $sum: { $ifNull: ['$tax', 0] } },
        taxableRevenue: { $sum: '$total' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row: any) => ({ date: row._id, orders: row.orders, taxCollected: money(row.taxCollected), taxableRevenue: money(row.taxableRevenue) }));
}

/**
 * Refund value split by lifecycle status. The existing Refund collection is the
 * only refund authority in the system; Phase F adds no parallel finance-refund
 * store. `counted` is the subset that reduces revenue: everything except FAILED,
 * exactly as the Phase D sales dashboard defines it.
 */
export async function refundsByStatus(range: Range) {
  const rows = await Refund.aggregate([
    { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
    { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } },
  ]);
  const read = (status: string) => {
    const row = rows.find((entry: any) => entry._id === status);
    return { count: row?.count ?? 0, amount: money(row?.value ?? 0) };
  };
  const pending = read('PENDING');
  const approved = read('APPROVED');
  const completed = read('COMPLETED');
  const failed = read('FAILED');
  return {
    pending,
    approved,
    completed,
    failed,
    counted: {
      count: pending.count + approved.count + completed.count,
      amount: money(pending.amount + approved.amount + completed.amount),
    },
    basis: 'ALL_REFUNDS_EXCEPT_FAILED_REDUCE_REVENUE',
  };
}

/**
 * Order payment posture for the window. COD is the only usable payment method at
 * launch, so `unpaidCollectable` is the operational figure that matters: value
 * that has been delivered or shipped but whose cash has not been confirmed. It is
 * never counted as revenue, and delivery alone never marks an order PAID — a Super
 * Admin must confirm collection through the existing order payment-status route.
 */
export async function orderPaymentPosture(range: Range) {
  const window = orderWindow(range);
  const [byPayment, unpaidDelivered, paid] = await Promise.all([
    Order.aggregate([{ $match: window }, { $group: { _id: '$paymentStatus', count: { $sum: 1 }, value: { $sum: '$total' } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([
      { $match: { ...window, paymentStatus: { $nin: REALIZED_ORDER.paymentStatus.$in }, orderStatus: { $in: ['SHIPPED', 'DELIVERED'] } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Order.aggregate([
      { $match: { ...window, paymentStatus: REALIZED_ORDER.paymentStatus } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
  ]);
  const unpaid = byPayment.filter((row: any) => row._id !== 'PAID');
  return {
    byPaymentStatus: byPayment.map((row: any) => ({ paymentStatus: row._id ?? 'UNKNOWN', orders: row.count, value: money(row.value) })),
    paidOrders: { count: paid[0]?.count ?? 0, value: money(paid[0]?.value ?? 0) },
    unpaidOrders: {
      count: unpaid.reduce((sum: number, row: any) => sum + row.count, 0),
      value: money(unpaid.reduce((sum: number, row: any) => sum + row.value, 0)),
    },
    unpaidCollectable: { count: unpaidDelivered[0]?.count ?? 0, value: money(unpaidDelivered[0]?.value ?? 0) },
    note: 'Unpaid orders are never realized revenue. Delivery alone does not confirm collection.',
  };
}

/**
 * Purchasing money, deliberately kept out of the profit-and-loss figures.
 *
 * `orderedValue` is a commercial *commitment* on live purchase orders, and
 * `receivedValue` is the cost of goods physically accepted into stock. Neither is
 * an operating expense: goods bought become cost of goods sold only when the
 * matching stock is actually sold, and only an APPROVED Expense record is ever
 * treated as a realized expense. `outstandingValue` is therefore committed money
 * not yet received, not a payable balance — MansooriKart has no accounts-payable
 * ledger and no aging.
 */
export async function purchaseFinance(range: Range) {
  const window = { createdAt: { $gte: range.from, $lte: range.to } };
  const LIVE = ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'];
  const [byStatus, outstanding, received] = await Promise.all([
    PurchaseOrder.aggregate([{ $match: window }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } }, { $sort: { _id: 1 } }]),
    PurchaseOrder.aggregate([
      { $match: { ...window, status: { $in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: null,
          quantity: { $sum: { $max: [0, { $subtract: ['$items.quantityOrdered', { $ifNull: ['$items.quantityAccepted', 0] }] }] } },
          value: {
            $sum: {
              $multiply: [{ $max: [0, { $subtract: ['$items.quantityOrdered', { $ifNull: ['$items.quantityAccepted', 0] }] }] }, '$items.unitCost'],
            },
          },
        },
      },
    ]),
    GoodsReceipt.aggregate([
      { $match: { receivedAt: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, receipts: { $sum: 1 }, units: { $sum: '$totalAccepted' }, value: { $sum: '$acceptedValue' } } },
    ]),
  ]);
  const live = byStatus.filter((row: any) => LIVE.includes(row._id));
  return {
    purchaseOrders: byStatus.map((row: any) => ({ status: row._id, count: row.count, value: money(row.value) })),
    orderedValue: money(live.reduce((sum: number, row: any) => sum + row.value, 0)),
    orderedCount: live.reduce((sum: number, row: any) => sum + row.count, 0),
    receivedValue: money(received[0]?.value ?? 0),
    receivedUnits: received[0]?.units ?? 0,
    receiptCount: received[0]?.receipts ?? 0,
    outstandingQuantity: outstanding[0]?.quantity ?? 0,
    outstandingValue: money(outstanding[0]?.value ?? 0),
    basis: 'PURCHASE_COMMITMENT_NOT_OPERATING_EXPENSE',
    note: 'Ordered and received purchase value are procurement facts. Neither is an operating expense and neither appears in operating profit; only APPROVED Expense records do.',
  };
}

/** The window of equal length immediately preceding `range`, for bounded period-over-period comparison. */
export function previousRange(range: Range): Range {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span - 1), to: new Date(range.from.getTime() - 1), days: range.days };
}

/** Signed percentage change, or `null` when the base period had nothing to compare against. */
export const changePercent = (current: number, previous: number) => (previous === 0 ? null : money(((current - previous) / Math.abs(previous)) * 100));

/* -------------------------------------------------------------------------- */
/* Expense lifecycle                                                           */
/* -------------------------------------------------------------------------- */

export type ExpenseInput = {
  category: string;
  description: string;
  amount: number;
  taxAmount?: number | undefined;
  expenseDate: Date;
  paymentMethod?: string | undefined;
  supplier?: string | undefined;
  purchaseOrder?: string | undefined;
  reference?: string | undefined;
  notes?: string | undefined;
};

const auditExpense = (actor: string, action: string, id: string, requestId: string | undefined, metadata: Record<string, unknown>) =>
  AuditLog.create({ actor, action, resourceType: 'Expense', resourceId: id, requestId: requestId ?? null, metadata });

const assertSupplier = async (supplier: string | undefined) => {
  if (!supplier) return null;
  const found = await Supplier.findById(supplier).select('_id').lean();
  if (!found) throw new FinanceError('EXPENSE_SUPPLIER_NOT_FOUND', 'The referenced supplier does not exist.', 404);
  return new Types.ObjectId(supplier);
};

/**
 * Validates an optional purchase-order cross-reference. Linking one does not make
 * the purchase order paid, settled or expensed; it only records that an operator
 * believes the two documents are related.
 */
const assertPurchaseOrder = async (purchaseOrder: string | undefined) => {
  if (!purchaseOrder) return null;
  const found = await PurchaseOrder.findById(purchaseOrder).select('_id').lean();
  if (!found) throw new FinanceError('EXPENSE_PURCHASE_ORDER_NOT_FOUND', 'The referenced purchase order does not exist.', 404);
  return new Types.ObjectId(purchaseOrder);
};

/**
 * Creates a DRAFT expense. Totals, the expense number, the creator and every
 * status timestamp are server-derived; a client can supply only the descriptive
 * fields. An expense is never created already approved.
 */
export async function createExpense(actor: string, input: ExpenseInput, requestId?: string) {
  const [supplier, purchaseOrder] = await Promise.all([assertSupplier(input.supplier), assertPurchaseOrder(input.purchaseOrder)]);
  const amount = money(input.amount);
  const taxAmount = money(input.taxAmount ?? 0);
  const payload = {
    category: input.category,
    description: input.description,
    amount,
    taxAmount,
    totalAmount: money(amount + taxAmount),
    expenseDate: input.expenseDate,
    paymentMethod: input.paymentMethod ?? 'CASH',
    supplier,
    purchaseOrder,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    status: 'DRAFT',
    createdBy: new Types.ObjectId(actor),
    statusHistory: [{ from: null, to: 'DRAFT', reason: 'Expense recorded', actor: new Types.ObjectId(actor), requestId: requestId ?? null }],
  };
  let created: any;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      created = await Expense.create({ ...payload, expenseNumber: sequence('EXP') });
      break;
    } catch (error: any) {
      if (error?.code !== 11000 || !('expenseNumber' in (error?.keyPattern ?? {}))) throw error;
      lastError = error;
    }
  }
  if (!created) throw lastError;
  await auditExpense(actor, 'EXPENSE_CREATED', String(created._id), requestId, {
    expenseNumber: created.expenseNumber,
    category: created.category,
    totalAmount: created.totalAmount,
  });
  return created.toObject();
}

/**
 * Updates a DRAFT expense only. An APPROVED expense is immutable financial
 * history: correcting it means voiding it and recording a replacement, so no
 * approved amount is ever silently rewritten.
 */
export async function updateExpense(actor: string, id: string, input: Partial<ExpenseInput>, requestId?: string) {
  const existing = await Expense.findById(id).lean();
  if (!existing) throw new FinanceError('EXPENSE_NOT_FOUND', 'Expense not found.', 404);
  if (existing.status !== 'DRAFT')
    throw new FinanceError('EXPENSE_NOT_EDITABLE', `A ${existing.status} expense cannot be edited. Void it and record a corrected expense instead.`, 409);
  const supplier = 'supplier' in input ? await assertSupplier(input.supplier) : undefined;
  const purchaseOrder = 'purchaseOrder' in input ? await assertPurchaseOrder(input.purchaseOrder) : undefined;
  const amount = input.amount === undefined ? existing.amount : money(input.amount);
  const taxAmount = input.taxAmount === undefined ? (existing.taxAmount ?? 0) : money(input.taxAmount);
  const set: Record<string, unknown> = { amount, taxAmount, totalAmount: money(amount + taxAmount) };
  for (const field of ['category', 'description', 'expenseDate', 'paymentMethod', 'reference', 'notes'] as const)
    if (input[field] !== undefined) set[field] = input[field];
  if (supplier !== undefined) set['supplier'] = supplier;
  if (purchaseOrder !== undefined) set['purchaseOrder'] = purchaseOrder;
  const updated = await Expense.findOneAndUpdate({ _id: id, status: 'DRAFT' }, { $set: set }, { new: true }).lean();
  if (!updated) throw new FinanceError('EXPENSE_NOT_EDITABLE', 'The expense changed status before the update was applied.', 409);
  await auditExpense(actor, 'EXPENSE_UPDATED', id, requestId, { expenseNumber: updated.expenseNumber, totalAmount: updated.totalAmount });
  return updated;
}

/**
 * Approves a DRAFT expense, which is the point the amount becomes realized and
 * immutable. The conditional update makes the transition atomic, so two
 * concurrent approvals cannot both succeed or write conflicting approvers.
 */
export async function approveExpense(actor: string, id: string, requestId?: string) {
  const existing = await Expense.findById(id).select('_id status expenseNumber totalAmount').lean();
  if (!existing) throw new FinanceError('EXPENSE_NOT_FOUND', 'Expense not found.', 404);
  if (existing.status !== 'DRAFT') throw new FinanceError('EXPENSE_NOT_APPROVABLE', `A ${existing.status} expense cannot be approved.`, 409);
  const approved = await Expense.findOneAndUpdate(
    { _id: id, status: 'DRAFT' },
    {
      $set: { status: 'APPROVED', approvedBy: new Types.ObjectId(actor), approvedAt: new Date() },
      $push: { statusHistory: { from: 'DRAFT', to: 'APPROVED', reason: 'Expense approved', actor: new Types.ObjectId(actor), requestId: requestId ?? null } },
    },
    { new: true }
  ).lean();
  if (!approved) throw new FinanceError('EXPENSE_NOT_APPROVABLE', 'The expense was already approved or voided.', 409);
  await auditExpense(actor, 'EXPENSE_APPROVED', id, requestId, { expenseNumber: approved.expenseNumber, totalAmount: approved.totalAmount });
  return approved;
}

/**
 * Voids an expense instead of deleting it. Financial history is preserved: the
 * record stays queryable, drops out of every realized total, and carries the
 * reason it was reversed.
 */
export async function voidExpense(actor: string, id: string, reason: string, requestId?: string) {
  const existing = await Expense.findById(id).select('_id status expenseNumber totalAmount').lean();
  if (!existing) throw new FinanceError('EXPENSE_NOT_FOUND', 'Expense not found.', 404);
  if (existing.status === 'VOIDED') throw new FinanceError('EXPENSE_ALREADY_VOIDED', 'The expense is already voided.', 409);
  const from = existing.status;
  const voided = await Expense.findOneAndUpdate(
    { _id: id, status: { $ne: 'VOIDED' } },
    {
      $set: { status: 'VOIDED', voidedBy: new Types.ObjectId(actor), voidedAt: new Date(), voidReason: reason },
      $push: { statusHistory: { from, to: 'VOIDED', reason, actor: new Types.ObjectId(actor), requestId: requestId ?? null } },
    },
    { new: true }
  ).lean();
  if (!voided) throw new FinanceError('EXPENSE_ALREADY_VOIDED', 'The expense was voided concurrently.', 409);
  await auditExpense(actor, 'EXPENSE_VOIDED', id, requestId, { expenseNumber: voided.expenseNumber, from, reason });
  return voided;
}

/**
 * The single status-transition entry point. Exactly three transitions exist:
 * `DRAFT → APPROVED`, `DRAFT → VOIDED` and `APPROVED → VOIDED`. There is no path
 * back out of VOIDED and no path back from APPROVED to DRAFT, because reopening an
 * approved amount is what silent history rewriting looks like. Both branches
 * delegate to the atomic conditional updates above, so two concurrent requests can
 * never leave the record in a contradictory state.
 */
export async function changeExpenseStatus(actor: string, id: string, to: 'APPROVED' | 'VOIDED', reason: string | undefined, requestId?: string) {
  if (to === 'APPROVED') return approveExpense(actor, id, requestId);
  if (!reason) throw new FinanceError('EXPENSE_VOID_REASON_REQUIRED', 'A reason is required when voiding an expense.', 400);
  return voidExpense(actor, id, reason, requestId);
}
