import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { Review } from '../src/models/review.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('reviews are strict, owner-scoped, aggregate-safe and moderatable', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, b, admin] = await User.create([
      { name: 'A', email: 'a@review.test', password: 'x', role: 'CUSTOMER' },
      { name: 'B', email: 'b@review.test', password: 'x', role: 'CUSTOMER' },
      { name: 'S', email: 's@review.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const at = jwt.sign({ sub: String(a._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      bt = jwt.sign({ sub: String(b._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const p = await Product.create({ name: 'P', description: 'x', price: 1, category: 'x', image: 'https://e/p', stock: 1, status: 'ACTIVE' });
    await Order.create({
      customer: a._id,
      orderNumber: 'MK-REVIEW-1',
      idempotencyKey: 'review-order-1',
      items: [{ productId: p._id, name: 'P', unitPrice: 1, quantity: 1, lineSubtotal: 1 }],
      shippingAddress: { fullName: 'A', phone: '1', addressLine1: 'x', city: 'c', country: 'PK' },
      subtotal: 1,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1,
      paymentMethod: 'CASH_ON_DELIVERY',
      paymentStatus: 'UNPAID',
      orderStatus: 'DELIVERED',
    });
    let r = await request(app)
      .post(`/api/v1/products/${p._id}/reviews`)
      .set('Authorization', `Bearer ${at}`)
      .send({ rating: 5, title: 'Great', body: 'Excellent product' });
    assert.equal(r.status, 201);
    const aId = r.body.data._id;
    assert.equal(r.body.data.verifiedPurchase, true);
    assert.equal((await Product.findById(p._id).lean()).ratingAverage, 5);
    r = await request(app)
      .post(`/api/v1/products/${p._id}/reviews`)
      .set('Authorization', `Bearer ${at}`)
      .send({ rating: 5, title: 'Again', body: 'Duplicate review' });
    assert.equal(r.status, 409);
    r = await request(app)
      .post(`/api/v1/products/${p._id}/reviews`)
      .set('Authorization', `Bearer ${bt}`)
      .send({ rating: 3, title: 'Okay', body: 'Ordinary product' });
    assert.equal(r.status, 201);
    const bId = r.body.data._id;
    assert.equal(r.body.data.verifiedPurchase, false);
    let product = await Product.findById(p._id).lean();
    assert.equal(product.ratingAverage, 4);
    assert.equal(product.ratingCount, 2);
    r = await request(app)
      .patch(`/api/v1/reviews/${bId}`)
      .set('Authorization', `Bearer ${bt}`)
      .send({ rating: 1, title: 'Changed', body: 'Changed review text' });
    assert.equal(r.status, 200);
    product = await Product.findById(p._id).lean();
    assert.equal(product.ratingAverage, 3);
    r = await request(app).patch(`/api/v1/reviews/${aId}`).set('Authorization', `Bearer ${bt}`).send({ rating: 1, title: 'No', body: 'No ownership' });
    assert.equal(r.status, 404);
    r = await request(app).get(`/api/v1/products/${p._id}/reviews?sort=highest-rating`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 2);
    assert.ok(!JSON.stringify(r.body).match(/email|password|moderationReason/i));
    r = await request(app).patch(`/api/v1/admin/reviews/${bId}/status`).set('Authorization', `Bearer ${st}`).send({ status: 'HIDDEN', reason: 'Spam review' });
    assert.equal(r.status, 200);
    product = await Product.findById(p._id).lean();
    assert.equal(product.ratingAverage, 5);
    assert.equal(product.ratingCount, 1);
    r = await request(app).get(`/api/v1/products/${p._id}/reviews`);
    assert.equal(r.body.data.length, 1);
    r = await request(app)
      .patch(`/api/v1/admin/reviews/${bId}/status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ status: 'PUBLISHED', reason: 'Restored review' });
    assert.equal(r.status, 200);
    assert.equal((await Product.findById(p._id).lean()).ratingAverage, 3);
    assert.equal(await AuditLog.countDocuments({ resourceId: bId, action: 'REVIEW_MODERATED' }), 2);
    r = await request(app).delete(`/api/v1/reviews/${aId}`).set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 404);
    r = await request(app).delete(`/api/v1/reviews/${aId}`).set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal((await Product.findById(p._id).lean()).ratingAverage, 1);
    r = await request(app).delete(`/api/v1/reviews/${bId}`).set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 200);
    product = await Product.findById(p._id).lean();
    assert.equal(product.ratingAverage, 0);
    assert.equal(product.ratingCount, 0);
    for (const bad of [0, 6, 1.5]) {
      r = await request(app).post(`/api/v1/products/${p._id}/reviews`).set('Authorization', `Bearer ${at}`).send({ rating: bad, body: 'valid content' });
      assert.equal(r.status, 400);
    }
    r = await request(app).post('/api/v1/products/bad/reviews').set('Authorization', `Bearer ${at}`).send({ rating: 5, body: 'valid content' });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).match(/mongoose|casterror|stack/i));
    assert.equal(await Review.countDocuments(), 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
