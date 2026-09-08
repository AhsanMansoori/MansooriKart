import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config/env.js';
import { User } from '../src/models/user.js';
import { resetEmailAdapter, setEmailAdapter } from '../src/services/transactionalEmail.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';

const CEILING = 3;
const AUTH = '/api/v1/auth';
const PASSWORD = 'RatePassword123';
const EMAIL = 'rate.customer@example.test';

/**
 * Authentication rate limiting (§17).
 *
 * The ceiling is lowered by building this suite's applications from an explicit environment
 * rather than by reaching inside the router: the limits are part of the validated
 * configuration, so that is where a test should set them. Nothing global is mutated, which is
 * why the other authentication suites keep their own raised ceiling.
 */
const configure = () => getConfig({ ...process.env, AUTH_RATE_LIMIT_MAX: String(CEILING), AUTH_RATE_LIMIT_WINDOW_MINUTES: '15' });

/** A throttled answer is still a MansooriKart error envelope and still says nothing useful. */
const assertThrottled = (res: { status: number; body: Record<string, any> }, label: string) => {
  assert.equal(res.status, 429, label);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.equal(res.body.error.message, 'Too many requests. Please try again later.');
  assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message']);
  assert.ok(!JSON.stringify(res.body).match(/stack|mongo|node_modules|express-rate-limit|windowMs/i), `${label} leaked internals`);
};

test('authentication rate limits are per purpose, per process, and count every attempt', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  setEmailAdapter({ name: 'test-sink', async send() {} });
  try {
    await User.init();
    const config = configure();
    assert.equal(config.authRateLimit.max, CEILING, 'the ceiling under test comes from the configuration');
    assert.equal(config.authRateLimit.windowMs, 15 * 60 * 1000);
    const app = createApp(config);
    await User.create({ name: 'Rate Customer', email: EMAIL, password: await bcrypt.hash(PASSWORD, 12), authProviders: ['LOCAL'], role: 'CUSTOMER' });

    // --- The login bucket ------------------------------------------------------------------
    for (let attempt = 1; attempt <= CEILING; attempt += 1) {
      const res = await request(app).post(`${AUTH}/login`).send({ email: EMAIL, password: 'WrongPassword123' });
      assert.equal(res.status, 401, `attempt ${attempt} is inside the window`);
      assert.equal(res.headers['ratelimit-limit'], String(CEILING));
      assert.equal(res.headers['ratelimit-remaining'], String(CEILING - attempt));
      assert.equal(res.headers['x-ratelimit-limit'], undefined, 'legacy headers are disabled');
    }
    // The limiter sits in front of the credential check, so a correct password is refused too.
    // That is the deliberate trade: a flood cannot be aimed at one account's password.
    let res = await request(app).post(`${AUTH}/login`).send({ email: EMAIL, password: PASSWORD });
    assertThrottled(res, 'the attempt after the ceiling');
    assert.ok(res.headers['retry-after'], 'a throttled client is told when to come back');
    res = await request(app).post(`${AUTH}/login`).send({ email: EMAIL, password: PASSWORD });
    assertThrottled(res, 'the bucket stays closed for the rest of the window');

    // --- The buckets are separate, so one flood cannot lock the others out -----------------
    // One slot is spent in each of the other three buckets here, and each is exhausted below.
    res = await request(app).post(`${AUTH}/register`).send({ name: 'Registrant', email: 'registrant@example.test', password: 'GoodPassword123' });
    assert.equal(res.status, 201, 'an exhausted login bucket must not block registration');
    res = await request(app).post(`${AUTH}/forgot-password`).send({ email: EMAIL });
    assert.equal(res.status, 200, 'an exhausted login bucket must not block password recovery');
    res = await request(app).post(`${AUTH}/google`).send({ credential: 'hdr.payload.signature' });
    assert.notEqual(res.status, 429, 'an exhausted login bucket must not block Google sign-in');

    // --- The Google bucket counts rejected bodies, so garbage buys no extra attempts -------
    for (let attempt = 2; attempt <= CEILING; attempt += 1) {
      res = await request(app).post(`${AUTH}/google`).send({});
      assert.equal(res.status, 400, `google attempt ${attempt}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    assertThrottled(await request(app).post(`${AUTH}/google`).send({}), 'the google bucket');

    // --- The registration bucket refuses before it writes ---------------------------------
    for (let attempt = 2; attempt <= CEILING; attempt += 1) {
      res = await request(app)
        .post(`${AUTH}/register`)
        .send({ name: 'Registrant', email: `registrant${attempt}@example.test`, password: 'GoodPassword123' });
      assert.equal(res.status, 201, `register attempt ${attempt}`);
    }
    const before = await User.countDocuments({});
    assertThrottled(
      await request(app).post(`${AUTH}/register`).send({ name: 'Blocked', email: 'blocked@example.test', password: 'GoodPassword123' }),
      'the register bucket'
    );
    assert.equal(await User.countDocuments({}), before, 'a throttled registration reaches no database write');

    // --- Recovery is one bucket across both of its routes ---------------------------------
    // Deliberate: the two routes are halves of one flow, so spreading a flood across them
    // must not double the budget.
    for (let attempt = 2; attempt <= CEILING; attempt += 1) {
      res = await request(app).post(`${AUTH}/forgot-password`).send({ email: EMAIL });
      assert.equal(res.status, 200, `recovery attempt ${attempt}`);
    }
    assertThrottled(
      await request(app)
        .post(`${AUTH}/reset-password`)
        .send({ token: 'a'.repeat(64), password: 'GoodPassword123' }),
      'the shared recovery bucket'
    );

    // --- Nothing outside the authentication router is throttled ---------------------------
    for (let attempt = 0; attempt < CEILING + 3; attempt += 1) {
      assert.equal((await request(app).get('/api/v1/health')).status, 200);
      assert.equal((await request(app).get('/api/v1/me')).status, 401, 'the buckets guard credentials, not every 401');
    }

    // --- The limits are process-local, which is the documented deployment limitation ------
    // A second application object is what a second replica behaves like: its own counters,
    // sharing nothing. This is why `docs/ENVIRONMENT_CONFIGURATION.md` records that
    // multi-replica protection needs a shared store, rather than implying it exists.
    const replica = createApp(configure());
    res = await request(replica).post(`${AUTH}/login`).send({ email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 200, 'a fresh process starts with a fresh bucket');
    // A success is still an attempt: valid credentials cannot launder a stuffing run.
    for (let attempt = 2; attempt <= CEILING; attempt += 1) {
      res = await request(replica).post(`${AUTH}/login`).send({ email: EMAIL, password: PASSWORD });
      assert.equal(res.status, 200, `successful login ${attempt}`);
    }
    assertThrottled(await request(replica).post(`${AUTH}/login`).send({ email: EMAIL, password: PASSWORD }), 'successful logins consume the budget');
  } finally {
    resetEmailAdapter();
    await mongoose.disconnect();
    await mongo.stop();
  }
});
