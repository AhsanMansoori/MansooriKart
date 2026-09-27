import { Router } from 'express';
import { z } from 'zod';
import {
  getCustomerReport,
  getFinanceReport,
  getInventoryMovementReport,
  getInventoryReport,
  getOrderReport,
  getProductReport,
  getProfitReport,
  getPurchasesReport,
  getReportsIndex,
  getSalesReport,
  getTaxReport,
} from '../../../controllers/admin/reportsController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const baseQuery = {
  range: z.enum(['7d', '30d', '90d', '180d', '365d']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const rangeOnly = z.object({ range: baseQuery.range, from: baseQuery.from, to: baseQuery.to }).strict();
const paged = <T extends z.ZodRawShape>(extra: T) => z.object({ ...baseQuery, ...extra }).strict();

router.get('/reports/sales', validate(rangeOnly, 'query'), getSalesReport);

const productReportQuery = paged({
  sort: z.enum(['unitsSold', 'grossRevenue', 'realizedRevenue', 'grossProfit']).default('realizedRevenue'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().min(1).max(120).optional(),
});
router.get('/reports/products', validate(productReportQuery, 'query'), getProductReport);

const inventoryReportQuery = z
  .object({
    page: baseQuery.page,
    limit: baseQuery.limit,
    filter: z.enum(['all', 'low-stock', 'out-of-stock']).default('all'),
    sort: z.enum(['available', 'stockValue', 'name']).default('stockValue'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
router.get('/reports/inventory', validate(inventoryReportQuery, 'query'), getInventoryReport);

const movementReportQuery = paged({ groupBy: z.enum(['type', 'date', 'product']).default('type') });
router.get('/reports/inventory-movements', validate(movementReportQuery, 'query'), getInventoryMovementReport);

const customerReportQuery = paged({
  sort: z.enum(['realizedSpend', 'grossSpend', 'orders']).default('realizedSpend'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
router.get('/reports/customers', validate(customerReportQuery, 'query'), getCustomerReport);

router.get('/reports/orders', validate(rangeOnly, 'query'), getOrderReport);
router.get('/reports/purchases', validate(rangeOnly, 'query'), getPurchasesReport);
router.get('/reports/finance', validate(rangeOnly, 'query'), getFinanceReport);

const profitReportQuery = paged({ groupBy: z.enum(['summary', 'date', 'product', 'category']).default('summary') });
router.get('/reports/profit', validate(profitReportQuery, 'query'), getProfitReport);

router.get('/reports/tax', validate(rangeOnly, 'query'), getTaxReport);

router.get('/reports', validate(z.object({}).strict(), 'query'), getReportsIndex);

export default router;
