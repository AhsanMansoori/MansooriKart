import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config/env.js';

/**
 * The environment contract (§13, §15, §16).
 *
 * `getConfig` is pure: it reads the object it is handed, so this suite never mutates
 * `process.env` and needs no database. Every case below is a deployment mistake somebody can
 * actually make, and the point of each assertion is that the mistake is caught at startup with
 * a message that names the variable and never repeats its value.
 */
const BASE = { MONGO_URI: 'mongodb://127.0.0.1:27017/mansoorikart_env_test', JWT_SECRET: 'a-development-jwt-signing-value' };
const env = (over: Record<string, string | undefined> = {}) => ({ ...BASE, ...over }) as NodeJS.ProcessEnv;
const prod = (over: Record<string, string | undefined> = {}) =>
  env({ NODE_ENV: 'production', JWT_SECRET: 'production-grade-signing-material-0f8a2c', FRONTEND_URL: 'https://shop.test', ...over });

test('backend configuration is validated on each read, names its failures, and never echoes a value', () => {
  // --- Defaults -------------------------------------------------------------------------
  let config = getConfig(env());
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 5000);
  assert.equal(config.jwtExpiresIn, '15m');
  assert.equal(config.mongoUri, BASE.MONGO_URI);
  assert.deepEqual(config.authRateLimit, { windowMs: 15 * 60 * 1000, max: 100 });
  // Outside production the browser dev servers are trusted; that convenience is not a
  // production default, which the production block below proves.
  assert.deepEqual(config.allowedOrigins, ['http://localhost:3000', 'http://localhost:5173']);
  // The configuration object is the whole contract: no client secret, no SMTP password, no
  // payment credential has any field to arrive in (§6, §15).
  assert.deepEqual(Object.keys(config).sort(), ['allowedOrigins', 'appVersion', 'authRateLimit', 'jwtExpiresIn', 'jwtSecret', 'mongoUri', 'nodeEnv', 'port']);
  assert.equal(config.appVersion, 'unknown');
  assert.equal(getConfig(env({ APP_VERSION: 'phase-i' })).appVersion, 'phase-i');
  assert.ok(!('frontendUrl' in config) && !('googleClientId' in config), 'an absent optional value is absent, not undefined');
  for (const key of Object.keys(config)) assert.ok(key === 'jwtSecret' || !/secret|password|credential/i.test(key), `unexpected credential field ${key}`);

  // A browser-visible variable can never influence the backend, and no client secret is read.
  assert.deepEqual(getConfig(env({ VITE_JWT_SECRET: 'x', VITE_GOOGLE_CLIENT_SECRET: 'y', GOOGLE_CLIENT_SECRET: 'z' })), config);

  // --- Required values ------------------------------------------------------------------
  assert.throws(
    () => getConfig({} as NodeJS.ProcessEnv),
    (error: Error) => /MONGO_URI is required/.test(error.message) && /JWT_SECRET is required/.test(error.message),
    'every problem is reported at once, so a deployment is fixed in one pass'
  );
  for (const blank of ['', '   ']) {
    assert.throws(() => getConfig(env({ MONGO_URI: blank })), /MONGO_URI is required/);
    assert.throws(() => getConfig(env({ JWT_SECRET: blank })), /JWT_SECRET is required/);
  }

  // --- A failure message is safe to paste into a ticket (§32, §33) -----------------------
  const secret = 'unit-test-signing-material-4f3a2b9c';
  assert.throws(
    () => getConfig(env({ JWT_SECRET: secret, PORT: '0' })),
    (error: Error) => error.message.includes('PORT') && !error.message.includes(secret),
    'the rejected configuration is named, never quoted'
  );
  const uri = 'mongodb+srv://appuser:p4ssw0rd@cluster0.mongodb.test/mansoorikart';
  assert.throws(
    () => getConfig(env({ MONGO_URI: uri, JWT_EXPIRES_IN: 'forever' })),
    (error: Error) => error.message.includes('JWT_EXPIRES_IN') && !error.message.includes(uri) && !error.message.includes('p4ssw0rd'),
    'the MongoDB URI never appears in a startup failure'
  );

  // --- Bounded numbers and duration strings ---------------------------------------------
  assert.equal(getConfig(env({ PORT: '' })).port, 5000, 'a blank variable is an absent one');
  assert.equal(getConfig(env({ PORT: '8080' })).port, 8080);
  for (const port of ['0', '-1', '70000', 'abc', '8080.5']) assert.throws(() => getConfig(env({ PORT: port })), /PORT/, port);
  for (const value of ['30m', '1h', '3600s']) assert.equal(getConfig(env({ JWT_EXPIRES_IN: value })).jwtExpiresIn, value);
  for (const value of ['forever', '30', '30x', '48 h', '1h30m', '-5m'])
    assert.throws(() => getConfig(env({ JWT_EXPIRES_IN: value })), /JWT_EXPIRES_IN must look like/, value);
  assert.deepEqual(getConfig(env({ AUTH_RATE_LIMIT_WINDOW_MINUTES: '5', AUTH_RATE_LIMIT_MAX: '7' })).authRateLimit, { windowMs: 5 * 60 * 1000, max: 7 });
  for (const over of [
    { AUTH_RATE_LIMIT_MAX: '0' },
    { AUTH_RATE_LIMIT_MAX: '10001' },
    { AUTH_RATE_LIMIT_WINDOW_MINUTES: '0' },
    { AUTH_RATE_LIMIT_WINDOW_MINUTES: '1441' },
  ])
    assert.throws(() => getConfig(env(over)), /AUTH_RATE_LIMIT/, JSON.stringify(over));

  // --- The public Google client id is optional, and absence disables rather than breaks --
  assert.equal(getConfig(env({ GOOGLE_CLIENT_ID: ' 123-abc.apps.googleusercontent.com ' })).googleClientId, '123-abc.apps.googleusercontent.com');
  assert.ok(!('googleClientId' in getConfig(env({ GOOGLE_CLIENT_ID: '   ' }))));

  // --- Origins: the reset-link base keeps its path, the allowlist compares origins ------
  config = getConfig(env({ FRONTEND_URL: 'https://shop.test/store/' }));
  assert.equal(config.frontendUrl, 'https://shop.test/store', 'a password-reset link is built from the full base');
  assert.ok(config.allowedOrigins.includes('https://shop.test'));
  assert.ok(!config.allowedOrigins.includes('https://shop.test/store'), 'CORS compares origins, so no path may enter the allowlist');
  config = getConfig(
    env({ FRONTEND_URL: 'https://shop.test', CORS_ALLOWED_ORIGINS: ' https://shop.test/ , https://admin.test , , https://api.test:8443/ignored ' })
  );
  assert.deepEqual(config.allowedOrigins, [
    'https://shop.test',
    'https://admin.test',
    'https://api.test:8443',
    'http://localhost:3000',
    'http://localhost:5173',
  ]);
  assert.throws(() => getConfig(env({ CORS_ALLOWED_ORIGINS: 'not-a-url' })), /CORS_ALLOWED_ORIGINS must be an absolute http\(s\) origin/);
  assert.throws(() => getConfig(env({ CORS_ALLOWED_ORIGINS: 'ftp://files.test' })), /CORS_ALLOWED_ORIGINS must use http or https/);
  assert.throws(() => getConfig(env({ FRONTEND_URL: 'javascript:alert(1)' })), /FRONTEND_URL must use http or https/);

  // --- Production is stricter, and being stricter is not optional -----------------------
  config = getConfig(prod());
  assert.equal(config.nodeEnv, 'production');
  assert.deepEqual(config.allowedOrigins, ['https://shop.test'], 'no development origin survives into production');
  assert.equal(config.authRateLimit.max, 10, 'production defaults to the tighter ceiling');
  assert.throws(() => getConfig(prod({ FRONTEND_URL: undefined })), /FRONTEND_URL is required in production/);
  assert.throws(() => getConfig(prod({ JWT_SECRET: 'too-short-for-production' })), /JWT_SECRET must be at least 32 characters in production/);
  const placeholder = 'replace_this_with_a_long_random_production_value';
  assert.throws(
    () => getConfig(prod({ JWT_SECRET: placeholder })),
    (error: Error) => /JWT_SECRET still contains example placeholder text/.test(error.message) && !error.message.includes(placeholder),
    'shipping the example secret is a startup failure, not a warning'
  );
  assert.throws(() => getConfig(prod({ FRONTEND_URL: 'http://shop.test' })), /FRONTEND_URL must use https in production/);
  assert.throws(() => getConfig(prod({ CORS_ALLOWED_ORIGINS: 'http://admin.test' })), /CORS_ALLOWED_ORIGINS must use https in production/);
  // Loopback is the one cleartext exception, so a developer can point a local build at a
  // production-shaped configuration without that exception becoming the production rule.
  config = getConfig(prod({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:3000' }));
  assert.deepEqual(config.allowedOrigins, ['https://shop.test', 'http://localhost:5173', 'http://127.0.0.1:3000']);

  // --- Anything else is development, never accidentally production ----------------------
  assert.equal(getConfig(env({ NODE_ENV: 'test' })).nodeEnv, 'test');
  for (const value of ['staging', 'Production', 'prod']) assert.throws(() => getConfig(env({ NODE_ENV: value })), /NODE_ENV/);
  assert.equal(getConfig(env({ NODE_ENV: '' })).nodeEnv, 'development');
  for (const value of ['0s', '30s', '12h', '7d']) assert.throws(() => getConfig(env({ JWT_EXPIRES_IN: value })), /JWT_EXPIRES_IN/);
  for (const value of ['https://db.test', 'mongodb://', 'mongodb://host with space/db']) assert.throws(() => getConfig(env({ MONGO_URI: value })), /MONGO_URI/);
  assert.throws(() => getConfig(env({ GOOGLE_CLIENT_ID: 'invalid' })), /GOOGLE_CLIENT_ID/);
});

/**
 * The transport the allowlist actually produces (§16).
 *
 * Bearer tokens are sent by our own code, never attached by the browser, so credentialed CORS
 * is off and there is no cookie and no CSRF surface to defend. What still matters is that a
 * foreign origin gets no permission header at all: the request is answered, and the browser
 * refuses to hand the answer to the page that asked. `/api/v1/health` is used because it
 * touches no database.
 */
test('the CORS allowlist admits configured origins only and never enables credentials', async () => {
  const app = createApp(getConfig(env({ FRONTEND_URL: 'https://shop.test', CORS_ALLOWED_ORIGINS: 'https://admin.test' })));

  for (const origin of ['https://shop.test', 'https://admin.test', 'http://localhost:5173']) {
    const res = await request(app).get('/api/v1/health').set('Origin', origin);
    assert.equal(res.status, 200, origin);
    assert.equal(res.headers['access-control-allow-origin'], origin, `${origin} is on the allowlist`);
    assert.equal(res.headers['access-control-allow-credentials'], undefined, 'credentialed CORS stays off');
    assert.match(res.headers.vary ?? '', /Origin/, 'a per-origin answer must not be cached across origins');
  }

  // A foreign origin, a look-alike host, a look-alike suffix, and the same host on the wrong
  // scheme or port are all off the allowlist: matching is exact, not by resemblance.
  for (const origin of ['https://evil.test', 'https://shop.test.evil.test', 'https://notshop.test', 'http://shop.test', 'https://shop.test:8443', 'null']) {
    const res = await request(app).get('/api/v1/health').set('Origin', origin);
    assert.equal(res.status, 200, `${origin} is still answered`);
    assert.equal(res.headers['access-control-allow-origin'], undefined, `${origin} must receive no permission header`);
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  }

  // No wildcard is ever emitted, including to a caller that sends no Origin at all.
  let res = await request(app).get('/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined, 'a non-browser caller is unaffected and ungranted');

  // Preflight: permitted for an allowed origin, silent for anything else.
  res = await request(app).options('/api/v1/auth/login').set('Origin', 'https://shop.test').set('Access-Control-Request-Method', 'POST');
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://shop.test');
  assert.match(res.headers['access-control-allow-methods'] ?? '', /POST/);
  assert.equal(res.headers['access-control-allow-credentials'], undefined);
  res = await request(app).options('/api/v1/auth/login').set('Origin', 'https://evil.test').set('Access-Control-Request-Method', 'POST');
  assert.equal(res.headers['access-control-allow-origin'], undefined, 'a foreign preflight is never granted');
});
