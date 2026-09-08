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
test('wishlist lifecycle is owner-scoped and uses strict request bodies', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [a, b] = await User.create([
      { name: 'A', email: 'a@wish.test', password: 'x', role: 'CUSTOMER' },
      { name: 'B', email: 'b@wish.test', password: 'x', role: 'CUSTOMER' },
    ]);
    const ta = jwt.sign({ sub: String(a._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      tb = jwt.sign({ sub: String(b._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const p = await Product.create({
      name: 'Wish product',
      description: 'x',
      price: 1,
      category: 'x',
      image: 'https://e.test/i.png',
      stock: 1,
      status: 'ACTIVE',
    });
    let r = await request(app).get('/api/v1/wishlist').set('Authorization', `Bearer ${ta}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.products, []);
    r = await request(app)
      .post('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${ta}`)
      .send({ productId: String(p._id) });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.products.length, 1);
    r = await request(app)
      .post('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${ta}`)
      .send({ productId: String(p._id) });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.products.length, 1);
    r = await request(app)
      .post('/api/v1/wishlist/items')
      .set('Authorization', `Bearer ${ta}`)
      .send({ productId: String(p._id), userId: String(b._id) });
    assert.equal(r.status, 400);
    r = await request(app).get('/api/v1/wishlist').set('Authorization', `Bearer ${tb}`);
    assert.deepEqual(r.body.data.products, []);
    r = await request(app).delete(`/api/v1/wishlist/items/${p._id}`).set('Authorization', `Bearer ${ta}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.products, []);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
