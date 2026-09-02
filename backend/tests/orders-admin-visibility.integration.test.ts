import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { Cart } from '../src/models/cart.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('admin order list, filters, sorting, detail and query safety behave correctly', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Order.init();
    const [a, b, admin] = await User.create([
      { name: 'Ayesha', email: 'ayesha@d.test', password: 'hashed-secret', role: 'CUSTOMER' },
      { name: 'Bilal', email: 'bilal@d.test', password: 'hashed-secret', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@d.test', password: 'hashed-secret', role: 'SUPER_ADMIN' },
    ]);
    const token = (user: any, role: string) => jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!);
    const [at, bt, st] = [token(a, 'CUSTOMER'), token(b, 'CUSTOMER'), token(admin, 'SUPER_ADMIN')];
    const [addressA, addressB, cheap, pricey] = await Promise.all([
      Address.create({ user: a._id, fullName: 'Ayesha', phone: '03001', addressLine1: 'House 1', city: 'Karachi', country: 'PK' }),
      Address.create({ user: b._id, fullName: 'Bilal', phone: '03002', addressLine1: 'House 2', city: 'Lahore', country: 'PK' }),
      Product.create({
        name: 'Budget mouse',
        sku: 'ADM-CHEAP',
        description: 'x',
        price: 1000,
        category: 'x',
        image: 'https://e/1',
        stock: 10,
        status: 'ACTIVE',
      }),
      Product.create({
        name: 'Premium laptop',
        sku: 'ADM-PRICEY',
        description: 'x',
        price: 6000,
        category: 'x',
        image: 'https://e/2',
        stock: 10,
        status: 'ACTIVE',
      }),
    ]);
    await Cart.create([
      { user: a._id, items: [{ product: cheap._id, quantity: 1 }] },
      { user: b._id, items: [{ product: pricey._id, quantity: 1 }] },
    ]);
    // Order A: 1000 subtotal + 250 shipping = 1250. Order B: 6000 subtotal, free shipping above 5000.
    let r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'admin-list-order-a')
      .send({ addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    const orderA = r.body.data;
    assert.equal(orderA.total, 1250);
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${bt}`)
      .set('Idempotency-Key', 'admin-list-order-b')
      .send({ addressId: String(addressB._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    const orderB = r.body.data;
    assert.equal(orderB.total, 6000);

    // Authorization on the list endpoint.
    assert.equal((await request(app).get('/api/v1/admin/orders')).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${at}`)).status, 403);
    r = await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.total, 2);

    const list = async (query: string) => request(app).get(`/api/v1/admin/orders?${query}`).set('Authorization', `Bearer ${st}`);
    const ids = (response: any) => response.body.data.map((order: any) => String(order._id)).sort();

    // Filter: order number (exact, case-normalised).
    r = await list(`orderNumber=${orderA.orderNumber.toLowerCase()}`);
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r), [String(orderA._id)]);
    // Filter: customer by email and by name.
    r = await list('customer=ayesha@d.test');
    assert.deepEqual(ids(r), [String(orderA._id)]);
    r = await list('customer=Bilal');
    assert.deepEqual(ids(r), [String(orderB._id)]);
    // Filter: order status, before and after a transition.
    r = await list('orderStatus=PENDING');
    assert.equal(r.body.meta.total, 2);
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${orderA._id}/status`)
          .set('Authorization', `Bearer ${st}`)
          .send({ status: 'CONFIRMED', reason: 'Filter fixture' })
      ).status,
      200
    );
    r = await list('orderStatus=CONFIRMED');
    assert.deepEqual(ids(r), [String(orderA._id)]);
    r = await list('orderStatus=CANCELLED');
    assert.equal(r.body.meta.total, 0);
    // Filter: payment status and payment method.
    r = await list('paymentStatus=UNPAID');
    assert.equal(r.body.meta.total, 2);
    r = await list('paymentStatus=PAID');
    assert.equal(r.body.meta.total, 0);
    r = await list('paymentMethod=CASH_ON_DELIVERY');
    assert.equal(r.body.meta.total, 2);
    // Filter: date range.
    const day = 86400000;
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    r = await list(`from=${iso(day)}`);
    assert.equal(r.body.meta.total, 0);
    r = await list(`from=${iso(-day)}&to=${iso(day)}`);
    assert.equal(r.body.meta.total, 2);
    // Filter: amount range.
    r = await list('minAmount=2000');
    assert.deepEqual(ids(r), [String(orderB._id)]);
    r = await list('maxAmount=2000');
    assert.deepEqual(ids(r), [String(orderA._id)]);
    r = await list('minAmount=1000&maxAmount=7000');
    assert.equal(r.body.meta.total, 2);

    // Pagination.
    r = await list('limit=1&page=1&sort=total&direction=asc');
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.meta.total, 2);
    assert.equal(r.body.meta.totalPages, 2);
    const firstPage = String(r.body.data[0]._id);
    r = await list('limit=1&page=2&sort=total&direction=asc');
    assert.equal(r.body.data.length, 1);
    assert.notEqual(String(r.body.data[0]._id), firstPage);

    // Allowed sorting only.
    r = await list('sort=total&direction=asc');
    assert.equal(String(r.body.data[0]._id), String(orderA._id));
    r = await list('sort=total&direction=desc');
    assert.equal(String(r.body.data[0]._id), String(orderB._id));
    r = await list('sort=orderNumber&direction=asc');
    assert.equal(r.status, 200);
    assert.equal((await list('sort=customer')).status, 400);
    assert.equal((await list('direction=sideways')).status, 400);

    // Query safety: operator objects and unknown keys are rejected by the strict allowlist, and a
    // string full of regex metacharacters is matched literally rather than compiled.
    for (const injection of [
      'orderStatus[$ne]=CANCELLED',
      'paymentStatus[$ne]=PAID',
      'customer[$ne]=',
      'customer[$regex]=.%2A',
      'orderNumber[$regex]=.%2A',
      'limit[$gt]=1',
      'total[$gt]=0',
      'minAmount[$gt]=0',
      'sort[$where]=1',
    ]) {
      const response = await list(injection);
      assert.equal(response.status, 400, `expected 400 for ${injection}`);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
    // `__proto__` keys are stripped by the query parser before validation, so the request is simply
    // ignored rather than rejected. The invariant is that it neither filters nor pollutes.
    r = await list('__proto__[admin]=1');
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.total, 2);
    assert.equal(({} as Record<string, unknown>)['admin'], undefined);
    r = await list('orderNumber=.*');
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.total, 0);
    r = await list('customer=.*');
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.total, 0);

    // Detail endpoint authorization and safe error handling.
    assert.equal((await request(app).get(`/api/v1/admin/orders/${orderA._id}`)).status, 401);
    assert.equal((await request(app).get(`/api/v1/admin/orders/${orderA._id}`).set('Authorization', `Bearer ${at}`)).status, 403);
    r = await request(app).get(`/api/v1/admin/orders/${orderA._id}`).set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.orderNumber, orderA.orderNumber);
    assert.deepEqual(Object.keys(r.body.data.customer).sort(), ['_id', 'email', 'name']);
    r = await request(app).get('/api/v1/admin/orders/not-an-id').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    r = await request(app).get(`/api/v1/admin/orders/${new mongoose.Types.ObjectId()}`).set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'ORDER_NOT_FOUND');

    // No authentication material may appear in admin order payloads.
    for (const url of ['/api/v1/admin/orders', `/api/v1/admin/orders/${orderA._id}`]) {
      const payload = JSON.stringify((await request(app).get(url).set('Authorization', `Bearer ${st}`)).body);
      for (const forbidden of ['password', 'hashed-secret', 'jwt', 'token', 'secret', '$2a$', '$2b$'])
        assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `${url} leaked ${forbidden}`);
    }

    // Mass-assignment attempts on admin mutations are rejected by the strict schemas.
    for (const body of [
      { status: 'PROCESSING', total: 1 },
      { status: 'PROCESSING', statusHistory: [] },
      { status: 'PROCESSING', customer: String(b._id) },
      { status: 'PROCESSING', createdAt: new Date().toISOString() },
      { status: 'PROCESSING', $set: { total: 1 } },
      { status: 'NOT_A_STATUS' },
    ]) {
      const response = await request(app)
        .patch(`/api/v1/admin/orders/${orderA._id}/status`)
        .set('Authorization', `Bearer ${st}`)
        .send(body as any);
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
    const untouched = await Order.findById(orderA._id).lean();
    assert.equal(untouched!.total, 1250);
    assert.equal(untouched!.orderStatus, 'CONFIRMED');
    assert.equal(String(untouched!.customer), String(a._id));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
