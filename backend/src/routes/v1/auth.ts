import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { BackendConfig } from '../../config/env.js';
import { User } from '../../models/user.js';
import { validate } from '../../middleware/validate.js';
import { GoogleAuthError, authenticateWithGoogle } from '../../services/googleAuthService.js';
import { sendPasswordReset } from '../../services/transactionalEmail.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { user as serializeUser } from '../../serializers/index.js';

/**
 * Authentication surface. Two credential families, one session mechanism.
 *
 * Local email/password and Google Identity Services both end at the same place: a
 * MansooriKart user document and a MansooriKart bearer JWT. Every route below issues that
 * token through `tokenFor` and nothing else, so `requireAuth` remains the only authority
 * that decides who a request belongs to. There is no refresh endpoint and no server-side
 * session: tokens are short-lived and `requireAuth` re-reads the account's role and status
 * on every request, so a suspension takes effect immediately even for a token already in
 * the wild. See `docs/AUTHENTICATION_ARCHITECTURE.md`.
 */

/**
 * Per-purpose rate limits (§17).
 *
 * Separate buckets, because sharing one would let a credential-stuffing run against
 * `/login` exhaust a legitimate user's ability to register or recover a password. Limits
 * are process-local: this is single-instance protection, and a multi-replica deployment
 * needs a shared store to be effective. That limitation is documented rather than papered
 * over with an unused Redis dependency.
 *
 * The buckets are created once, when `createApp` builds this router with the already
 * validated configuration — never inside a request, which `express-rate-limit` rejects
 * outright, and never at import time, which would read the environment before it is set.
 */
type LimiterName = 'register' | 'login' | 'google' | 'recovery';

function buildLimiters(config: BackendConfig): Record<LimiterName, express.RequestHandler> {
  const bucket = () =>
    rateLimit({
      windowMs: config.authRateLimit.windowMs,
      max: config.authRateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (request, response) => sendFailure(response, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.', request.requestId),
    });
  return { register: bucket(), login: bucket(), google: bucket(), recovery: bucket() };
}

const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform(value => value.toLowerCase());

const password = z.string().min(8).max(128);

const tokenFor = (config: BackendConfig, value: { _id: { toString(): string }; role: string; sessionVersion?: number }) =>
  // `jwtExpiresIn` is validated as a duration string by the config schema; the cast names
  // the library's branded string type and asserts nothing about the value.
  jwt.sign({ sub: value._id.toString(), role: value.role, ver: value.sessionVersion ?? 0 }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as NonNullable<jwt.SignOptions['expiresIn']>,
  });

const session = (config: BackendConfig, value: Record<string, any>) => ({
  token: tokenFor(config, value as { _id: { toString(): string }; role: string; sessionVersion?: number }),
  user: serializeUser(value),
});

export function createAuthRouter(config: BackendConfig): express.Router {
  const router = express.Router();
  const limit = buildLimiters(config);

  router.post(
    '/register',
    limit.register,
    validate(z.object({ name: z.string().trim().min(1).max(120), email, password }).strict()),
    async (request, response, next) => {
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
  );
  router.post('/login', limit.login, validate(z.object({ email, password: z.string().min(1).max(128) }).strict()), async (request, response, next) => {
    try {
      const input = request.body as { email: string; password: string };
      const found = await User.findOne({ email: input.email }).select('+password +sessionVersion');

      // `!found.password` is the Google-only account: it has no local credential, so local
      // sign-in is refused with the same generic answer rather than crashing in bcrypt.
      if (!found || found.status !== 'ACTIVE' || !found.password || !(await bcrypt.compare(input.password, found.password)))
        return sendFailure(response, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password.', request.requestId);

      return sendSuccess(response, session(config, found.toObject()));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Google Identity Services sign-in.
   *
   * The body carries exactly one field — the ID token the browser received from Google — and
   * the schema is strict, so a client cannot smuggle `role`, `isAdmin`, `permissions`, `email`
   * or an account id alongside it. Everything the server trusts comes from the verified token
   * or from the database (§9).
   */
  router.post('/google', limit.google, validate(z.object({ credential: z.string().min(1).max(4096) }).strict()), async (request, response, next) => {
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
  });

  router.post('/forgot-password', limit.recovery, validate(z.object({ email }).strict()), async (request, response, next) => {
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
  });
  router.post(
    '/reset-password',
    limit.recovery,
    validate(z.object({ token: z.string().min(32).max(128), password }).strict()),
    async (request, response, next) => {
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
  );
  return router;
}
