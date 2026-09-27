import { Router } from 'express';
import { z } from 'zod';
import {
  getCustomerAnalytics,
  getCustomerDetail,
  getCustomerOrders,
  getCustomers,
  updateCustomerStatus,
} from '../../../controllers/admin/customersController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    role: z.enum(['CUSTOMER', 'SUPER_ADMIN']).optional(),
    segment: z.enum(['PROSPECT', 'NEW', 'REPEAT', 'VIP', 'AT_RISK']).optional(),
    hasOrders: z.enum(['true', 'false']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sort: z.enum(['createdAt', 'name', 'email', 'totalOrders', 'realizedSpend', 'lastOrderAt']).default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

router.get('/customers', validate(listQuery, 'query'), getCustomers);

const analyticsQuery = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(30), limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

router.get('/customers/analytics', validate(analyticsQuery, 'query'), getCustomerAnalytics);

router.get('/customers/:id', validate(idParam, 'params'), getCustomerDetail);

const ordersQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

router.get('/customers/:id/orders', validate(idParam, 'params'), validate(ordersQuery, 'query'), getCustomerOrders);

const statusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(1).max(500).optional() }).strict();

router.patch('/customers/:id/status', validate(idParam, 'params'), validate(statusBody, 'body'), updateCustomerStatus);

export default router;
