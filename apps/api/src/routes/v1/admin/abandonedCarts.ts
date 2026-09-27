import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/abandonedCartsController.js';

export const DEFAULT_ABANDONED_AFTER_HOURS = 24;

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    olderThanHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(DEFAULT_ABANDONED_AFTER_HOURS),
  })
  .strict();

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/abandoned-carts', validate(listQuery, 'query'), controller.listAbandonedCarts);

export default router;
