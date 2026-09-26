import type { NextFunction, Request, Response } from 'express';
import * as wishlist from '../services/wishlistService.js';
import { sendFailure, sendSuccess } from '../utils/api-response.js';
const respond = (error: unknown, request: Request, response: Response, next: NextFunction) =>
  error instanceof wishlist.WishlistError ? sendFailure(response, 404, error.code, error.message, request.requestId) : next(error);
export const get = async (r: Request, s: Response, n: NextFunction) => {
  try {
    return sendSuccess(s, await wishlist.getWishlist(r.auth!.userId));
  } catch (e) {
    return respond(e, r, s, n);
  }
};
export const add = async (r: Request, s: Response, n: NextFunction) => {
  try {
    return sendSuccess(s, await wishlist.addWishlistItem(r.auth!.userId, r.body.productId), 201);
  } catch (e) {
    return respond(e, r, s, n);
  }
};
export const remove = async (r: Request, s: Response, n: NextFunction) => {
  try {
    return sendSuccess(s, await wishlist.removeWishlistItem(r.auth!.userId, String(r.params.productId)));
  } catch (e) {
    return respond(e, r, s, n);
  }
};
export const clear = async (r: Request, s: Response, n: NextFunction) => {
  try {
    return sendSuccess(s, await wishlist.clearWishlist(r.auth!.userId));
  } catch (e) {
    return respond(e, r, s, n);
  }
};
