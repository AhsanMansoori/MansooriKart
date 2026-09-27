import express from 'express';
import { z } from 'zod';
import { listReviews, moderateReviewStatus } from '../../../controllers/admin/reviewsController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const router = express.Router();
const oid = /^[a-f\d]{24}$/i;
const rid = z.object({ reviewId: z.string().regex(oid) }).strict();
const status = z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']), reason: z.string().trim().min(3).max(500) }).strict();

router.use(requireAuth, requireSuperAdmin);
router.get('/reviews', listReviews);
router.patch('/reviews/:reviewId/status', validate(rid, 'params'), validate(status), moderateReviewStatus);

export default router;
