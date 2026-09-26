import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Coupon } from '../src/models/coupon.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('admin coupon creation, customer preview and soft archive use real cart totals', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [customer, admin] = await User.create([
      { name: 'coupon customer', email: 'customer@coupon.test', password: 'x', role: 'CUSTOMER' },
      { name: 'coupon admin', email: 'admin@coupon.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      at = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const p = await Product.create({
      name: 'Coupon product',
      description: 'x',
      price: 100,
      category: 'x',
      image: 'https://e.test/i.png',
      stock: 2,
      status: 'ACTIVE',
    });
    let r = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${ct}`)
      .send({ productId: String(p._id), quantity: 1 });
    assert.equal(r.status, 201);
    r = await request(app).post('/api/v1/admin/coupons').send({ code: 'save10', type: 'PERCENTAGE', value: 10 });
    assert.equal(r.status, 401);
    r = await request(app).post('/api/v1/admin/coupons').set('Authorization', `Bearer ${ct}`).send({ code: 'save10', type: 'PERCENTAGE', value: 10 });
    assert.equal(r.status, 403);
    r = await request(app).post('/api/v1/admin/coupons').set('Authorization', `Bearer ${at}`).send({ code: 'save10', type: 'PERCENTAGE', value: 10 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.code, 'SAVE10');
    const id = r.body.data._id;
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'save10' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.subtotalBeforeDiscount, 100);
    assert.equal(r.body.data.discountAmount, 10);
    assert.equal(r.body.data.subtotalAfterDiscount, 90);
    assert.equal((await Coupon.findById(id).lean()).usageCount, 0);
    // Preview remains server-authoritative after a current product price change.
    await Product.updateOne({ _id: p._id }, { $set: { price: 120 } });
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'SAVE10' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.subtotalBeforeDiscount, 120);
    for (const extra of ['subtotal', 'total', 'price', 'discount', 'userId', 'customerId', 'usageCount', 'role', '$set', '$inc', '$where']) {
      r = await request(app)
        .post('/api/v1/coupons/validate')
        .set('Authorization', `Bearer ${ct}`)
        .send({ code: 'SAVE10', [extra]: 1 });
      assert.equal(r.status, 400, extra);
    }
    r = await request(app).post('/api/v1/admin/coupons').set('Authorization', `Bearer ${at}`).send({ code: 'fixed200', type: 'FIXED', value: 200 });
    assert.equal(r.status, 201);
    const fixedId = r.body.data._id;
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'fixed200' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.discountAmount, 120);
    assert.equal(r.body.data.subtotalAfterDiscount, 0);
    r = await request(app)
      .post('/api/v1/admin/coupons')
      .set('Authorization', `Bearer ${at}`)
      .send({ code: 'cap', type: 'PERCENTAGE', value: 50, maximumDiscount: 20 });
    assert.equal(r.status, 201);
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'CAP' });
    assert.equal(r.body.data.discountAmount, 20);
    for (const [code, fields, expected] of [
      ['FUTURE', { startsAt: '2999-01-01T00:00:00.000Z' }, 400],
      ['EXPIRED', { expiresAt: '2000-01-01T00:00:00.000Z' }, 400],
      ['MINIMUM', { minimumOrderAmount: 121 }, 400],
    ] as const) {
      r = await request(app)
        .post('/api/v1/admin/coupons')
        .set('Authorization', `Bearer ${at}`)
        .send({ code, type: 'FIXED', value: 1, ...fields });
      assert.equal(r.status, 201);
      r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code });
      assert.equal(r.status, expected);
    }
    r = await request(app)
      .post('/api/v1/admin/coupons')
      .set('Authorization', `Bearer ${at}`)
      .send({ code: 'EXACTMIN', type: 'FIXED', value: 1, minimumOrderAmount: 120 });
    assert.equal(r.status, 201);
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'EXACTMIN' });
    assert.equal(r.status, 200);
    r = await request(app).post('/api/v1/admin/coupons').set('Authorization', `Bearer ${at}`).send({ code: 'LIMITED', type: 'FIXED', value: 1, usageLimit: 1 });
    assert.equal(r.status, 201);
    await Coupon.updateOne({ code: 'LIMITED' }, { $set: { usageCount: 1 } });
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'LIMITED' });
    assert.equal(r.status, 400);
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'UNKNOWN' });
    assert.equal(r.status, 400);
    for (const body of [
      { code: 'SAVE10', type: 'FIXED', value: 1 },
      { code: 'zero', type: 'FIXED', value: 0 },
      { code: 'negative', type: 'FIXED', value: -1 },
      { code: 'too-high', type: 'PERCENTAGE', value: 101 },
      { code: 'bad-type', type: 'OTHER', value: 1 },
      { code: 'bad-dates', type: 'FIXED', value: 1, startsAt: '2030-01-02', expiresAt: '2030-01-01' },
      { code: 'internal', type: 'FIXED', value: 1, usageCount: 99 },
    ]) {
      r = await request(app).post('/api/v1/admin/coupons').set('Authorization', `Bearer ${at}`).send(body);
      assert.ok([400, 409].includes(r.status));
    }
    r = await request(app).get('/api/v1/admin/coupons?page=1&limit=1').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.limit, 1);
    r = await request(app).get(`/api/v1/admin/coupons/${fixedId}`).set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    r = await request(app).get('/api/v1/admin/coupons/bad-id').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 404);
    r = await request(app).patch(`/api/v1/admin/coupons/${fixedId}`).set('Authorization', `Bearer ${ct}`).send({ enabled: false });
    assert.equal(r.status, 403);
    r = await request(app).patch(`/api/v1/admin/coupons/${fixedId}`).set('Authorization', `Bearer ${at}`).send({ enabled: false });
    assert.equal(r.status, 200);
    r = await request(app).patch(`/api/v1/admin/coupons/${fixedId}`).set('Authorization', `Bearer ${at}`).send({ usageCount: 9 });
    assert.equal(r.status, 400);
    r = await request(app).delete(`/api/v1/admin/coupons/${fixedId}`).set('Authorization', `Bearer ${ct}`);
    assert.equal(r.status, 403);
    let audits = await AuditLog.find({ resourceType: 'Coupon' }).lean();
    assert.ok(audits.some((a: any) => a.action === 'COUPON_CREATED' && String(a.actor) === String(admin._id)));
    assert.ok(audits.some((a: any) => a.action === 'COUPON_DISABLED'));
    assert.ok(audits.every((a: any) => a.requestId && !JSON.stringify(a.metadata).match(/authorization|bearer|password|secret/i)));
    r = await request(app).delete(`/api/v1/admin/coupons/${id}`).set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal((await Coupon.findById(id).lean()).enabled, false);
    audits = await AuditLog.find({ resourceType: 'Coupon', resourceId: String(id) }).lean();
    assert.ok(audits.some((a: any) => a.action === 'COUPON_ARCHIVED'));
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'SAVE10' });
    assert.equal(r.status, 400);
    r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${ct}`).send({ code: 'SAVE10', total: 1 });
    assert.equal(r.status, 400);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
