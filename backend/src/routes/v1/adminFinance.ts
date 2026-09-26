import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS, Expense } from '../../models/expense.js';
import {
  changeExpenseStatus,
  changePercent,
  computeFinance,
  createExpense,
  expensesByCategory,
  expensesByDate,
  FinanceError,
  MAX_RANGE_DAYS,
  money,
  orderPaymentPosture,
  previousRange,
  purchaseFinance,
  refundsByDate,
  refundsByStatus,
  resolveRange,
  revenueByDate,
  taxByDate,
  updateExpense,
} from '../../services/financeService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

/** Domain failures map to stable codes; anything unknown goes to the shared handler so no driver text or stack escapes. */
const fail = (error: unknown, request: any, response: Response, next: NextFunction) => {
  if (error instanceof FinanceError) return sendFailure(response, error.status, error.code, error.message, request.requestId);
  return next(error);
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Shared range contract for every finance endpoint: a named range, or an explicit
 * `from`/`to` pair. `.strict()` rejects unknown keys, and each value is coerced to
 * a primitive, so a Mongo operator object can never reach a query. The mutual
 * exclusivity of `range` and `from`/`to`, the ordering rule and the maximum window
 * are all enforced by `resolveRange`, which is the single owner of those rules for
 * finance and reports alike, so every violation returns the same code everywhere.
 */
export const rangeQuery = z
  .object({
    range: z.enum(['7d', '30d', '90d', '180d', '365d']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

const rangeMeta = (range: { from: Date; to: Date; days: number }) => ({ from: range.from.toISOString(), to: range.to.toISOString(), days: range.days });

/* -------------------------------------------------------------------------- */
/* Expenses                                                                    */
/* -------------------------------------------------------------------------- */

const serializeExpense = (document: any) => ({
  id: String(document._id),
  expenseNumber: document.expenseNumber,
  category: document.category,
  description: document.description,
  amount: document.amount,
  taxAmount: document.taxAmount ?? 0,
  totalAmount: document.totalAmount,
  currency: document.currency ?? 'PKR',
  expenseDate: document.expenseDate,
  paymentMethod: document.paymentMethod ?? null,
  supplier: document.supplier
    ? typeof document.supplier === 'object' && document.supplier.name
      ? { id: String(document.supplier._id), name: document.supplier.name, code: document.supplier.code ?? null }
      : { id: String(document.supplier), name: null, code: null }
    : null,
  reference: document.reference ?? null,
  notes: document.notes ?? null,
  // A cross-reference only. Linking a purchase order never expenses, settles or
  // pays it: procurement commitments and operating expenses stay separate.
  purchaseOrder: document.purchaseOrder ? String(document.purchaseOrder) : null,
  status: document.status,
  approvedAt: document.approvedAt ?? null,
  voidedAt: document.voidedAt ?? null,
  voidReason: document.voidReason ?? null,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

/**
 * A client may supply only descriptive fields. `expenseNumber`, `totalAmount`,
 * `status`, `createdBy`, `approvedBy`, `approvedAt`, `voidedBy`, `voidedAt`,
 * `statusHistory` and the timestamps are absent from the schema, so `.strict()`
 * rejects any attempt to set them outright.
 */
const expenseFields = {
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(2).max(500),
  amount: z.coerce.number().finite().min(0.01).max(1_000_000_000),
  taxAmount: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  expenseDate: z.coerce.date(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
  supplier: z.string().regex(oid).optional(),
  purchaseOrder: z.string().regex(oid).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
};
const createExpenseBody = z.object(expenseFields).strict();
const updateExpenseBody = z
  .object({
    ...expenseFields,
    category: expenseFields.category.optional(),
    description: expenseFields.description.optional(),
    amount: expenseFields.amount.optional(),
    expenseDate: expenseFields.expenseDate.optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'At least one field must be supplied');

const expenseListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(160).optional(),
    status: z.enum(['DRAFT', 'APPROVED', 'VOIDED']).optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    supplier: z.string().regex(oid).optional(),
    purchaseOrder: z.string().regex(oid).optional(),
    paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    minAmount: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
    maxAmount: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
    sort: z.enum(['expenseDate', 'totalAmount', 'createdAt', 'expenseNumber']).default('expenseDate'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

router.get('/expenses', validate(expenseListQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const query = request.query as z.infer<typeof expenseListQuery>;
    if (query.from && query.to && query.from.getTime() > query.to.getTime())
      return sendFailure(response, 400, 'RANGE_INVALID', 'The reporting range must start on or before it ends.', request.requestId);
    if (query.minAmount !== undefined && query.maxAmount !== undefined && query.minAmount > query.maxAmount)
      return sendFailure(response, 400, 'AMOUNT_RANGE_INVALID', 'minAmount must be less than or equal to maxAmount.', request.requestId);
    const filter: Record<string, unknown> = {};
    if (query.status) filter['status'] = query.status;
    if (query.category) filter['category'] = query.category;
    if (query.supplier) filter['supplier'] = query.supplier;
    if (query.purchaseOrder) filter['purchaseOrder'] = query.purchaseOrder;
    if (query.paymentMethod) filter['paymentMethod'] = query.paymentMethod;
    if (query.from || query.to) filter['expenseDate'] = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    if (query.minAmount !== undefined || query.maxAmount !== undefined)
      filter['totalAmount'] = {
        ...(query.minAmount === undefined ? {} : { $gte: query.minAmount }),
        ...(query.maxAmount === undefined ? {} : { $lte: query.maxAmount }),
      };
    if (query.search) {
      // Escaped, so an operator-looking search value can only ever match literally.
      const pattern = new RegExp(escape(query.search), 'i');
      filter['$or'] = [{ expenseNumber: pattern }, { description: pattern }, { reference: pattern }];
    }
    const [rows, total] = await Promise.all([
      Expense.find(filter)
        .populate('supplier', 'name code')
        .sort({ [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Expense.countDocuments(filter),
    ]);
    return sendSuccess(response, rows.map(serializeExpense), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
});

/** Live totals for the expense list, split by status so DRAFT and VOIDED value is visible but never realized. */
router.get('/expenses/summary', validate(rangeQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const range = resolveRange(request.query as any);
    const [byStatus, categories] = await Promise.all([
      Expense.aggregate([
        { $match: { expenseDate: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$totalAmount' } } },
      ]),
      expensesByCategory(range),
    ]);
    const map = byStatus.reduce((accumulator: Record<string, { count: number; total: number }>, row: any) => {
      accumulator[row._id] = { count: row.count, total: money(row.total) };
      return accumulator;
    }, {});
    return sendSuccess(
      response,
      {
        draft: map['DRAFT'] ?? { count: 0, total: 0 },
        approved: map['APPROVED'] ?? { count: 0, total: 0 },
        voided: map['VOIDED'] ?? { count: 0, total: 0 },
        // Only APPROVED value is realized. DRAFT and VOIDED are reported for
        // visibility and are excluded from every finance total.
        realizedExpenses: map['APPROVED']?.total ?? 0,
        byCategory: categories,
        currency: 'PKR',
        basis: 'APPROVED_EXPENSES_ONLY',
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.get('/expenses/:id', validate(idParam, 'params'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const document = await Expense.findById(request.params.id).populate('supplier', 'name code').lean();
    if (!document) return sendFailure(response, 404, 'EXPENSE_NOT_FOUND', 'Expense not found.', request.requestId);
    return sendSuccess(response, {
      ...serializeExpense(document),
      statusHistory: (document.statusHistory ?? []).map((entry: any) => ({
        from: entry.from ?? null,
        to: entry.to,
        reason: entry.reason ?? null,
        at: entry.at,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/expenses', validate(createExpenseBody), async (request: any, response: Response, next: NextFunction) => {
  try {
    const created = await createExpense(request.auth.userId, request.body, request.requestId);
    return sendSuccess(response, serializeExpense(created), 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.patch('/expenses/:id', validate(idParam, 'params'), validate(updateExpenseBody), async (request: any, response: Response, next: NextFunction) => {
  try {
    const updated = await updateExpense(request.auth.userId, request.params.id, request.body, request.requestId);
    return sendSuccess(response, serializeExpense(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/**
 * The single expense status-transition route. Voiding is the only reversal and
 * there is deliberately no expense DELETE: financial history is preserved so any
 * total can still be explained after the fact.
 *
 * Allowed transitions are `DRAFT → APPROVED`, `DRAFT → VOIDED` and
 * `APPROVED → VOIDED`. Approval freezes the amount; a wrong approved expense is
 * corrected by voiding it and recording a replacement, never by rewriting it.
 */
const statusBody = z
  .object({ status: z.enum(['APPROVED', 'VOIDED']), reason: z.string().trim().min(3).max(500).optional() })
  .strict()
  .refine(value => value.status !== 'VOIDED' || Boolean(value.reason), { message: 'A reason is required when voiding an expense.', path: ['reason'] });

router.patch('/expenses/:id/status', validate(idParam, 'params'), validate(statusBody), async (request: any, response, next) => {
  try {
    const updated = await changeExpenseStatus(request.auth.userId, request.params.id, request.body.status, request.body.reason, request.requestId);
    return sendSuccess(response, serializeExpense(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/* -------------------------------------------------------------------------- */
/* Finance dashboard, analytics and profit & loss                              */
/* -------------------------------------------------------------------------- */

/**
 * Every figure is a live Mongo aggregate produced by the shared finance service,
 * so this dashboard, the sales dashboard and the report family cannot disagree.
 *
 * This is management reporting, not statutory accounting: there is no general
 * ledger, no chart of accounts, no journal entries and no balance sheet, and
 * `operatingProfit` is deliberately not called audited net income.
 */
router.get('/finance/dashboard', validate(rangeQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const range = resolveRange(request.query as any);
    // The comparison window is the equal-length period immediately before this
    // one, so the percentages are real arithmetic over a bounded second query
    // rather than an invented growth figure.
    const earlier = previousRange(range);
    const [totals, categories, refunds, payments, purchases, before] = await Promise.all([
      computeFinance(range),
      expensesByCategory(range),
      refundsByStatus(range),
      orderPaymentPosture(range),
      purchaseFinance(range),
      computeFinance(earlier),
    ]);
    return sendSuccess(
      response,
      {
        revenue: {
          grossSales: totals.grossSales,
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netSales: totals.netSales,
          netRealizedRevenue: totals.netRealizedRevenue,
          averageOrderValue: totals.averageOrderValue,
        },
        orders: {
          total: totals.orders,
          realized: totals.realizedOrders,
          cancelled: totals.cancelledOrders,
          paid: payments.paidOrders.count,
          unpaid: payments.unpaidOrders.count,
          // Delivered or shipped but not yet collected. Never revenue.
          unpaidCodOrders: payments.unpaidCollectable.count,
          unpaidCodValue: payments.unpaidCollectable.value,
          byPaymentStatus: payments.byPaymentStatus,
        },
        cost: { costOfGoodsSold: totals.costOfGoodsSold, basis: 'LATEST_PURCHASE_COST', snapshot: totals.cogs },
        profit: {
          grossProfit: totals.grossProfit,
          grossMargin: totals.grossMargin,
          operatingExpenses: totals.operatingExpenses,
          operatingProfit: totals.operatingProfit,
          operatingMargin: totals.operatingMargin,
        },
        tax: { collectedOnSales: totals.taxCollected, paidOnExpenses: totals.operatingExpenseTax },
        refundsByStatus: refunds,
        // Procurement money, reported beside the profit figures but never inside
        // them: a purchase commitment is not an operating expense.
        purchasing: purchases,
        expensesByCategory: categories,
        comparison: {
          previous: { from: earlier.from.toISOString(), to: earlier.to.toISOString() },
          grossSales: { value: before.grossSales, change: changePercent(totals.grossSales, before.grossSales) },
          realizedRevenue: { value: before.realizedRevenue, change: changePercent(totals.realizedRevenue, before.realizedRevenue) },
          netSales: { value: before.netSales, change: changePercent(totals.netSales, before.netSales) },
          grossProfit: { value: before.grossProfit, change: changePercent(totals.grossProfit, before.grossProfit) },
          operatingProfit: { value: before.operatingProfit, change: changePercent(totals.operatingProfit, before.operatingProfit) },
        },
        currency: 'PKR',
        basis: 'MANAGEMENT_REPORTING_NOT_STATUTORY_ACCOUNTING',
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.get('/finance/analytics', validate(rangeQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const range = resolveRange(request.query as any);
    const [series, refunds, expenses, tax, categories, totals] = await Promise.all([
      revenueByDate(range),
      refundsByDate(range),
      expensesByDate(range),
      taxByDate(range),
      expensesByCategory(range),
      computeFinance(range),
    ]);
    return sendSuccess(
      response,
      {
        revenueByDate: series,
        refundsByDate: refunds,
        expensesByDate: expenses,
        taxByDate: tax,
        expensesByCategory: categories,
        totals: {
          grossSales: totals.grossSales,
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netSales: totals.netSales,
          costOfGoodsSold: totals.costOfGoodsSold,
          grossProfit: totals.grossProfit,
          operatingExpenses: totals.operatingExpenses,
          operatingProfit: totals.operatingProfit,
          taxCollected: totals.taxCollected,
        },
        currency: 'PKR',
        maxRangeDays: MAX_RANGE_DAYS,
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/**
 * A management profit-and-loss summary. It is explicitly not a GAAP or IFRS
 * financial statement: there is no accrual cut-off, no depreciation, no
 * amortisation, no interest or corporate-tax provision, and the bottom line is
 * reported as `operatingProfit` rather than as audited net income.
 */
router.get('/finance/profit-loss', validate(rangeQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const range = resolveRange(request.query as any);
    const [totals, categories] = await Promise.all([computeFinance(range), expensesByCategory(range)]);
    return sendSuccess(
      response,
      {
        period: { from: range.from.toISOString(), to: range.to.toISOString(), days: range.days },
        revenue: {
          grossSales: totals.grossSales,
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netSales: totals.netSales,
          netRevenue: totals.netRealizedRevenue,
        },
        costOfGoodsSold: totals.costOfGoodsSold,
        grossProfit: totals.grossProfit,
        grossMargin: totals.grossMargin,
        operatingExpenses: { total: totals.operatingExpenses, byCategory: categories },
        operatingProfit: totals.operatingProfit,
        operatingMargin: totals.operatingMargin,
        salesTaxCollected: totals.taxCollected,
        expenseTaxPaid: totals.operatingExpenseTax,
        costBasis: 'LATEST_PURCHASE_COST',
        cogsCoverage: totals.cogs,
        currency: 'PKR',
        basis: 'MANAGEMENT_PROFIT_AND_LOSS_SUMMARY',
        // Stated plainly so the bottom line is never mistaken for net income.
        excludes: [
          'CORPORATE_INCOME_TAX',
          'DEPRECIATION_AND_AMORTISATION',
          'FINANCING_COSTS_AND_INTEREST',
          'BANK_FEES_NOT_RECORDED_AS_EXPENSES',
          'ACCRUALS_AND_PERIOD_CUT_OFF_ADJUSTMENTS',
          'INVENTORY_WRITE_DOWNS_AND_SHRINKAGE',
          'REFUND_COST_REVERSAL',
        ],
        disclaimer:
          'Management summary only. Not a GAAP or IFRS financial statement, not audited net income, and not a substitute for statutory accounting or tax filing.',
        maxRangeDays: MAX_RANGE_DAYS,
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
});

export default router;
