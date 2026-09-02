const express = require('express');
const { body, validationResult } = require('express-validator');
const Address = require('../../models/address');
const User = require('../../models/user');
const { requireAuth } = require('../../middleware/auth');
const { failure, success } = require('../../utils/apiResponse');
const { serializeUser } = require('../../utils/serializers');

const router = express.Router();
const addressFields = ['label', 'fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'stateProvince', 'postalCode', 'country', 'isDefault'];
const addressValidation = [
  body('fullName').trim().notEmpty().isLength({ max: 120 }),
  body('phone').trim().notEmpty().isLength({ max: 30 }),
  body('addressLine1').trim().notEmpty().isLength({ max: 200 }),
  body('city').trim().notEmpty().isLength({ max: 100 }),
  body('country').trim().notEmpty().isLength({ max: 100 }),
];
const pick = (source, keys) => Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
const serializeAddress = address => ({ ...(address.toObject?.() || address), id: String(address._id) });

router.use(requireAuth);
router.get('/', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return failure(res, 401, 'AUTH_UNAUTHORIZED', 'Authentication is required.', req.requestId);
    return success(res, serializeUser(user));
  } catch (error) {
    return next(error);
  }
});
router.patch(
  '/',
  [
    body('name').optional().trim().isLength({ min: 1, max: 120 }),
    body('phone').optional().trim().isLength({ max: 30 }),
    body('avatar')
      .optional()
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .isLength({ max: 2048 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return failure(res, 400, 'VALIDATION_ERROR', errors.array()[0].msg, req.requestId);
    try {
      const user = await User.findByIdAndUpdate(req.user.id, { $set: pick(req.body, ['name', 'phone', 'avatar']) }, { new: true, runValidators: true });
      return success(res, serializeUser(user));
    } catch (error) {
      return next(error);
    }
  }
);
router.get('/addresses', async (req, res, next) => {
  try {
    const addresses = await Address.find({ user: req.user.id }).sort({ isDefault: -1, updatedAt: -1 });
    return success(res, addresses.map(serializeAddress));
  } catch (error) {
    return next(error);
  }
});
router.post('/addresses', addressValidation, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return failure(res, 400, 'VALIDATION_ERROR', errors.array()[0].msg, req.requestId);
  try {
    const values = pick(req.body, addressFields);
    if (values.isDefault) await Address.updateMany({ user: req.user.id }, { $set: { isDefault: false } });
    const hasAddresses = await Address.exists({ user: req.user.id });
    const address = await Address.create({ ...values, user: req.user.id, isDefault: values.isDefault || !hasAddresses });
    return success(res, serializeAddress(address), undefined, 201);
  } catch (error) {
    return next(error);
  }
});
router.patch('/addresses/:id', async (req, res, next) => {
  try {
    const values = pick(req.body, addressFields);
    if (!Object.keys(values).length) return failure(res, 400, 'VALIDATION_ERROR', 'At least one address field is required', req.requestId);
    if (values.isDefault) await Address.updateMany({ user: req.user.id }, { $set: { isDefault: false } });
    const address = await Address.findOneAndUpdate({ _id: req.params.id, user: req.user.id }, { $set: values }, { new: true, runValidators: true });
    if (!address) return failure(res, 404, 'ADDRESS_NOT_FOUND', 'Address not found', req.requestId);
    return success(res, serializeAddress(address));
  } catch (error) {
    return next(error);
  }
});
router.delete('/addresses/:id', async (req, res, next) => {
  try {
    const address = await Address.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!address) return failure(res, 404, 'ADDRESS_NOT_FOUND', 'Address not found', req.requestId);
    if (address.isDefault) {
      const replacement = await Address.findOne({ user: req.user.id }).sort({ updatedAt: -1 });
      if (replacement) {
        replacement.isDefault = true;
        await replacement.save();
      }
    }
    return success(res, { id: String(address._id), deleted: true });
  } catch (error) {
    return next(error);
  }
});
module.exports = router;
