import { Router } from 'express';
import { z } from 'zod';
import {
  changeExpenseStatusHandler,
  createExpenseHandler,
  getExpenseDetail,
  getExpenses,
  getExpensesSummary,
  getFinanceAnalytics,
  getFinanceDashboard,
  getFinanceProfitLoss,
  updateExpenseHandler,
} from '../../../controllers/admin/financeController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS } from '../../../models/expense.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();

export const rangeQuery = z
  .object({
    range: z.enum(['7d', '30d', '90d', '180d', '365d']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

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

router.get('/expenses', validate(expenseListQuery, 'query'), getExpenses);

router.get('/expenses/summary', validate(rangeQuery, 'query'), getExpensesSummary);

router.get('/expenses/:id', validate(idParam, 'params'), getExpenseDetail);

router.post('/expenses', validate(createExpenseBody), createExpenseHandler);

router.patch('/expenses/:id', validate(idParam, 'params'), validate(updateExpenseBody), updateExpenseHandler);

const statusBody = z
  .object({ status: z.enum(['APPROVED', 'VOIDED']), reason: z.string().trim().min(3).max(500).optional() })
  .strict()
  .refine(value => value.status !== 'VOIDED' || Boolean(value.reason), { message: 'A reason is required when voiding an expense.', path: ['reason'] });

router.patch('/expenses/:id/status', validate(idParam, 'params'), validate(statusBody), changeExpenseStatusHandler);

router.get('/finance/dashboard', validate(rangeQuery, 'query'), getFinanceDashboard);

router.get('/finance/analytics', validate(rangeQuery, 'query'), getFinanceAnalytics);

router.get('/finance/profit-loss', validate(rangeQuery, 'query'), getFinanceProfitLoss);

export default router;
