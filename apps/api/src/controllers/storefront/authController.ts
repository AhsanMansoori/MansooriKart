import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import type { BackendConfig } from '../../config/env.js';
import { User } from '../../models/user.js';
import { user as serializeUser } from '../../serializers/index.js';
import { authenticateWithGoogle, GoogleAuthError } from '../../services/googleAuthService.js';
import { sendPasswordReset } from '../../services/transactionalEmail.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

export const tokenFor = (config: BackendConfig, value: { _id: { toString(): string }; role: string; sessionVersion?: number }) =>
  jwt.sign({ sub: value._id.toString(), role: value.role, ver: value.sessionVersion ?? 0 }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as NonNullable<jwt.SignOptions['expiresIn']>,
  });

export const session = (config: BackendConfig, value: Record<string, any>) => ({
  token: tokenFor(config, value as { _id: { toString(): string }; role: string; sessionVersion?: number }),
  user: serializeUser(value),
});

export async function registerHandler(config: BackendConfig, request: Request, response: Response, next: NextFunction) {
  try {
    const input = request.body as { name: string; email: string; password: string };
    if (await User.exists({ email: input.email }))
      return sendFailure(response, 409, 'AUTH_EMAIL_EXISTS', 'An account already exists for that email.', request.requestId);
    const created = await User.create({
      name: input.name,
      email: input.email,
      password: await bcrypt.hash(input.password, 12),
      authProviders: ['LOCAL'],
      role: 'CUSTOMER',
    });
    return sendSuccess(response, session(config, created.toObject()), 201);
  } catch (error) {
    return next(error);
  }
}

export async function loginHandler(config: BackendConfig, request: Request, response: Response, next: NextFunction) {
  try {
    const input = request.body as { email: string; password: string };
    const found = await User.findOne({ email: input.email }).select('+password +sessionVersion');

    if (!found || found.status !== 'ACTIVE' || !found.password || !(await bcrypt.compare(input.password, found.password)))
      return sendFailure(response, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password.', request.requestId);

    return sendSuccess(response, session(config, found.toObject()));
  } catch (error) {
    return next(error);
  }
}

export async function googleAuthHandler(config: BackendConfig, request: Request, response: Response, next: NextFunction) {
  try {
    const { credential } = request.body as { credential: string };
    const { user, outcome } = await authenticateWithGoogle(credential, request.requestId);
    return sendSuccess(response, { ...session(config, user), provider: 'GOOGLE', outcome });
  } catch (error) {
    if (!(error instanceof GoogleAuthError)) return next(error);
    const status =
      error.code === 'GOOGLE_AUTH_UNAVAILABLE' ? 503 : error.code === 'GOOGLE_TOKEN_INVALID' ? 401 : error.code === 'GOOGLE_ACCOUNT_CONFLICT' ? 409 : 403;
    return sendFailure(response, status, error.code, error.message, request.requestId);
  }
}

export async function forgotPasswordHandler(config: BackendConfig, request: Request, response: Response, next: NextFunction) {
  try {
    const input = request.body as { email: string };
    const found = await User.findOne({ email: input.email }).select('+passwordResetTokenHash +passwordResetExpiresAt');
    if (found) {
      const token = crypto.randomBytes(32).toString('hex');
      found.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      found.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await found.save();
      const baseUrl = config.frontendUrl || 'http://localhost:5173';
      await sendPasswordReset({ email: found.email, resetUrl: `${baseUrl.replace(/\/$/, '')}/reset-password?token=${token}` });
    }
    return sendSuccess(response, { message: 'If an account exists for that email, a password reset was requested. Email delivery is not yet available.' });
  } catch (error) {
    return next(error);
  }
}

export async function resetPasswordHandler(request: Request, response: Response, next: NextFunction) {
  try {
    const input = request.body as { token: string; password: string };
    const hash = crypto.createHash('sha256').update(input.token).digest('hex');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const found = await User.findOneAndUpdate(
      { passwordResetTokenHash: hash, passwordResetExpiresAt: { $gt: new Date() }, status: 'ACTIVE' },
      {
        $set: { password: passwordHash, passwordChangedAt: new Date() },
        $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
        $inc: { sessionVersion: 1 },
        $addToSet: { authProviders: 'LOCAL' },
      },
      { new: true }
    );
    if (!found) return sendFailure(response, 400, 'AUTH_RESET_TOKEN_INVALID', 'This password reset link is invalid or has expired.', request.requestId);
    return sendSuccess(response, { message: 'Your password has been reset. Please sign in.' });
  } catch (error) {
    return next(error);
  }
}
