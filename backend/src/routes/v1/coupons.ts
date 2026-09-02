import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { CouponError, previewCoupon } from '../../services/couponService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router();
const body = z.object({ code: z.string().trim().min(1).max(64) }).strict();
router.post('/validate', requireAuth, validate(body), async (r, s, n) => {
  try {
    return sendSuccess(s, await previewCoupon(r.auth!.userId, r.body.code));
  } catch (e) {
    if (e instanceof CouponError) return sendFailure(s, 400, e.code, e.message, r.requestId);
    return n(e);
  }
});
export default router;
