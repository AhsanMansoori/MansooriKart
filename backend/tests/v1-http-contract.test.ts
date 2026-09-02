import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
process.env.JWT_SECRET ||= 'v1-test-secret';

const app = createApp();

test('v1 protected Commerce routes require a Bearer JWT and preserve error envelopes', async () => {
  const response = await request(app).get('/api/v1/cart');
  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'AUTH_UNAUTHORIZED');
  assert.ok(response.body.requestId);
});

test('v1 strict Commerce mutation contracts reject authoritative client fields before database access', async () => {
  const response = await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', 'Bearer malformed')
    .send({ productId: '507f1f77bcf86cd799439011', quantity: 1, price: 1 });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_UNAUTHORIZED');
});
