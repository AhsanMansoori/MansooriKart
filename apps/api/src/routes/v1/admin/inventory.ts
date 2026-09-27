import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/inventoryController.js';

const router = express.Router();

const adjust = z
  .object({
    quantityDelta: z
      .number()
      .int()
      .refine(value => value !== 0),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const productParams = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

router.use(requireAuth, requireSuperAdmin);

router.get('/inventory', controller.getInventory);
router.get('/inventory/low-stock', controller.getLowStock);
router.get('/inventory/out-of-stock', controller.getOutOfStock);
router.get('/inventory/:productId/movements', validate(productParams, 'params'), controller.getProductMovements);
router.post('/inventory/:productId/adjust', validate(productParams, 'params'), validate(adjust), controller.adjustProductStock);

export default router;
