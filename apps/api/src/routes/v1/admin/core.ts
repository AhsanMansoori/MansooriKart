import express from 'express';
import { z } from 'zod';
import { CONTENT_LIMITS } from '../../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/coreController.js';

const router = express.Router();
const objectId = /^[a-f\d]{24}$/i;
const rangeSchema = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') }).strict();

const auditQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(20),
    action: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    actor: z.string().regex(objectId).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from.getTime() > value.to.getTime())
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: '`from` must not be after `to`.' });
    if (value.from && value.to && value.to.getTime() - value.from.getTime() > CONTENT_LIMITS.maxDateRangeDays * 86_400_000)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `Date range must not exceed ${CONTENT_LIMITS.maxDateRangeDays} days.` });
  });

router.use(requireAuth, requireSuperAdmin);

router.get('/dashboard', controller.getDashboard);
router.get('/dashboard/sales', validate(rangeSchema, 'query'), controller.getDashboardSales);
router.get('/dashboard/orders', validate(rangeSchema, 'query'), controller.getDashboardOrders);
router.get('/dashboard/products', validate(rangeSchema, 'query'), controller.getDashboardProducts);

router.get('/audit-logs/actions', controller.getAuditActions);
router.get('/audit-logs', validate(auditQuery, 'query'), controller.listAuditLogs);
router.get('/audit-logs/:id', controller.getAuditLogById);

router.get('/system/health', controller.getSystemHealth);

export default router;
