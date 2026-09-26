import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Product } from '../src/models/product.js';
import { Review } from '../src/models/review.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('review duplicate race, admin controls and strict review contracts are safe', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, admin] = await User.create([
      { name: 'A', email: 'a@review-close.test', password: 'x', role: 'CUSTOMER' },
      { name: 'S', email: 's@review-close.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const at = jwt.sign({ sub: String(a._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!),
      p = await Product.create({ name: 'P', description: 'x', price: 1, category: 'x', image: 'https://e/p', stock: 1, status: 'ACTIVE' });
    await Review.init();
    const indexes = await Review.collection.indexes();
    assert.ok(indexes.some((x: any) => x.unique && x.key.customer === 1 && x.key.product === 1));
    const create = (body: any) => request(app).post(`/api/v1/products/${p._id}/reviews`).set('Authorization', `Bearer ${at}`).send(body);
    const [x, y] = await Promise.all([create({ rating: 5, title: 'One', body: 'first review' }), create({ rating: 1, title: 'Two', body: 'second review' })]);
    assert.equal([x.status, y.status].filter(v => v === 201).length, 1);
    assert.equal([x.status, y.status].filter(v => v === 409).length, 1);
    const r = await Review.findOne({ product: p._id, customer: a._id }).lean(),
      product = await Product.findById(p._id).lean();
    assert.equal(await Review.countDocuments({ product: p._id, customer: a._id }), 1);
    assert.equal(product.ratingCount, 1);
    assert.equal(product.ratingAverage, r.rating);
    let q = await request(app).get('/api/v1/admin/reviews');
    assert.equal(q.status, 401);
    q = await request(app).get('/api/v1/admin/reviews').set('Authorization', `Bearer ${at}`);
    assert.equal(q.status, 403);
    q = await request(app)
      .get('/api/v1/admin/reviews?page=1&limit=1&status=PUBLISHED&rating=' + r.rating + '&product=' + p._id + '&verifiedPurchase=false')
      .set('Authorization', `Bearer ${st}`);
    assert.equal(q.status, 200);
    assert.equal(q.body.meta.limit, 1);
    q = await request(app).patch(`/api/v1/admin/reviews/${r._id}/status`).set('Authorization', `Bearer ${at}`).send({ status: 'HIDDEN', reason: 'no access' });
    assert.equal(q.status, 403);
    assert.equal((await Review.findById(r._id).lean()).status, 'PUBLISHED');
    assert.equal(await AuditLog.countDocuments({ resourceId: String(r._id), action: 'REVIEW_MODERATED' }), 0);
    for (const field of ['customer', 'product', 'status', 'verifiedPurchase', 'moderatedBy', '$set', '$inc', '$where', 'constructor', 'prototype']) {
      q = await create({ rating: 5, body: 'safe text', [field]: field === '$set' ? { status: 'HIDDEN' } : 'spoof' });
      assert.equal(q.status, 400);
    }
    q = await request(app).patch(`/api/v1/reviews/${r._id}`).set('Authorization', `Bearer ${at}`).send({ rating: 5, body: 'safe text', status: 'HIDDEN' });
    assert.equal(q.status, 400);
    q = await request(app).post('/api/v1/products/bad/reviews').set('Authorization', `Bearer ${at}`).send({ rating: 5, body: 'safe text' });
    assert.equal(q.status, 400);
    assert.ok(!JSON.stringify(q.body).match(/mongoose|casterror|stack/i));
    const inactive = await Product.create({ name: 'D', description: 'x', price: 1, category: 'x', image: 'https://e/d', stock: 1, status: 'DRAFT' });
    q = await request(app).post(`/api/v1/products/${inactive._id}/reviews`).set('Authorization', `Bearer ${at}`).send({ rating: 5, body: 'safe text' });
    assert.equal(q.status, 404);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
