import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('cart lifecycle and guest merge are server-authoritative', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const user = await User.create({ name: 'Cart customer', email: 'cart@example.test', password: 'hash', role: 'CUSTOMER' });
    const token = jwt.sign({ sub: String(user._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const product = await Product.create({
      name: 'Cart product',
      description: 'cart test',
      price: 12.5,
      category: 'test',
      image: 'https://example.test/p.png',
      stock: 3,
      status: 'ACTIVE',
    });
    const inactive = await Product.create({
      name: 'Inactive cart product',
      description: 'x',
      price: 99,
      category: 'test',
      image: 'https://example.test/i.png',
      stock: 9,
      status: 'ARCHIVED',
    });
    const second = await Product.create({
      name: 'Second cart product',
      description: 'x',
      price: 5,
      category: 'test',
      image: 'https://example.test/s.png',
      stock: 4,
      status: 'ACTIVE',
    });
    const path = `/api/v1/cart/items`;
    let res = await request(app).get('/api/v1/cart').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
    res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: String(product._id), quantity: 1 });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.subtotal, 12.5);
    res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: String(product._id), quantity: 2 });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.items[0].quantity, 3);
    for (const quantity of [0, -1, 1.5]) {
      res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: String(product._id), quantity });
      assert.equal(res.status, 400);
      assert.ok(res.body.error && !JSON.stringify(res.body).match(/mongoose|stack/i));
    }
    for (const extra of [
      'costPrice',
      'stock',
      'subtotal',
      'total',
      'discount',
      'userId',
      'customerId',
      'role',
      'owner',
      'createdBy',
      'createdAt',
      'updatedAt',
      '$set',
      '$inc',
      '$where',
    ]) {
      res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: String(product._id), quantity: 1, [extra]: extra === '$set' ? { stock: 0 } : 'spoof' });
      assert.equal(res.status, 400, extra);
    }
    for (const productId of ['bad-id', '000000000000000000000000', String(inactive._id)]) {
      res = await request(app).post(path).set('Authorization', `Bearer ${token}`).send({ productId, quantity: 1 });
      assert.ok([400, 404].includes(res.status));
      assert.ok(!JSON.stringify(res.body).match(/mongoose|stack/i));
    }
    res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: String(product._id), quantity: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INSUFFICIENT_STOCK');
    res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: String(product._id), quantity: 1, price: 1 });
    assert.equal(res.status, 400);
    assert.equal((await Product.findById(product._id).lean()).stock, 3);
    res = await request(app).patch(`${path}/${product._id}`).set('Authorization', `Bearer ${token}`).send({ quantity: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items[0].quantity, 2);
    res = await request(app).post('/api/v1/cart/merge').set('Authorization', `Bearer ${token}`).send({ items: [] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items[0].quantity, 2);
    // Repeated guest lines aggregate deterministically; feasible lines apply while invalid lines are reported.
    res = await request(app)
      .post('/api/v1/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { productId: String(product._id), quantity: 1 },
          { productId: String(product._id), quantity: 1 },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.issues[0].code, 'INSUFFICIENT_STOCK');
    res = await request(app)
      .post('/api/v1/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ productId: String(product._id), quantity: 1, price: 1 }] });
    assert.equal(res.status, 400);
    res = await request(app).delete('/api/v1/cart').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    res = await request(app).get('/api/v1/cart').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
    assert.equal((await Product.findById(product._id).lean()).stock, 3);
    assert.equal((await Product.findById(product._id).lean()).price, 12.5);
    res = await request(app)
      .post('/api/v1/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { productId: String(product._id), quantity: 1 },
          { productId: String(second._id), quantity: 2 },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 2);
    const syncBody = { items: [{ productId: String(product._id), quantity: 1 }] };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      res = await request(app).put('/api/v1/cart/sync').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'cart-sync-replay').send(syncBody);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.items.length, 2, 'sync preserves an existing line from another device');
    }
    const synced = res.body.data.items.find((line: any) => String(line.product.id) === String(product._id));
    assert.equal(synced.quantity, 1, 'replaying sync does not add quantity twice');
    res = await request(app)
      .put('/api/v1/cart/sync')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'cart-sync-replay')
      .send({ items: [{ productId: String(product._id), quantity: 2 }] });
    assert.equal(res.status, 409, 'one key cannot be reused for a different selection');
    for (const productId of ['bad-id', '000000000000000000000000', String(inactive._id)]) {
      res = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ productId, quantity: 1 }] });
      assert.ok([200, 400].includes(res.status));
      if (res.status === 200) assert.equal(res.body.data.issues[0].code, 'PRODUCT_NOT_FOUND');
    }
    for (const extra of ['costPrice', 'stock', 'subtotal', 'total', 'discount', 'userId', 'customerId', 'role']) {
      res = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ productId: String(product._id), quantity: 1, [extra]: 1 }] });
      assert.equal(res.status, 400, extra);
    }
    await request(app).delete('/api/v1/cart').set('Authorization', `Bearer ${token}`);
    // Re-add so the existing item-delete contract remains covered.
    await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: String(product._id), quantity: 2 });
    res = await request(app)
      .post('/api/v1/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ productId: String(product._id), quantity: 2 }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.issues[0].code, 'INSUFFICIENT_STOCK');
    assert.equal(res.body.data.items[0].quantity, 2);
    res = await request(app).delete(`${path}/${product._id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
