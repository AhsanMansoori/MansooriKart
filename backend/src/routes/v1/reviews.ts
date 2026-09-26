import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Review } from '../../models/review.js';
import { createReview, deleteReview, recalculate, ReviewError, updateReview } from '../../services/reviewService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const oid = /^[a-f\d]{24}$/i,
  body = z
    .object({ rating: z.number().int().min(1).max(5), title: z.string().trim().min(1).max(120).optional(), body: z.string().trim().min(3).max(2000) })
    .strict(),
  rid = z.object({ reviewId: z.string().regex(oid) }).strict(),
  pid = z.object({ productId: z.string().regex(oid) }).strict(),
  status = z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']), reason: z.string().trim().min(3).max(500) }).strict();
const fail = (e: any, r: any, s: any, n: any) =>
  e instanceof ReviewError ? sendFailure(s, e.code === 'REVIEW_EXISTS' ? 409 : 404, e.code, e.message, r.requestId) : n(e);
const product = express.Router();
product.get('/:productId/reviews', validate(pid, 'params'), async (r, s, n) => {
  try {
    const page = Math.max(1, Number(r.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(r.query.limit) || 20)),
      sort: any = { createdAt: -1 };
    if (r.query.sort === 'oldest') sort.createdAt = 1;
    if (r.query.sort === 'highest-rating') Object.assign(sort, { rating: -1, createdAt: -1 });
    if (r.query.sort === 'lowest-rating') Object.assign(sort, { rating: 1, createdAt: -1 });
    const [data, total] = await Promise.all([
      Review.find({ product: r.params.productId, status: 'PUBLISHED' })
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', 'name')
        .lean(),
      Review.countDocuments({ product: r.params.productId, status: 'PUBLISHED' }),
    ]);
    return sendSuccess(
      s,
      data.map((x: any) => ({
        id: String(x._id),
        rating: x.rating,
        title: x.title,
        body: x.body,
        verifiedPurchase: x.verifiedPurchase,
        createdAt: x.createdAt,
        reviewerName: x.customer?.name,
      })),
      200,
      { page, limit, total }
    );
  } catch (e) {
    return n(e);
  }
});
product.post('/:productId/reviews', requireAuth, validate(pid, 'params'), validate(body), async (r, s, n) => {
  try {
    return sendSuccess(s, await createReview(r.auth!.userId, String(r.params.productId), r.body), 201);
  } catch (e) {
    return fail(e, r, s, n);
  }
});
const own = express.Router();
own.use(requireAuth);
own.patch('/:reviewId', validate(rid, 'params'), validate(body), async (r, s, n) => {
  try {
    return sendSuccess(s, await updateReview(r.auth!.userId, String(r.params.reviewId), r.body));
  } catch (e) {
    return fail(e, r, s, n);
  }
});
own.delete('/:reviewId', validate(rid, 'params'), async (r, s, n) => {
  try {
    return sendSuccess(s, await deleteReview(r.auth!.userId, String(r.params.reviewId)));
  } catch (e) {
    return fail(e, r, s, n);
  }
});
const admin = express.Router();
admin.use(requireAuth, requireSuperAdmin);
admin.get('/reviews', async (r, s, n) => {
  try {
    const page = Math.max(1, Number(r.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(r.query.limit) || 20)),
      filter: any = {};
    if (typeof r.query.status === 'string') filter.status = r.query.status;
    if (typeof r.query.rating === 'string') filter.rating = Number(r.query.rating);
    if (typeof r.query.product === 'string' && oid.test(r.query.product)) filter.product = r.query.product;
    if (typeof r.query.verifiedPurchase === 'string') filter.verifiedPurchase = r.query.verifiedPurchase === 'true';
    const [data, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', 'name')
        .lean(),
      Review.countDocuments(filter),
    ]);
    return sendSuccess(s, data, 200, { page, limit, total });
  } catch (e) {
    return n(e);
  }
});
admin.patch('/reviews/:reviewId/status', validate(rid, 'params'), validate(status), async (r, s, n) => {
  try {
    const x = await Review.findById(r.params.reviewId);
    if (!x) return sendFailure(s, 404, 'REVIEW_NOT_FOUND', 'Review not found.', r.requestId);
    const old = x.status;
    x.status = r.body.status;
    x.moderationReason = r.body.reason;
    x.moderatedAt = new Date();
    x.moderatedBy = r.auth!.userId;
    await x.save();
    await recalculate(String(x.product));
    await AuditLog.create({
      actor: r.auth!.userId,
      action: 'REVIEW_MODERATED',
      resourceType: 'Review',
      resourceId: String(x._id),
      requestId: r.requestId,
      metadata: { oldStatus: old, newStatus: x.status, reason: r.body.reason },
    });
    return sendSuccess(s, x);
  } catch (e) {
    return n(e);
  }
});
export { product as productReviewRoutes, own as reviewRoutes, admin as adminReviewRoutes };
