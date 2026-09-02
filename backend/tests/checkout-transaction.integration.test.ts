import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { Cart } from '../src/models/cart.js';
import { Coupon } from '../src/models/coupon.js';
import { CouponRedemption } from '../src/models/couponRedemption.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const make = async (email: string) => {
  const u = await User.create({ name: email, email, password: 'x', role: 'CUSTOMER' });
  const a = await Address.create({ user: u._id, fullName: 'N', phone: '1', addressLine1: 'A', city: 'C', country: 'PK' });
  return { u, a, t: jwt.sign({ sub: String(u._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!) };
};
const checkout = (t: string, a: string, key: string, couponCode?: string) =>
  request(app)
    .post('/api/v1/checkout')
    .set('Authorization', `Bearer ${t}`)
    .set('Idempotency-Key', key)
    .send({ addressId: a, paymentMethod: 'CASH_ON_DELIVERY', ...(couponCode ? { couponCode } : {}) });
test('checkout compensates order persistence failure and concurrent last stock is safe', { concurrency: false }, async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const x = await make('x@tx.test'),
      p = await Product.create({ name: 'P', description: 'x', price: 100, category: 'x', image: 'https://e/p', stock: 2, status: 'ACTIVE' }),
      p2 = await Product.create({ name: 'P2', description: 'x', price: 200, category: 'x', image: 'https://e/p2', stock: 3, status: 'ACTIVE' });
    await Cart.create({
      user: x.u._id,
      items: [
        { product: p._id, quantity: 1 },
        { product: p2._id, quantity: 2 },
      ],
    });
    const original = Order.create;
    Order.create = async () => {
      throw new Error('forced order persistence failure');
    };
    let r = await checkout(x.t, String(x.a._id), 'forced-save-1');
    Order.create = original;
    assert.equal(r.status, 400);
    assert.equal((await Product.findById(p._id).lean()).stock, 2);
    assert.equal((await Product.findById(p2._id).lean()).stock, 3);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Cart.findOne({ user: x.u._id }).lean()).items.length, 2);
    const [a, b] = await Promise.all([make('a@concurrent.test'), make('b@concurrent.test')]);
    const last = await Product.create({ name: 'Last', description: 'x', price: 100, category: 'x', image: 'https://e/l', stock: 1, status: 'ACTIVE' });
    await Cart.create([
      { user: a.u._id, items: [{ product: last._id, quantity: 1 }] },
      { user: b.u._id, items: [{ product: last._id, quantity: 1 }] },
    ]);
    const results = await Promise.all([checkout(a.t, String(a.a._id), 'concurrent-a'), checkout(b.t, String(b.a._id), 'concurrent-b')]);
    assert.equal(results.filter(v => v.status === 201).length, 1);
    assert.equal(results.filter(v => v.status === 409).length, 1);
    assert.equal((await Product.findById(last._id).lean()).stock, 0);
    assert.equal(await Order.countDocuments({ items: { $elemMatch: { productId: last._id } } }), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
test('checkout redeems coupon once and enforces persisted customer limit', { concurrency: false }, async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, b] = await Promise.all([make('a@coupon-checkout.test'), make('b@coupon-checkout.test')]);
    const p = await Product.create({ name: 'Coupon checkout', description: 'x', price: 1000, category: 'x', image: 'https://e/c', stock: 4, status: 'ACTIVE' });
    const c = await Coupon.create({ code: 'ONE', type: 'PERCENTAGE', value: 10, perCustomerLimit: 1 });
    await Cart.create([
      { user: a.u._id, items: [{ product: p._id, quantity: 1 }] },
      { user: b.u._id, items: [{ product: p._id, quantity: 1 }] },
    ]);
    let r = await checkout(a.t, String(a.a._id), 'coupon-a', 'one');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.coupon.actualDiscount, 100);
    assert.equal((await Coupon.findById(c._id).lean()).usageCount, 1);
    assert.equal(await CouponRedemption.countDocuments({ coupon: c._id, customer: a.u._id }), 1);
    r = await checkout(a.t, String(a.a._id), 'coupon-a', 'one');
    assert.equal(r.status, 201);
    assert.equal((await Coupon.findById(c._id).lean()).usageCount, 1);
    await Cart.updateOne({ user: a.u._id }, { $set: { items: [{ product: p._id, quantity: 1 }] } });
    r = await checkout(a.t, String(a.a._id), 'coupon-a-second', 'one');
    assert.equal(r.status, 400);
    r = await checkout(b.t, String(b.a._id), 'coupon-b', 'one');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await Coupon.findById(c._id).lean()).usageCount, 2);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
