import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { User } from '../src/models/user.js';
import { resetGoogleTokenDecoder, setGoogleTokenDecoder, type GoogleTokenClaims } from '../src/services/googleIdentity.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
process.env.GOOGLE_CLIENT_ID ||= 'mansoorikart-test-client.apps.googleusercontent.com';
// Rate limiting has its own suite (`auth-rate-limit.integration.test.ts`). Raising the ceiling
// here keeps this matrix from being truncated by a bucket that proves something else.
process.env.AUTH_RATE_LIMIT_MAX ||= '500';

const AUDIENCE = process.env.GOOGLE_CLIENT_ID;
const app = createApp();
const GOOGLE = '/api/v1/auth/google';

/**
 * Deterministic stand-in for Google's signature check (§12: the automated suite never talks
 * to Google). Only the network step is replaced; every claim rule under test is the real
 * implementation in `src/services/googleIdentity.ts`.
 */
const registry = new Map<string, GoogleTokenClaims | null>();
const rejected = new Set<string>();
const audiencesSeen: string[] = [];
let issued = 0;

setGoogleTokenDecoder(async (credential, audience) => {
  audiencesSeen.push(audience);
  // Deliberately internals-flavoured, so the leak assertions below have something to catch.
  if (rejected.has(credential))
    throw new Error('Wrong recipient, payload audience != requiredAudience; kid=abc123 certs=https://www.googleapis.com/oauth2/v1/certs');
  return registry.get(credential) ?? null;
});

const claims = (over: Partial<GoogleTokenClaims> = {}): GoogleTokenClaims => ({
  iss: 'https://accounts.google.com',
  aud: AUDIENCE,
  sub: '110000000000000000001',
  email: 'google.newcomer@example.test',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
  name: 'Google Newcomer',
  ...over,
});

/** Mints a credential shaped like a compact JWS and records what it decodes to. */
const credential = (payload: GoogleTokenClaims | null, options: { rejectSignature?: boolean } = {}): string => {
  const value = `hdr${++issued}.payload${issued}.signature${issued}`;
  if (options.rejectSignature) rejected.add(value);
  registry.set(value, payload);
  return value;
};

const post = (value: unknown) =>
  request(app)
    .post(GOOGLE)
    .send(value as object);

/** Google account resolution audits as a fire-and-forget side effect; wait for it, bounded. */
const waitForAudit = async (action: string): Promise<Record<string, any> | null> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const entry = await AuditLog.findOne({ action }).lean();
    if (entry) return entry;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return null;
};

/** Nothing a Google failure produces may reach the client (§11, §32). */
const assertSafeFailure = (body: Record<string, any>, code: string) => {
  assert.equal(body.success, false);
  assert.equal(body.error.code, code);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  const serialised = JSON.stringify(body);
  for (const leak of ['stack', 'mongoose', 'MongoServerError', 'kid=', 'certs', 'googleapis.com', 'signature', 'payload', 'E11000', AUDIENCE]) {
    assert.ok(!serialised.includes(leak), `${code} response leaked ${leak}`);
  }
};

