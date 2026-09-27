import express from 'express';
import { z } from 'zod';
import { createProductReview, deleteCustomerReview, getProductReviews, updateCustomerReview } from '../../../controllers/storefront/reviewsController.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const oid = /^[a-f\d]{24}$/i;
const body = z
  .object({ rating: z.number().int().min(1).max(5), title: z.string().trim().min(1).max(120).optional(), body: z.string().trim().min(3).max(2000) })
  .strict();
const rid = z.object({ reviewId: z.string().regex(oid) }).strict();
const pid = z.object({ productId: z.string().regex(oid) }).strict();

const product = express.Router();
product.get('/:productId/reviews', validate(pid, 'params'), getProductReviews);
product.post('/:productId/reviews', requireAuth, validate(pid, 'params'), validate(body), createProductReview);

const own = express.Router();
own.use(requireAuth);
own.patch('/:reviewId', validate(rid, 'params'), validate(body), updateCustomerReview);
own.delete('/:reviewId', validate(rid, 'params'), deleteCustomerReview);

export { product as productReviewRoutes, own as reviewRoutes };
