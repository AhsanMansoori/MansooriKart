import { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { Expense } from '../../models/expense.js';
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

const rangeMeta = (range: { from: Date; to: Date; days: number }) => ({ from: range.from.toISOString(), to: range.to.toISOString(), days: range.days });

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
  purchaseOrder: document.purchaseOrder ? String(document.purchaseOrder) : null,
  status: document.status,
  approvedAt: document.approvedAt ?? null,
  voidedAt: document.voidedAt ?? null,
  voidReason: document.voidReason ?? null,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

export async function getExpenses(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
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
}

export async function getExpensesSummary(request: any, response: Response, next: NextFunction) {
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
}

export async function getExpenseDetail(request: any, response: Response, next: NextFunction) {
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
}

export async function createExpenseHandler(request: any, response: Response, next: NextFunction) {
  try {
    const created = await createExpense(request.auth.userId, request.body, request.requestId);
    return sendSuccess(response, serializeExpense(created), 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function updateExpenseHandler(request: any, response: Response, next: NextFunction) {
  try {
    const updated = await updateExpense(request.auth.userId, request.params.id, request.body, request.requestId);
    return sendSuccess(response, serializeExpense(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function changeExpenseStatusHandler(request: any, response: Response, next: NextFunction) {
  try {
    const updated = await changeExpenseStatus(request.auth.userId, request.params.id, request.body.status, request.body.reason, request.requestId);
    return sendSuccess(response, serializeExpense(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getFinanceDashboard(request: any, response: Response, next: NextFunction) {
  try {
    const range = resolveRange(request.query as any);
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
}

export async function getFinanceAnalytics(request: any, response: Response, next: NextFunction) {
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
}

export async function getFinanceProfitLoss(request: any, response: Response, next: NextFunction) {
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
}
