import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { BackendConfig } from '../../../config/env.js';
import {
  forgotPasswordHandler,
  googleAuthHandler,
  loginHandler,
  registerHandler,
  resetPasswordHandler,
} from '../../../controllers/storefront/authController.js';
import { validate } from '../../../middleware/validate.js';
import { sendFailure } from '../../../utils/api-response.js';

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

export function createAuthRouter(config: BackendConfig): express.Router {
  const router = express.Router();
  const limit = buildLimiters(config);

  router.post('/register', limit.register, validate(z.object({ name: z.string().trim().min(1).max(120), email, password }).strict()), (req, res, next) =>
    registerHandler(config, req, res, next)
  );
  router.post('/login', limit.login, validate(z.object({ email, password: z.string().min(1).max(128) }).strict()), (req, res, next) =>
    loginHandler(config, req, res, next)
  );
  router.post('/google', limit.google, validate(z.object({ credential: z.string().min(1).max(4096) }).strict()), (req, res, next) =>
    googleAuthHandler(config, req, res, next)
  );
  router.post('/forgot-password', limit.recovery, validate(z.object({ email }).strict()), (req, res, next) => forgotPasswordHandler(config, req, res, next));
  router.post('/reset-password', limit.recovery, validate(z.object({ token: z.string().min(32).max(128), password }).strict()), resetPasswordHandler);

  return router;
}
