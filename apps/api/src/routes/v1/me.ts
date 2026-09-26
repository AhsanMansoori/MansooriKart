import express from 'express';
import { z } from 'zod';
import { Address } from '../../models/address.js';
import { User } from '../../models/user.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as serialize from '../../serializers/index.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const router = express.Router();
const profile = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    avatar: z.string().url().max(2048).optional(),
  })

  .strict();

const address = z
  .object({
    label: z.string().trim().min(1).max(50).optional(),
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(1).max(30),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    stateProvince: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(30).optional(),
    country: z.string().trim().min(1).max(100),
    isDefault: z.boolean().optional(),
  })
  .strict();

const partialAddress = address.partial().refine(value => Object.keys(value).length > 0, 'At least one address field is required');
router.use(requireAuth);

router.get('/', async (request, response, next) => {
  try {
    const current = await User.findById(request.auth!.userId).lean();
    return current
      ? sendSuccess(response, serialize.user(current))
      : sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
  } catch (error) {
    return next(error);
  }
});

router.patch('/', validate(profile), async (request, response, next) => {
  try {
    const values = request.body as z.infer<typeof profile>;
    const current = await User.findByIdAndUpdate(request.auth!.userId, { $set: values }, { new: true, runValidators: true }).lean();
    return current
      ? sendSuccess(response, serialize.user(current))
      : sendFailure(response, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', request.requestId);
  } catch (error) {
    return next(error);
  }
});

router.get('/addresses', async (request, response, next) => {
  try {
    return sendSuccess(response, (await Address.find({ user: request.auth!.userId }).sort({ isDefault: -1, updatedAt: -1 }).lean()).map(serialize.address));
  } catch (error) {
    return next(error);
  }
});

router.post('/addresses', validate(address), async (request, response, next) => {
  try {
    const values = request.body as z.infer<typeof address>;
    const exists = await Address.exists({ user: request.auth!.userId });
    if (values.isDefault) await Address.updateMany({ user: request.auth!.userId }, { $set: { isDefault: false } });
    const created = await Address.create({ ...values, user: request.auth!.userId, isDefault: values.isDefault || !exists });
    return sendSuccess(response, serialize.address(created.toObject()), 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/addresses/:id', validate(partialAddress), async (request, response, next) => {
  try {
    const values = request.body as z.infer<typeof partialAddress>;
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
});

router.delete('/addresses/:id', async (request, response, next) => {
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
});

export default router;
