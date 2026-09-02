import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Cart } from '../src/models/cart.js';
import { Coupon } from '../src/models/coupon.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('order APIs enforce ownership, strict checkout, coupon revalidation, and admin states', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, b, admin] = await User.create([
      { name: 'A', email: 'a@final.test', password: 'x', role: 'CUSTOMER' },
      { name: 'B', email: 'b@final.test', password: 'x', role: 'CUSTOMER' },
      { name: 'S', email: 's@final.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const at = jwt.sign({ sub: String(a._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      bt = jwt.sign({ sub: String(b._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const [ad, p] = await Promise.all([
      Address.create({ user: a._id, fullName: 'A', phone: '1', addressLine1: 'x', city: 'c', country: 'PK' }),
      Product.create({ name: 'Final', description: 'x', price: 1000, category: 'x', image: 'https://e/f', stock: 5, status: 'ACTIVE' }),
    ]);
    await Cart.create({ user: a._id, items: [{ product: p._id, quantity: 1 }] });
    for (const field of ['customerId', 'items', 'price', 'total', 'orderStatus', '$set', '$inc', '$where']) {
      let r = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${at}`)
        .set('Idempotency-Key', 'strict-final')
        .send({ addressId: String(ad._id), paymentMethod: 'CASH_ON_DELIVERY', [field]: field === '$set' ? { stock: 0 } : 1 });
      assert.equal(r.status, 400);
    }
    const c = await Coupon.create({ code: 'CAP', type: 'PERCENTAGE', value: 50, maximumDiscount: 100 });
    let r = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${at}`).send({ code: 'cap' });
    assert.equal(r.status, 200);
    c.enabled = false;
    await c.save();
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'disabled-final')
      .send({ addressId: String(ad._id), paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'cap' });
    assert.equal(r.status, 400);
    assert.equal((await Product.findById(p._id).lean()).stock, 5);
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'final-order-1')
      .send({ addressId: String(ad._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    const id = r.body.data._id;
    r = await request(app).get('/api/v1/orders?page=1&limit=1').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.limit, 1);
    r = await request(app).get(`/api/v1/orders/${id}`).set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 404);
    r = await request(app).get('/api/v1/admin/orders');
    assert.equal(r.status, 401);
    r = await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 403);
    r = await request(app).get(`/api/v1/admin/orders/${id}`).set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      r = await request(app).patch(`/api/v1/admin/orders/${id}/status`).set('Authorization', `Bearer ${st}`).send({ status, reason: 'Integration transition' });
      assert.equal(r.status, 200);
    }
    r = await request(app)
      .patch(`/api/v1/admin/orders/${id}/status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ status: 'PENDING', reason: 'Invalid transition' });
    assert.equal(r.status, 400);
    r = await request(app)
      .patch(`/api/v1/admin/orders/${id}/payment-status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ paymentStatus: 'PAID', reason: 'COD collected' });
    assert.equal(r.status, 200);
    r = await request(app)
      .patch(`/api/v1/admin/orders/${id}/payment-status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ paymentStatus: 'UNPAID', reason: 'Invalid reversal' });
    assert.equal(r.status, 400);
    const audits = await AuditLog.find({ resourceId: String(id) }).lean();
    assert.ok(audits.some((x: any) => x.action === 'ORDER_CREATED'));
    assert.ok(audits.some((x: any) => x.action === 'ORDER_STATUS_UPDATED'));
    assert.ok(audits.some((x: any) => x.action === 'ORDER_PAYMENT_UPDATED'));
    assert.ok(audits.every((x: any) => !JSON.stringify(x.metadata).match(/bearer|password|secret/i)));
    assert.equal(await Order.countDocuments(), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
