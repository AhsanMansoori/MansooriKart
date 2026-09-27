import express from 'express';
import { z } from 'zod';
import { validateCoupon } from '../../../controllers/storefront/couponsController.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const router = express.Router();
const body = z.object({ code: z.string().trim().min(1).max(64) }).strict();

router.post('/validate', requireAuth, validate(body), validateCoupon);

export default router;
