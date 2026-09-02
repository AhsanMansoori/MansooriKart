import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { getConfig } from '../../config/env.js';
import { User } from '../../models/user.js';
import { validate } from '../../middleware/validate.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { user as serializeUser } from '../../serializers/index.js';

const { sendPasswordReset } = require('../../../services/email/emailService') as {
  sendPasswordReset(input: { email: string; resetUrl: string }): Promise<void>;
};

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => sendFailure(response, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.', request.requestId),
});

const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform(value => value.toLowerCase());

const password = z.string().min(8).max(128);

const tokenFor = (value: { _id: { toString(): string }; role: string }) =>
  jwt.sign({ sub: value._id.toString(), role: value.role }, getConfig().jwtSecret, { expiresIn: '48h' });

router.post(
  '/register',
  limiter,
  validate(z.object({ name: z.string().trim().min(1).max(120), email, password }).strict()),
  async (request, response, next) => {
    try {
      const input = request.body as { name: string; email: string; password: string };
      if (await User.exists({ email: input.email }))
        return sendFailure(response, 409, 'AUTH_EMAIL_EXISTS', 'An account already exists for that email.', request.requestId);
      const created = await User.create({ name: input.name, email: input.email, password: await bcrypt.hash(input.password, 12), role: 'CUSTOMER' });
      return sendSuccess(response, { token: tokenFor(created), user: serializeUser(created.toObject()) }, 201);
    } catch (error) {
      return next(error);
    }
  }
);
router.post('/login', limiter, validate(z.object({ email, password: z.string().min(1).max(128) }).strict()), async (request, response, next) => {
  try {
    const input = request.body as { email: string; password: string };
    const found = await User.findOne({ email: input.email }).select('+password');

    if (!found || found.status !== 'ACTIVE' || !(await bcrypt.compare(input.password, found.password)))
      return sendFailure(response, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password.', request.requestId);

    return sendSuccess(response, { token: tokenFor(found), user: serializeUser(found.toObject()) });
  } catch (error) {
    return next(error);
  }
});

router.post('/forgot-password', limiter, validate(z.object({ email }).strict()), async (request, response, next) => {
  try {
    const input = request.body as { email: string };
    const found = await User.findOne({ email: input.email }).select('+passwordResetTokenHash +passwordResetExpiresAt');
    if (found) {
      const token = crypto.randomBytes(32).toString('hex');
      found.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      found.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await found.save();
      const baseUrl = getConfig().frontendUrl || 'http://localhost:5173';
      await sendPasswordReset({ email: found.email, resetUrl: `${baseUrl.replace(/\/$/, '')}/reset-password?token=${token}` });
    }
    return sendSuccess(response, { message: 'If an account exists for that email, password reset instructions have been sent.' });
  } catch (error) {
    return next(error);
  }
});
router.post('/reset-password', limiter, validate(z.object({ token: z.string().min(32).max(128), password }).strict()), async (request, response, next) => {
  try {
    const input = request.body as { token: string; password: string };
    const hash = crypto.createHash('sha256').update(input.token).digest('hex');
    const found = await User.findOne({ passwordResetTokenHash: hash, passwordResetExpiresAt: { $gt: new Date() } }).select(
      '+passwordResetTokenHash +passwordResetExpiresAt +password'
    );
    if (!found) return sendFailure(response, 400, 'AUTH_RESET_TOKEN_INVALID', 'This password reset link is invalid or has expired.', request.requestId);
    found.password = await bcrypt.hash(input.password, 12);
    found.passwordResetTokenHash = undefined;
    found.passwordResetExpiresAt = undefined;
    found.passwordChangedAt = new Date();
    await found.save();
    return sendSuccess(response, { message: 'Your password has been reset. Please sign in.' });
  } catch (error) {
    return next(error);
  }
});
export default router;
