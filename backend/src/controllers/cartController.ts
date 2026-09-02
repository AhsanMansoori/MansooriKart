import type { NextFunction, Request, Response } from 'express';
import * as cart from '../services/cartService.js';
import { sendFailure, sendSuccess } from '../utils/api-response.js';

const respond = (error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (error instanceof cart.CartError)
    return sendFailure(response, error.code === 'INSUFFICIENT_STOCK' ? 409 : 404, error.code, error.message, request.requestId);
  return next(error);
};

export const get = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cart.getCart(request.auth!.userId));
  } catch (error) {
    return respond(error, request, response, next);
  }
};

export const add = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cart.addCartItem(request.auth!.userId, request.body.productId, request.body.quantity), 201);
  } catch (error) {
    return respond(error, request, response, next);
  }
};
export const update = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cart.updateCartItem(request.auth!.userId, String(request.params.productId), request.body.quantity));
  } catch (error) {
    return respond(error, request, response, next);
  }
};
export const remove = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cart.removeCartItem(request.auth!.userId, String(request.params.productId)));
  } catch (error) {
    return respond(error, request, response, next);
  }
};
export const clear = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cart.clearCart(request.auth!.userId));
  } catch (error) {
    return respond(error, request, response, next);
  }
};
export const merge = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, await cart.mergeGuestCart(request.auth!.userId, request.body.items));
  } catch (error) {
    return respond(error, request, response, next);
  }
};