test('Google sign-in resolves to one MansooriKart customer and can never reach an administrator', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    // The uniqueness invariant must exist before the first write, not eventually (§31).
    await User.init();
    const indexes = await User.collection.indexes();
    assert.ok(
      indexes.some((index: Record<string, any>) => index.key?.googleId === 1 && index.unique === true),
      'a unique googleId index must be present before any Google account is created'
    );

    // --- Deployment not configured for Google at all -------------------------------------
    delete process.env.GOOGLE_CLIENT_ID;
    let res = await post({ credential: credential(claims()) });
    assert.equal(res.status, 503);
    assertSafeFailure(res.body, 'GOOGLE_AUTH_UNAVAILABLE');
    process.env.GOOGLE_CLIENT_ID = AUDIENCE;

    // --- Request contract ---------------------------------------------------------------
    for (const body of [{}, { credential: '' }, { credential: 'x'.repeat(4097) }, { credential: 123 }, { credential: null }]) {
      res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    // A client may not smuggle authority alongside the credential (§9).
    for (const extra of ['role', 'isAdmin', 'isSuperAdmin', 'permissions', 'email', 'userId', 'id', 'status', 'authProviders', 'googleId']) {
      res = await post({ credential: credential(claims()), [extra]: extra === 'permissions' ? ['*'] : 'SUPER_ADMIN' });
      assert.equal(res.status, 400, extra);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(await User.countDocuments({}), 0, 'a rejected request must not create an account');

    // --- Token verification: shape, signature, issuer, audience, expiry, subject, email ---
    for (const malformed of ['not-a-jwt', 'only.two', 'has spaces.in.it', 'a.b.c.d', '..']) {
      res = await post({ credential: malformed });
      assert.equal(res.status, 401, malformed);
      assertSafeFailure(res.body, 'GOOGLE_TOKEN_INVALID');
    }
    const unverifiable = [
      ['signature rejected by Google', credential(claims(), { rejectSignature: true })],
      ['no claims at all', credential(null)],
      ['foreign issuer', credential(claims({ iss: 'https://accounts.evil.test' }))],
      ['absent issuer', credential(claims({ iss: undefined }))],
      ['audience of another application', credential(claims({ aud: 'someone-else.apps.googleusercontent.com' }))],
      ['audience array without this client', credential(claims({ aud: ['a.apps.googleusercontent.com', 'b.apps.googleusercontent.com'] }))],
      ['absent audience', credential(claims({ aud: undefined }))],
      ['expired token', credential(claims({ exp: Math.floor(Date.now() / 1000) - 30 }))],
      ['absent expiry', credential(claims({ exp: undefined }))],
      ['blank subject', credential(claims({ sub: '   ' }))],
      ['absent subject', credential(claims({ sub: undefined }))],
      ['oversized subject', credential(claims({ sub: '9'.repeat(256) }))],
      ['unparseable email', credential(claims({ email: 'not-an-email' }))],
      ['absent email', credential(claims({ email: undefined }))],
    ] as const;
    for (const [label, value] of unverifiable) {
      res = await post({ credential: value });
      assert.equal(res.status, 401, label);
      assertSafeFailure(res.body, 'GOOGLE_TOKEN_INVALID');
    }
    // An unverified Google email proves control of a Google account, not of the mailbox (§8).
    for (const emailVerified of [false, 'false', undefined, 'yes', 1]) {
      res = await post({ credential: credential(claims({ email_verified: emailVerified as never })) });
      assert.equal(res.status, 403, String(emailVerified));
      assertSafeFailure(res.body, 'GOOGLE_EMAIL_UNVERIFIED');
    }
    assert.equal(await User.countDocuments({}), 0, 'no unverifiable credential may create an account');
    // The audience handed to Google is always this deployment's configured client id.
    assert.deepEqual([...new Set(audiencesSeen)], [AUDIENCE]);

    // --- Case A: unknown subject, unknown email -> a new CUSTOMER --------------------------
    const newcomerSubject = '110000000000000000001';
    res = await post({ credential: credential(claims({ picture: 'https://lh3.googleusercontent.com/a/portrait' })) });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.outcome, 'CREATED');
    assert.equal(res.body.data.provider, 'GOOGLE');
    assert.equal(res.body.data.user.role, 'CUSTOMER');
    assert.equal(res.body.data.user.status, 'ACTIVE');
    assert.equal(res.body.data.user.email, 'google.newcomer@example.test');
    for (const forbidden of ['password', 'googleId', 'authProviders', 'passwordResetTokenHash', 'passwordChangedAt'])
      assert.ok(!(forbidden in res.body.data.user), `the serialized user must not expose ${forbidden}`);

    // The issued token is a MansooriKart JWT and nothing else: no Google token is handed back.
    const created = await User.findOne({ email: 'google.newcomer@example.test' }).select('+password').lean();
    const payload = jwt.verify(res.body.data.token, process.env.JWT_SECRET!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'role', 'sub', 'ver']);
    assert.equal(payload.sub, String(created._id));
    assert.equal(payload.role, 'CUSTOMER');
    assert.ok(!JSON.stringify(res.body).includes('signature'), 'no Google credential material may be echoed');
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.data.token}`);
    assert.equal(me.status, 200, 'the Google token must satisfy the existing auth middleware');
    assert.equal(me.body.data.email, 'google.newcomer@example.test');

    assert.equal(created.password, undefined, 'a Google-only account carries no password hash');
    assert.equal(created.googleId, newcomerSubject);
    assert.deepEqual(created.authProviders, ['GOOGLE']);
    assert.equal(created.avatar, 'https://lh3.googleusercontent.com/a/portrait');
    assert.equal(await User.countDocuments({}), 1);

    const audit = await waitForAudit('AUTH_GOOGLE_ACCOUNT_CREATED');
    assert.ok(audit, 'account creation through Google is audited');
    assert.deepEqual(audit.metadata, { provider: 'GOOGLE' });
    assert.ok(!JSON.stringify(audit).includes(newcomerSubject), 'the audit trail records the provider, never the Google subject');

    // A Google-only account has no local credential: refused, not crashed (§10).
    res = await request(app).post('/api/v1/auth/login').send({ email: 'google.newcomer@example.test', password: 'whatever-password' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_INVALID_CREDENTIALS');

    // --- Case B: known subject -> the same account, unmodified ----------------------------
    res = await post({ credential: credential(claims({ name: 'Renamed In Google', picture: 'https://lh3.googleusercontent.com/a/other' })) });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.outcome, 'RETURNING');
    assert.equal(res.body.data.user.id, String(created._id));
    assert.equal(await User.countDocuments({}), 1, 'a returning Google sign-in creates nothing');
    assert.equal((await User.findById(created._id).lean()).name, 'Google Newcomer', 'Google may not overwrite stored profile fields');
    assert.equal(await AuditLog.countDocuments({ action: 'AUTH_GOOGLE_ACCOUNT_CREATED' }), 1);

    // --- Case C: unknown subject, existing local account, same verified email -> link ------
    const localHash = await bcrypt.hash('LocalPassword123', 12);
    const localCustomer = await User.create({
      name: 'Local Customer',
      email: 'local.customer@example.test',
      password: localHash,
      authProviders: ['LOCAL'],
      role: 'CUSTOMER',
    });
    const linkedSubject = '110000000000000000002';
    res = await post({ credential: credential(claims({ sub: linkedSubject, email: 'local.customer@example.test', name: 'Local Customer' })) });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.outcome, 'LINKED');
    assert.equal(res.body.data.user.id, String(localCustomer._id));
    let stored = await User.findById(localCustomer._id).select('+password').lean();
    assert.equal(stored.googleId, linkedSubject);
    assert.deepEqual([...stored.authProviders].sort(), ['GOOGLE', 'LOCAL']);
    assert.equal(stored.password, localHash, 'linking must not disturb the existing local credential');
    assert.equal(stored.role, 'CUSTOMER');
    assert.ok(await waitForAudit('AUTH_GOOGLE_ACCOUNT_LINKED'));
    // Both credential families still reach the same account.
    res = await request(app).post('/api/v1/auth/login').send({ email: 'local.customer@example.test', password: 'LocalPassword123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.id, String(localCustomer._id));

    // --- Case D: a second Google identity may not claim a linked account ------------------
    res = await post({ credential: credential(claims({ sub: '110000000000000000003', email: 'local.customer@example.test' })) });
    assert.equal(res.status, 409);
    assertSafeFailure(res.body, 'GOOGLE_ACCOUNT_CONFLICT');
    assert.equal((await User.findById(localCustomer._id).lean()).googleId, linkedSubject, 'the original link survives a conflicting attempt');
    assert.equal(await User.countDocuments({}), 2);

    // --- Case E: a suspension is not bypassable through Google ----------------------------
    const suspended = await User.create({
      name: 'Suspended Customer',
      email: 'suspended.customer@example.test',
      password: localHash,
      role: 'CUSTOMER',
      status: 'SUSPENDED',
    });
    res = await post({ credential: credential(claims({ sub: '110000000000000000004', email: 'suspended.customer@example.test' })) });
    assert.equal(res.status, 403);
    assertSafeFailure(res.body, 'AUTH_ACCOUNT_SUSPENDED');
    assert.equal((await User.findById(suspended._id).lean()).googleId, undefined, 'a suspended account is never linked');
    // Suspension also stops an account that was already linked.
    await User.updateOne({ _id: localCustomer._id }, { $set: { status: 'SUSPENDED' } });
    res = await post({ credential: credential(claims({ sub: linkedSubject, email: 'local.customer@example.test' })) });
    assert.equal(res.status, 403);
    assertSafeFailure(res.body, 'AUTH_ACCOUNT_SUSPENDED');
    await User.updateOne({ _id: localCustomer._id }, { $set: { status: 'ACTIVE' } });

    // --- Case F: administrative access is local credentials only (§9) ----------------------
    const admin = await User.create({
      name: 'Store Owner',
      email: 'owner@example.test',
      password: localHash,
      authProviders: ['LOCAL'],
      role: 'SUPER_ADMIN',
    });
    res = await post({ credential: credential(claims({ sub: '110000000000000000005', email: 'owner@example.test' })) });
    assert.equal(res.status, 403);
    assertSafeFailure(res.body, 'GOOGLE_SIGN_IN_NOT_PERMITTED');
    stored = await User.findById(admin._id).lean();
    assert.equal(stored.role, 'SUPER_ADMIN', 'the Super Admin is left exactly as it was');
    assert.equal(stored.googleId, undefined, 'the Super Admin is never silently linked');
    assert.deepEqual(stored.authProviders, ['LOCAL']);
    assert.equal(await AuditLog.countDocuments({ action: 'AUTH_GOOGLE_ACCOUNT_LINKED' }), 1, 'a refused link writes no audit entry');

    // Claims are data, not authority: extra fields inside the verified token grant nothing.
    res = await post({
      credential: credential({
        ...claims({ sub: '110000000000000000006', email: 'claims.escalation@example.test', name: 'Claims Escalation' }),
        role: 'SUPER_ADMIN',
        isAdmin: true,
        isSuperAdmin: true,
        permissions: ['*'],
        status: 'ACTIVE',
        hd: 'example.test',
      } as GoogleTokenClaims),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.outcome, 'CREATED');
    assert.equal(res.body.data.user.role, 'CUSTOMER');
    stored = await User.findOne({ email: 'claims.escalation@example.test' }).lean();
    assert.equal(stored.role, 'CUSTOMER', 'a Google claim cannot promote an account');
    assert.equal(await User.countDocuments({ role: 'SUPER_ADMIN' }), 1, 'exactly one administrator exists, the one created locally');

    // --- Duplicate prevention is the database's job, not the service's ---------------------
    await assert.rejects(
      () => User.create({ name: 'Impostor', email: 'impostor@example.test', googleId: linkedSubject, authProviders: ['GOOGLE'], role: 'CUSTOMER' }),
      (error: { code?: number }) => error.code === 11000,
      'a second account may not claim an existing Google subject'
    );
    // A partial index, so several accounts without a Google identity remain legal.
    await User.create({ name: 'No Google A', email: 'nogoogle.a@example.test', password: localHash, role: 'CUSTOMER' });
    await User.create({ name: 'No Google B', email: 'nogoogle.b@example.test', password: localHash, role: 'CUSTOMER' });

    // --- Concurrent first sign-in creates exactly one account -----------------------------
    const raceSubject = '110000000000000000007';
    const raceClaims = claims({ sub: raceSubject, email: 'race.customer@example.test', name: 'Race Customer' });
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => post({ credential: credential(raceClaims) })));
    assert.deepEqual(
      responses.map(response => response.status),
      [200, 200, 200, 200, 200]
    );
    const ids = new Set(responses.map(response => response.body.data.user.id));
    assert.equal(ids.size, 1, 'every concurrent winner and loser resolves to the same account');
    assert.equal(await User.countDocuments({ email: 'race.customer@example.test' }), 1);
    assert.equal(await User.countDocuments({ googleId: raceSubject }), 1);
    assert.equal(responses.filter(response => response.body.data.outcome === 'CREATED').length, 1, 'exactly one response reports a creation');
  } finally {
    resetGoogleTokenDecoder();
    await mongoose.disconnect();
    await mongo.stop();
  }
});
