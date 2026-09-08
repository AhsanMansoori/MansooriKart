import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Cart } from '../src/models/cart.js';
import { Coupon } from '../src/models/coupon.js';
import { CouponRedemption } from '../src/models/couponRedemption.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('checkout revalidates changed coupons and keeps failure/audit state safe', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [u, admin] = await User.create([
      { name: 'U', email: 'u@evidence.test', password: 'x', role: 'CUSTOMER' },
      { name: 'S', email: 's@evidence.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const t = jwt.sign({ sub: String(u._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const [a, p] = await Promise.all([
      Address.create({ user: u._id, fullName: 'U', phone: '1', addressLine1: 'x', city: 'c', country: 'PK' }),
      Product.create({ name: 'P', description: 'x', price: 1000, category: 'x', image: 'https://e/p', stock: 3, status: 'ACTIVE' }),
    ]);
    await Cart.create({ user: u._id, items: [{ product: p._id, quantity: 1 }] });
    for (const mode of ['expired', 'future', 'limit', 'minimum', 'unknown'] as const) {
      const c =
        mode === 'unknown'
          ? undefined
          : await Coupon.create({
              code: `C${mode}`,
              type: 'PERCENTAGE',
              value: 50,
              maximumDiscount: 100,
              minimumOrderAmount: mode === 'minimum' ? 900 : 0,
              usageLimit: mode === 'limit' ? 1 : undefined,
            });
      if (c) {
        let preview = await request(app).post('/api/v1/coupons/validate').set('Authorization', `Bearer ${t}`).send({ code: c.code });
        assert.equal(preview.status, 200);
        if (mode === 'expired') c.expiresAt = new Date(Date.now() - 1000);
        if (mode === 'future') c.startsAt = new Date(Date.now() + 86400000);
        if (mode === 'limit') c.usageCount = 1;
        if (mode === 'minimum') await Product.updateOne({ _id: p._id }, { $set: { price: 100 } });
        await c.save();
      }
      const beforeStock = (await Product.findById(p._id).lean()).stock,
        beforeOrders = await Order.countDocuments(),
        beforeAudits = await AuditLog.countDocuments({ action: 'ORDER_CREATED' });
      const r = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${t}`)
        .set('Idempotency-Key', `evidence-${mode}`)
        .send({ addressId: String(a._id), paymentMethod: 'CASH_ON_DELIVERY', couponCode: mode === 'unknown' ? 'UNKNOWN' : c.code.toLowerCase() });
      assert.equal(r.status, 400);
      assert.equal((await Product.findById(p._id).lean()).stock, beforeStock);
      assert.equal(await Order.countDocuments(), beforeOrders);
      assert.equal((await Cart.findOne({ user: u._id }).lean()).items.length, 1);
      assert.equal(await AuditLog.countDocuments({ action: 'ORDER_CREATED' }), beforeAudits);
      if (c) assert.equal(await CouponRedemption.countDocuments({ coupon: c._id }), 0);
      await Product.updateOne({ _id: p._id }, { $set: { price: 1000 } });
    }
    const cap = await Coupon.create({ code: 'CAPFINAL', type: 'PERCENTAGE', value: 50, maximumDiscount: 100 });
    let preview = await request(app)
      .post('/api/v1/checkout/preview')
      .set('Authorization', `Bearer ${t}`)
      .send({ addressId: String(a._id), paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'capfinal', items: [{ productId: String(p._id), quantity: 1 }] });
    assert.equal(preview.status, 200);
    assert.deepEqual(Object.keys(preview.body.data).sort(), ['currency', 'discount', 'items', 'quoteHash', 'shipping', 'subtotal', 'tax', 'total'].sort());
    assert.equal(preview.body.data.currency, 'PKR');
    await Product.updateOne({ _id: p._id }, { $set: { price: 1100 } });
    let r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', 'stale-quote')
      .send({
        addressId: String(a._id),
        paymentMethod: 'CASH_ON_DELIVERY',
        couponCode: 'capfinal',
        items: [{ productId: String(p._id), quantity: 1 }],
        quoteHash: preview.body.data.quoteHash,
      });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'CHECKOUT_QUOTE_CHANGED');
    assert.equal(await Order.countDocuments({ idempotencyKey: 'stale-quote' }), 0);
    preview = await request(app)
      .post('/api/v1/checkout/preview')
      .set('Authorization', `Bearer ${t}`)
      .send({ addressId: String(a._id), paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'capfinal', items: [{ productId: String(p._id), quantity: 1 }] });
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${t}`)
      .set('Idempotency-Key', 'cap-final')
      .send({
        addressId: String(a._id),
        paymentMethod: 'CASH_ON_DELIVERY',
        couponCode: 'capfinal',
        items: [{ productId: String(p._id), quantity: 1 }],
        quoteHash: preview.body.data.quoteHash,
      });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.discount, 100);
    const id = r.body.data._id;
    r = await request(app).patch(`/api/v1/admin/orders/${id}/status`).set('Authorization', `Bearer ${t}`).send({ status: 'CONFIRMED', reason: 'no' });
    assert.equal(r.status, 403);
    assert.equal(await AuditLog.countDocuments({ resourceId: id, action: 'ORDER_STATUS_UPDATED' }), 0);
    r = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${t}`).send({ stock: 999 });
    assert.equal(r.status, 400);
    r = await request(app).get('/api/v1/orders/bad-id').set('Authorization', `Bearer ${t}`);
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).match(/mongoose|casterror|stack/i));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
