const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../models/user');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('../services/email/emailService', () => ({ sendPasswordReset: jest.fn() }));

const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendPasswordReset } = require('../services/email/emailService');
const authRouter = require('../routes/auth');

describe('Phase 1 authentication contracts', () => {
  let app;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    User.findOne = jest.fn();
    User.prototype.save = jest.fn().mockResolvedValue();
    User.mockImplementation(function UserDocument(data) {
      Object.assign(this, data);
      this.id = 'user-id';
      this.save = jest.fn().mockResolvedValue();
    });
    bcrypt.hash.mockResolvedValue('hashed-password');
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('signed-token');
  });
  it('registers only CUSTOMER and omits password', async () => {
    User.findOne.mockResolvedValue(null);
    const response = await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@example.com', password: 'password123', role: 'SUPER_ADMIN' });
    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe('CUSTOMER');
    expect(response.body.data.user.password).toBeUndefined();
  });
  it('returns standardized invalid credential errors', async () => {
    User.findOne.mockResolvedValue(null);
    const response = await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'password123' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
  it('returns the same generic reset response for known and unknown accounts', async () => {
    const known = { email: 'a@example.com', save: jest.fn().mockResolvedValue() };
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(known) }).mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) });
    const one = await request(app).post('/api/auth/forgot-password').send({ email: 'a@example.com' });
    const two = await request(app).post('/api/auth/forgot-password').send({ email: 'n@example.com' });
    expect(one.body).toEqual(two.body);
    expect(one.body.data.token).toBeUndefined();
    expect(known.passwordResetTokenHash).toHaveLength(64);
    expect(known.passwordResetExpiresAt).toBeInstanceOf(Date);
    expect(sendPasswordReset).toHaveBeenCalled();
  });
  it('invalidates a used reset token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const user = { save: jest.fn().mockResolvedValue() };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValueOnce(user).mockResolvedValueOnce(null) });
    const first = await request(app).post('/api/auth/reset-password').send({ token, password: 'newpassword123' });
    const second = await request(app).post('/api/auth/reset-password').send({ token, password: 'newpassword123' });
    expect(first.status).toBe(200);
    expect(user.passwordResetTokenHash).toBeUndefined();
    expect(second.body.error.code).toBe('AUTH_RESET_TOKEN_INVALID');
  });
});
