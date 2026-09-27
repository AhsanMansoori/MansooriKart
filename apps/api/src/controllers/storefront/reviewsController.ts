import type { Request, Response, NextFunction } from 'express';
import { Review } from '../../models/review.js';
import { createReview, deleteReview, ReviewError, updateReview } from '../../services/reviewService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const fail = (error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof ReviewError) {
    return sendFailure(res, error.code === 'REVIEW_EXISTS' ? 409 : 404, error.code, error.message, req.requestId);
  }
  return next(error);
};

export async function getProductReviews(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const sort: any = { createdAt: -1 };
    if (req.query.sort === 'oldest') sort.createdAt = 1;
    if (req.query.sort === 'highest-rating') Object.assign(sort, { rating: -1, createdAt: -1 });
    if (req.query.sort === 'lowest-rating') Object.assign(sort, { rating: 1, createdAt: -1 });

    const [data, total] = await Promise.all([
      Review.find({ product: req.params.productId, status: 'PUBLISHED' })
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', 'name')
        .lean(),
      Review.countDocuments({ product: req.params.productId, status: 'PUBLISHED' }),
    ]);

    return sendSuccess(
      res,
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
  } catch (error) {
    return next(error);
  }
}

export async function createProductReview(req: Request, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await createReview(req.auth!.userId, String(req.params.productId), req.body), 201);
  } catch (error) {
    return fail(error, req, res, next);
  }
}

export async function updateCustomerReview(req: Request, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await updateReview(req.auth!.userId, String(req.params.reviewId), req.body));
  } catch (error) {
    return fail(error, req, res, next);
  }
}

export async function deleteCustomerReview(req: Request, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await deleteReview(req.auth!.userId, String(req.params.reviewId)));
  } catch (error) {
    return fail(error, req, res, next);
  }
}
