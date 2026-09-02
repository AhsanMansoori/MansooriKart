import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { Cart } from '../src/models/cart.js';
import { Product } from '../src/models/product.js';
import { Refund } from '../src/models/refund.js';
import { ReturnRequest } from '../src/models/return.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('orders and sales ERP preserve ownership, snapshots, workflows, returns, refunds, and sales data', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, b, admin] = await User.create([
      { name: 'A', email: 'a@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'B', email: 'b@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@d.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const token = (user: any, role: string) => jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!);
    const [at, bt, st] = [token(a, 'CUSTOMER'), token(b, 'CUSTOMER'), token(admin, 'SUPER_ADMIN')];
    const [address, product] = await Promise.all([
      Address.create({ user: a._id, fullName: 'A', phone: '1', addressLine1: 'x', city: 'c', country: 'PK' }),
      Product.create({
        name: 'Snapshot product',
        sku: 'D-SKU',
        description: 'x',
        price: 1000,
        category: 'x',
        image: 'https://e/d',
        stock: 3,
        status: 'ACTIVE',
      }),
    ]);
    await Cart.create({ user: a._id, items: [{ product: product._id, quantity: 1 }] });
    let r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'phase-d-order-one')
      .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    const orderId = r.body.data._id;
    await Product.updateOne({ _id: product._id }, { $set: { name: 'Changed price product', price: 9999 } });
    r = await request(app).get(`/api/v1/orders/${orderId}/invoice`).set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items[0].name, 'Snapshot product');
    assert.equal(r.body.data.items[0].unitPrice, 1000);
    for (const url of [`/api/v1/orders/${orderId}`, `/api/v1/orders/${orderId}/tracking`, `/api/v1/orders/${orderId}/invoice`]) {
      r = await request(app).get(url).set('Authorization', `Bearer ${bt}`);
      assert.equal(r.status, 404);
    }
    r = await request(app).get('/api/v1/admin/orders');
    assert.equal(r.status, 401);
    r = await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 403);
    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      r = await request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${st}`)
        .send({ status, reason: 'Phase D transition' });
      assert.equal(r.status, 200);
    }
    r = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/payment-status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ paymentStatus: 'PAID', reason: 'COD collected' });
    assert.equal(r.status, 200);
    r = await request(app).get(`/api/v1/orders/${orderId}/tracking`).set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.timeline.at(-1).to, 'DELIVERED');
    const returnBody = { items: [{ productId: String(product._id), quantity: 1 }], reason: 'Not suitable' };
    const [one, two] = await Promise.all([
      request(app).post(`/api/v1/orders/${orderId}/returns`).set('Authorization', `Bearer ${at}`).send(returnBody),
      request(app).post(`/api/v1/orders/${orderId}/returns`).set('Authorization', `Bearer ${at}`).send(returnBody),
    ]);
    assert.equal([one.status, two.status].filter(status => status === 201).length, 1);
    assert.equal(await ReturnRequest.countDocuments({ order: orderId }), 1);
    const returnId = (one.status === 201 ? one : two).body.data._id;
    r = await request(app).get(`/api/v1/returns/${returnId}`).set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 404);
    r = await request(app)
      .patch(`/api/v1/admin/returns/${returnId}/status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ status: 'APPROVED', reason: 'Approved' });
    assert.equal(r.status, 200);
    r = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/refunds`)
      .set('Authorization', `Bearer ${st}`)
      .set('Idempotency-Key', 'phase-d-refund-one')
      .send({ amount: 500, reason: 'Manual COD refund', returnId });
    assert.equal(r.status, 201);
    const refundId = r.body.data._id;
    r = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/refunds`)
      .set('Authorization', `Bearer ${st}`)
      .set('Idempotency-Key', 'phase-d-refund-two')
      .send({ amount: 800, reason: 'Too much' });
    assert.equal(r.status, 400);
    r = await request(app).patch(`/api/v1/admin/refunds/${refundId}/status`).set('Authorization', `Bearer ${st}`).send({ status: 'APPROVED' });
    assert.equal(r.status, 200);
    r = await request(app).get('/api/v1/admin/sales/dashboard?range=30d').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.realizedRevenue, 1250);
    assert.equal(r.body.data.refunds, 500);
    r = await request(app).get('/api/v1/admin/sales/analytics?range=30d').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.salesByDate.length > 0);
    assert.equal(await Refund.countDocuments({ order: orderId }), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
