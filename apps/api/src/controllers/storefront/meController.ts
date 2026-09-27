import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { Address } from '../../models/address.js';
import { User } from '../../models/user.js';
import * as serialize from '../../serializers/index.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

export async function getCurrentUser(request: Request, response: Response, next: NextFunction) {
  try {
    const current = await User.findById(request.auth!.userId).lean();
    return current
      ? sendSuccess(response, serialize.user(current))
      : sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
  } catch (error) {
    return next(error);
  }
}

export async function updateProfile(request: Request, response: Response, next: NextFunction) {
  try {
    const values = request.body;
    const current = await User.findByIdAndUpdate(request.auth!.userId, { $set: values }, { new: true, runValidators: true }).lean();
    return current
      ? sendSuccess(response, serialize.user(current))
      : sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
  } catch (error) {
    return next(error);
  }
}

export async function listAddresses(request: Request, response: Response, next: NextFunction) {
  try {
    return sendSuccess(response, (await Address.find({ user: request.auth!.userId }).sort({ isDefault: -1, updatedAt: -1 }).lean()).map(serialize.address));
  } catch (error) {
    return next(error);
  }
}

export async function createAddress(request: Request, response: Response, next: NextFunction) {
  try {
    const values = request.body;
    const exists = await Address.exists({ user: request.auth!.userId });
    if (values.isDefault) await Address.updateMany({ user: request.auth!.userId }, { $set: { isDefault: false } });
    const created = await Address.create({ ...values, user: request.auth!.userId, isDefault: values.isDefault || !exists });
    return sendSuccess(response, serialize.address(created.toObject()), 201);
  } catch (error) {
    return next(error);
  }
}

export async function updateAddress(request: Request, response: Response, next: NextFunction) {
  try {
    const values = request.body;
    if (values.isDefault) await Address.updateMany({ user: request.auth!.userId }, { $set: { isDefault: false } });
    const updated = await Address.findOneAndUpdate(
      { _id: request.params.id, user: request.auth!.userId },
      { $set: values },
      { new: true, runValidators: true }
    ).lean();
    return updated
      ? sendSuccess(response, serialize.address(updated))
      : sendFailure(response, 404, 'ADDRESS_NOT_FOUND', 'Address not found', request.requestId);
  } catch (error) {
    return next(error);
  }
}

export async function deleteAddress(request: Request, response: Response, next: NextFunction) {
  try {
    const deleted = await Address.findOneAndDelete({ _id: request.params.id, user: request.auth!.userId });
    if (!deleted) return sendFailure(response, 404, 'ADDRESS_NOT_FOUND', 'Address not found', request.requestId);
    if (deleted.isDefault) {
      const replacement = await Address.findOne({ user: request.auth!.userId }).sort({ updatedAt: -1 });
      if (replacement) {
        replacement.isDefault = true;
        await replacement.save();
      }
    }
    return sendSuccess(response, { id: deleted._id.toString(), deleted: true });
  } catch (error) {
    return next(error);
  }
}
