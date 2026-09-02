const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/user');
const { sendPasswordReset } = require('../services/email/emailService');

const router = express.Router();
const genericResetMessage = 'If an account exists for that email, password reset instructions have been sent.';
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }),
});
const validationError = (res, errors) => res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: errors.array()[0].msg } });
const issueToken = user => jwt.sign({ user: { id: user.id, role: user.role } }, process.env.JWT_SECRET, { expiresIn: '48h' });

router.post(
  '/register',
  authLimiter,
  [
    check('name', 'Name is required').trim().notEmpty(),
    check('email', 'Please include a valid email').isEmail().normalizeEmail(),
    check('password', 'Please enter a password with 8 or more characters').isLength({ min: 8 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return validationError(res, errors);
    try {
      const { name, email, password } = req.body;
      if (await User.findOne({ email }))
        return res.status(409).json({ success: false, error: { code: 'AUTH_EMAIL_EXISTS', message: 'An account already exists for this email.' } });
      const user = new User({ name, email, password: await bcrypt.hash(password, 12), role: 'CUSTOMER' });
      await user.save();
      return res
        .status(201)
        .json({ success: true, data: { token: issueToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/login',
  authLimiter,
  [check('email', 'Please include a valid email').isEmail().normalizeEmail(), check('password', 'Password is required').notEmpty()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return validationError(res, errors);
    try {
      const user = await User.findOne({ email: req.body.email });
      if (!user || !(await bcrypt.compare(req.body.password, user.password)))
        return res.status(401).json({ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      return res.json({ success: true, data: { token: issueToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
    } catch (error) {
      return next(error);
    }
  }
);

router.post('/forgot-password', authLimiter, [check('email').isEmail().normalizeEmail()], async (req, res, next) => {
  try {
    const user = validationResult(req).isEmpty()
      ? await User.findOne({ email: req.body.email }).select('+passwordResetTokenHash +passwordResetExpiresAt')
      : null;
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      await sendPasswordReset({ email: user.email, resetUrl: `${baseUrl.replace(/\/$/, '')}/reset-password?token=${token}` });
    }
    return res.json({ success: true, data: { message: genericResetMessage } });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/reset-password',
  authLimiter,
  [
    check('token', 'A reset token is required').isString().isLength({ min: 32, max: 128 }),
    check('password', 'Please enter a password with 8 or more characters').isLength({ min: 8 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return validationError(res, errors);
    try {
      const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
      const user = await User.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } }).select(
        '+passwordResetTokenHash +passwordResetExpiresAt'
      );
      if (!user)
        return res
          .status(400)
          .json({ success: false, error: { code: 'AUTH_RESET_TOKEN_INVALID', message: 'This password reset link is invalid or has expired.' } });
      user.password = await bcrypt.hash(req.body.password, 12);
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpiresAt = undefined;
      user.passwordChangedAt = new Date();
      await user.save();
      return res.json({ success: true, data: { message: 'Your password has been reset. Please sign in.' } });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
