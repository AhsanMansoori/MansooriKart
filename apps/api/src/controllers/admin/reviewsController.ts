import type { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../../models/auditLog.js';
import { Review } from '../../models/review.js';
import { recalculate } from '../../services/reviewService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const oid = /^[a-f\d]{24}$/i;

export async function listReviews(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter: any = {};
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    if (typeof req.query.rating === 'string') filter.rating = Number(req.query.rating);
    if (typeof req.query.product === 'string' && oid.test(req.query.product)) filter.product = req.query.product;
    if (typeof req.query.verifiedPurchase === 'string') filter.verifiedPurchase = req.query.verifiedPurchase === 'true';

    const [data, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', 'name')
        .lean(),
      Review.countDocuments(filter),
    ]);
    return sendSuccess(res, data, 200, { page, limit, total });
  } catch (error) {
    return next(error);
  }
}

export async function moderateReviewStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return sendFailure(res, 404, 'REVIEW_NOT_FOUND', 'Review not found.', req.requestId);

    const oldStatus = review.status;
    review.status = req.body.status;
    review.moderationReason = req.body.reason;
    review.moderatedAt = new Date();
    review.moderatedBy = req.auth!.userId;
    await review.save();

    await recalculate(String(review.product));
    await AuditLog.create({
      actor: req.auth!.userId,
      action: 'REVIEW_MODERATED',
      resourceType: 'Review',
      resourceId: String(review._id),
      requestId: req.requestId,
      metadata: { oldStatus, newStatus: review.status, reason: req.body.reason },
    });
    return sendSuccess(res, review);
  } catch (error) {
    return next(error);
  }
}
