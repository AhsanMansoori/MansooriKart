import express from 'express';
import { z } from 'zod';
import { CONTENT_LIMITS } from '../../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/couponsController.js';

const router = express.Router();
const MAX_MONEY = 100_000_000;

const fields = z
  .object({
    code: z.string().trim().min(2).max(64).optional(),
    type: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    value: z.number().positive().max(MAX_MONEY).optional(),
    minimumOrderAmount: z.number().min(0).max(MAX_MONEY).optional(),
    maximumDiscount: z.number().positive().max(MAX_MONEY).optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    usageLimit: z.number().int().positive().max(1_000_000).optional(),
    perCustomerLimit: z.number().int().positive().max(1_000_000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(CONTENT_LIMITS.defaultPageSize),
    state: z.enum(['ACTIVE', 'DISABLED', 'SCHEDULED', 'EXPIRED', 'EXHAUSTED']).optional(),
    type: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    code: z.string().trim().min(1).max(64).optional(),
    search: z.string().trim().min(1).max(64).optional(),
    sort: z.enum(['newest', 'oldest', 'code', 'value_desc', 'usage_desc', 'expiring']).default('newest'),
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

router.get('/coupons', validate(listQuery, 'query'), controller.listCoupons);
router.post('/coupons', validate(fields.refine(v => v.code && v.type && v.value !== undefined, 'code, type and value are required')), controller.createCoupon);
router.get('/coupons/:id', controller.getCouponById);
router.get('/coupons/:id/usage', controller.getCouponUsage);
router.patch('/coupons/:id', validate(fields), controller.patchCoupon);
router.post('/coupons/:id/activate', controller.activateCoupon);
router.post('/coupons/:id/disable', controller.disableCoupon);
router.delete('/coupons/:id', controller.deleteCoupon);

export default router;
