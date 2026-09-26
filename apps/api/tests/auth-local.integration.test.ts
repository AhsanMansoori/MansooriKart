import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/user.js';
import { resetEmailAdapter, setEmailAdapter } from '../src/services/transactionalEmail.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
// Rate limiting is proven in `auth-rate-limit.integration.test.ts`; this suite raises the
// ceiling so the regression matrix below is not truncated by a bucket that proves something else.
process.env.AUTH_RATE_LIMIT_MAX ||= '500';

const app = createApp();
const AUTH = '/api/v1/auth';

/**
 * Local email/password authentication, unchanged by the arrival of Google sign-in (§10).
 *
 * Every route the storefront depends on is exercised end to end against real Mongo: register,
 * log in, use the token on a protected route, be refused an administrative route, recover a
 * password through the delivered reset link, and be stopped when the account is suspended.
 */
test('local credential authentication keeps working alongside Google and leaks nothing', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  // The reset token exists only inside the delivered message, so delivery is captured rather
  // than the token being read out of the database.
  const delivered: Record<string, any>[] = [];
  setEmailAdapter({
    name: 'test-capture',
    async send(message) {
      delivered.push(message as unknown as Record<string, any>);
    },
  });
  try {
    await User.init();

    // --- Registration -------------------------------------------------------------------
    let res = await request(app).post(`${AUTH}/register`).send({ name: 'Ayesha Khan', email: 'Ayesha.Khan@Example.test', password: 'FirstPassword123' });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.email, 'ayesha.khan@example.test', 'the stored email is normalised');
    assert.equal(res.body.data.user.role, 'CUSTOMER');
    assert.equal(res.body.data.user.status, 'ACTIVE');
    for (const forbidden of ['password', 'googleId', 'authProviders', 'passwordResetTokenHash'])
      assert.ok(!(forbidden in res.body.data.user), `registration must not return ${forbidden}`);
    const customerId = res.body.data.user.id;
    const registrationToken = res.body.data.token;

    // A local registration records a local credential and nothing about Google.
    let stored = await User.findById(customerId).select('+password').lean();
    assert.deepEqual(stored.authProviders, ['LOCAL']);
    assert.equal(stored.googleId, undefined);
    assert.ok(stored.password.startsWith('$2'), 'the password is stored as a bcrypt hash');
    assert.notEqual(stored.password, 'FirstPassword123');

    // The registration token is the same MansooriKart bearer JWT login issues.
    const payload = jwt.verify(registrationToken, process.env.JWT_SECRET!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'role', 'sub', 'ver']);
    assert.equal(payload.sub, customerId);
    assert.equal(payload.role, 'CUSTOMER');

    // Duplicate registration is refused, whatever the casing.
    for (const email of ['ayesha.khan@example.test', 'AYESHA.KHAN@EXAMPLE.TEST']) {
      res = await request(app).post(`${AUTH}/register`).send({ name: 'Impostor', email, password: 'AnotherPassword123' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'AUTH_EMAIL_EXISTS');
    }
    assert.equal(await User.countDocuments({}), 1);

    // Registration contracts: weak, oversized and smuggled fields are all rejected.
    for (const body of [
      { name: 'A', email: 'weak@example.test', password: 'short' },
      { name: '', email: 'blank@example.test', password: 'GoodPassword123' },
      { name: 'A', email: 'not-an-email', password: 'GoodPassword123' },
      { name: 'A', email: 'x'.repeat(250) + '@example.test', password: 'GoodPassword123' },
      { email: 'nameless@example.test', password: 'GoodPassword123' },
      { name: 'A', password: 'GoodPassword123' },
    ]) {
      res = await request(app).post(`${AUTH}/register`).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    for (const extra of ['role', 'isAdmin', 'isSuperAdmin', 'permissions', 'status', 'googleId', 'authProviders', 'createdAt', '_id', '$set']) {
      res = await request(app)
        .post(`${AUTH}/register`)
        .send({
          name: 'Escalation',
          email: 'escalation@example.test',
          password: 'GoodPassword123',
          [extra]: extra === '$set' ? { role: 'SUPER_ADMIN' } : 'SUPER_ADMIN',
        });
      assert.equal(res.status, 400, extra);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(await User.countDocuments({}), 1, 'no rejected registration reached the database');

    // --- Login and session compatibility -------------------------------------------------
    res = await request(app).post(`${AUTH}/login`).send({ email: 'ayesha.khan@example.test', password: 'FirstPassword123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.id, customerId);
    const token = res.body.data.token;
    assert.ok(!JSON.stringify(res.body).includes('$2'), 'no password hash may appear in a login response');

    // Wrong password, unknown account and a suspended account are indistinguishable.
    for (const body of [
      { email: 'ayesha.khan@example.test', password: 'WrongPassword123' },
      { email: 'nobody@example.test', password: 'FirstPassword123' },
    ]) {
      res = await request(app).post(`${AUTH}/login`).send(body);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTH_INVALID_CREDENTIALS');
      assert.equal(res.body.error.message, 'Invalid email or password.');
      assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message']);
    }
    for (const extra of ['role', 'isAdmin', 'permissions', 'userId', '$where']) {
      res = await request(app)
        .post(`${AUTH}/login`)
        .send({ email: 'ayesha.khan@example.test', password: 'FirstPassword123', [extra]: '1' });
      assert.equal(res.status, 400, extra);
    }
    // A NoSQL operator in place of a credential is rejected by the schema, not by the driver.
    for (const body of [
      { email: { $ne: null }, password: 'FirstPassword123' },
      { email: 'ayesha.khan@example.test', password: { $ne: null } },
    ]) {
      res = await request(app).post(`${AUTH}/login`).send(body);
      assert.equal(res.status, 400);
      assert.ok(!JSON.stringify(res.body).match(/mongo|cast|stack/i));
    }

    // --- The token satisfies the existing middleware and the existing role rules ----------
    res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, customerId);
    res = await request(app).get('/api/v1/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_UNAUTHORIZED');
    for (const header of [
      '',
      'Bearer',
      'Bearer ',
      `Basic ${token}`,
      'Bearer not.a.jwt',
      `Bearer ${jwt.sign({ sub: customerId, role: 'SUPER_ADMIN' }, 'a-different-secret')}`,
    ]) {
      res = await request(app).get('/api/v1/me').set('Authorization', header);
      assert.equal(res.status, 401, header);
      assert.equal(res.body.error.code, 'AUTH_UNAUTHORIZED');
    }
    // A customer cannot reach an administrative route, and a self-minted SUPER_ADMIN claim
    // cannot either: the role is re-read from the database on every request.
    res = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'AUTH_FORBIDDEN');
    const forgedAdmin = jwt.sign({ sub: customerId, role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    res = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${forgedAdmin}`);
    assert.equal(res.status, 403, 'a forged role claim is overruled by the stored role');

    // --- Password recovery ----------------------------------------------------------------
    const generic = 'If an account exists for that email, a password reset was requested. Email delivery is not yet available.';
    res = await request(app).post(`${AUTH}/forgot-password`).send({ email: 'nobody@example.test' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.message, generic);
    assert.equal(delivered.length, 0, 'no message is sent for an account that does not exist');
    res = await request(app).post(`${AUTH}/forgot-password`).send({ email: 'ayesha.khan@example.test' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.message, generic, 'the answer is identical either way, so it cannot enumerate accounts');
    assert.equal(delivered.length, 1);

    const message = delivered[0]!;
    assert.equal(message.template, 'PASSWORD_RESET');
    assert.equal(message.to, 'ayesha.khan@example.test');
    assert.deepEqual(Object.keys(message).sort(), ['data', 'subject', 'template', 'to']);
    const resetToken = new URL(message.data.resetUrl).searchParams.get('token')!;
    assert.match(resetToken, /^[0-9a-f]{64}$/, 'the delivered token is 32 random bytes in hex');
    // The token reaches the mailbox and nowhere else: not the API response, not the record.
    assert.ok(!JSON.stringify(res.body).includes(resetToken));
    stored = await User.findById(customerId).select('+passwordResetTokenHash').lean();
    assert.notEqual(stored.passwordResetTokenHash, resetToken, 'only a hash of the reset token is stored');
    assert.match(stored.passwordResetTokenHash, /^[0-9a-f]{64}$/);

    for (const body of [
      { token: 'x'.repeat(64), password: 'NextPassword123' },
      { token: resetToken.slice(0, 31), password: 'NextPassword123' },
    ]) {
      res = await request(app).post(`${AUTH}/reset-password`).send(body);
      assert.ok([400].includes(res.status));
      assert.ok(['AUTH_RESET_TOKEN_INVALID', 'VALIDATION_ERROR'].includes(res.body.error.code));
    }
    const resetAttempts = await Promise.all([
      request(app).post(`${AUTH}/reset-password`).send({ token: resetToken, password: 'NextPassword123' }),
      request(app).post(`${AUTH}/reset-password`).send({ token: resetToken, password: 'NextPassword123' }),
    ]);
    assert.equal(resetAttempts.filter(attempt => attempt.status === 200).length, 1, 'exactly one concurrent reset consumes the token');
    assert.equal(resetAttempts.filter(attempt => attempt.status === 400).length, 1);
    assert.equal(resetAttempts.find(attempt => attempt.status === 400)!.body.error.code, 'AUTH_RESET_TOKEN_INVALID');
    res = resetAttempts.find(attempt => attempt.status === 200)!;
    assert.equal(res.body.data.message, 'Your password has been reset. Please sign in.');
    res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401, 'a password reset invalidates every earlier bearer token');

    res = await request(app).post(`${AUTH}/login`).send({ email: 'ayesha.khan@example.test', password: 'FirstPassword123' });
    assert.equal(res.status, 401, 'the previous password stops working');
    res = await request(app).post(`${AUTH}/login`).send({ email: 'ayesha.khan@example.test', password: 'NextPassword123' });
    assert.equal(res.status, 200, 'the new password works');
    const afterReset = res.body.data.token;

    // An expired reset link is refused even though its hash is stored.
    await request(app).post(`${AUTH}/forgot-password`).send({ email: 'ayesha.khan@example.test' });
    const expiring = new URL(delivered[delivered.length - 1]!.data.resetUrl).searchParams.get('token')!;
    await User.updateOne({ _id: customerId }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });
    res = await request(app).post(`${AUTH}/reset-password`).send({ token: expiring, password: 'ExpiredPassword123' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'AUTH_RESET_TOKEN_INVALID');

    // --- Account status is enforced for a live token, not only at sign-in -----------------
    await User.updateOne({ _id: customerId }, { $set: { status: 'SUSPENDED' } });
    res = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${afterReset}`);
    assert.equal(res.status, 401, 'a suspension takes effect immediately for a token already issued');
    res = await request(app).post(`${AUTH}/login`).send({ email: 'ayesha.khan@example.test', password: 'NextPassword123' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_INVALID_CREDENTIALS', 'a suspended account is not told why');
    await User.updateOne({ _id: customerId }, { $set: { status: 'ACTIVE' } });

    // --- The administrator signs in with local credentials only ---------------------------
    const admin = await User.create({
      name: 'Store Owner',
      email: 'owner@example.test',
      password: await bcrypt.hash('AdminPassword123', 12),
      authProviders: ['LOCAL'],
      role: 'SUPER_ADMIN',
    });
    res = await request(app).post(`${AUTH}/login`).send({ email: 'owner@example.test', password: 'AdminPassword123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.role, 'SUPER_ADMIN');
    assert.equal((jwt.verify(res.body.data.token, process.env.JWT_SECRET!) as { role: string }).role, 'SUPER_ADMIN');
    res = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${res.body.data.token}`);
    assert.equal(res.status, 200, 'the administrator still reaches administrative routes');
    assert.equal(String(admin.role), 'SUPER_ADMIN');

    // --- Malformed transport stays a safe 4xx ---------------------------------------------
    res = await request(app).post(`${AUTH}/login`).set('Content-Type', 'application/json').send('{"email":');
    assert.ok(res.status >= 400 && res.status < 500, `malformed JSON answered ${res.status}`);
    assert.ok(!JSON.stringify(res.body).match(/stack|SyntaxError|node_modules|body-parser/i), 'a parser failure reveals nothing');
    res = await request(app).post(`${AUTH}/register`).send({});
    assert.equal(res.status, 400);
    assert.ok(!JSON.stringify(res.body).match(/stack|mongoose|node_modules/i));
  } finally {
    resetEmailAdapter();
    await mongoose.disconnect();
    await mongo.stop();
  }
});
