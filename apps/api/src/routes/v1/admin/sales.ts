import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/salesController.js';

const router = express.Router();

const range = z
  .object({ range: z.enum(['7d', '30d', '90d']).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .strict()
  .refine(x => (Boolean(x.range) !== Boolean(x.from || x.to) ? Boolean(x.range) || Boolean(x.from && x.to) : true), 'Use a named range or both from and to.');

router.use(requireAuth, requireSuperAdmin);

router.get('/sales/dashboard', validate(range, 'query'), controller.getSalesDashboard);
router.get('/sales/analytics', validate(range, 'query'), controller.getSalesAnalytics);

export default router;
