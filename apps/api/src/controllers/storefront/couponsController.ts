import type { NextFunction, Request, Response } from 'express';
import { CouponError, previewCoupon } from '../../services/couponService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

export async function validateCoupon(request: Request, response: Response, next: NextFunction) {
  try {
    return sendSuccess(response, await previewCoupon(request.auth!.userId, request.body.code));
  } catch (error) {
    if (error instanceof CouponError) return sendFailure(response, 400, error.code, error.message, request.requestId);
    return next(error);
  }
}
