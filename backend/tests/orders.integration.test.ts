import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('checkout is authoritative, idempotent, owner-scoped and cancellation restores once', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, b, admin] = await User.create([
      { name: 'A', email: 'a@order.test', password: 'x', role: 'CUSTOMER' },
      { name: 'B', email: 'b@order.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@order.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const at = jwt.sign({ sub: String(a._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      bt = jwt.sign({ sub: String(b._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const [p, address] = await Promise.all([
      Product.create({
        name: 'Order product',
        description: 'x',
        price: 100,
        category: 'x',
        image: 'https://e.test/p',
        stock: 2,
        status: 'ACTIVE',
        sku: 'ORD-1',
      }),
      Address.create({ user: a._id, fullName: 'A', phone: '1', addressLine1: 'Street', city: 'City', country: 'PK' }),
    ]);
    let r = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${at}`)
      .send({ productId: String(p._id), quantity: 1 });
    assert.equal(r.status, 201);
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'checkout-key-1')
      .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY', total: 1 });
    assert.equal(r.status, 400);
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'checkout-key-1')
      .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    const id = r.body.data._id;
    assert.equal(r.body.data.total, 350);
    assert.equal(r.body.data.paymentStatus, 'UNPAID');
    assert.equal((await Product.findById(p._id).lean()).stock, 1);
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${at}`)
      .set('Idempotency-Key', 'checkout-key-1')
      .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    assert.equal(await Order.countDocuments(), 1);
    assert.equal(await InventoryMovement.countDocuments({ type: 'ORDER' }), 1);
    r = await request(app).get(`/api/v1/orders/${id}`).set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 404);
    r = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${at}`).send({});
    assert.equal(r.status, 200);
    assert.equal((await Product.findById(p._id).lean()).stock, 2);
    r = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${at}`).send({});
    assert.equal(r.status, 400);
    assert.equal(await InventoryMovement.countDocuments({ type: 'CANCELLATION' }), 1);
    r = await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 403);
    r = await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
