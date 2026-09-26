import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
test('admin inventory routes enforce roles and ledger manual adjustments', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [customer, admin] = await User.create([
      { name: 'customer', email: 'customer@inventory.test', password: 'x', role: 'CUSTOMER' },
      { name: 'admin', email: 'admin@inventory.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!),
      at = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const product = await Product.create({
      name: 'Inventory product',
      description: 'x',
      price: 1,
      category: 'x',
      image: 'https://e.test/i.png',
      stock: 4,
      lowStockThreshold: 5,
    });
    const equalThreshold = await Product.create({
      name: 'Equal threshold',
      description: 'x',
      price: 1,
      category: 'x',
      image: 'https://e.test/e.png',
      stock: 5,
      lowStockThreshold: 5,
    });
    const aboveThreshold = await Product.create({
      name: 'Above threshold',
      description: 'x',
      price: 1,
      category: 'x',
      image: 'https://e.test/a.png',
      stock: 6,
      lowStockThreshold: 5,
    });
    let r = await request(app).get('/api/v1/admin/inventory');
    assert.equal(r.status, 401);
    r = await request(app).get('/api/v1/admin/inventory').set('Authorization', `Bearer ${ct}`);
    assert.equal(r.status, 403);
    r = await request(app).get('/api/v1/admin/inventory?page=1&limit=1').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.limit, 1);
    assert.equal(r.body.meta.total, 3);
    r = await request(app).post(`/api/v1/admin/inventory/${product._id}/adjust`).send({ quantityDelta: 1, reason: 'No token' });
    assert.equal(r.status, 401);
    r = await request(app)
      .post(`/api/v1/admin/inventory/${product._id}/adjust`)
      .set('Authorization', `Bearer ${ct}`)
      .send({ quantityDelta: 1, reason: 'Customer denied' });
    assert.equal(r.status, 403);
    r = await request(app)
      .post(`/api/v1/admin/inventory/${product._id}/adjust`)
      .set('Authorization', `Bearer ${at}`)
      .set('x-request-id', 'inventory-integration')
      .send({ quantityDelta: 10, reason: 'Integration restock' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.stock, 14);
    const movement = await InventoryMovement.findOne({ product: product._id }).lean();
    assert.equal(movement.quantityDelta, 10);
    assert.equal(movement.previousStock, 4);
    assert.equal(movement.newStock, 14);
    assert.equal(movement.requestId, 'inventory-integration');
    const audit = await AuditLog.findOne({ resourceId: String(product._id) }).lean();
    assert.equal(String(audit.actor), String(admin._id));
    assert.equal(audit.action, 'INVENTORY_ADJUSTED');
    r = await request(app).get('/api/v1/admin/inventory/low-stock').set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(
      r.body.data.some((entry: any) => entry.id === String(product._id)),
      false
    );
    assert.equal(
      r.body.data.some((entry: any) => entry.id === String(equalThreshold._id)),
      true,
      'threshold equality is low stock'
    );
    assert.equal(
      r.body.data.some((entry: any) => entry.id === String(aboveThreshold._id)),
      false
    );
    r = await request(app)
      .post(`/api/v1/admin/inventory/${product._id}/adjust`)
      .set('Authorization', `Bearer ${at}`)
      .send({ quantityDelta: -2, reason: 'Integration correction' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.stock, 12);
    const moves = await InventoryMovement.find({ product: product._id }).sort({ createdAt: -1 }).lean();
    assert.equal(moves.length, 2);
    assert.equal(moves[0].quantityDelta, -2);
    assert.equal(moves[0].previousStock, 14);
    assert.equal(moves[0].newStock, 12);
    assert.equal(String(moves[0].actor), String(admin._id));
    r = await request(app).get(`/api/v1/admin/inventory/${product._id}/movements`).set('Authorization', `Bearer ${at}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 2);
    assert.ok(r.body.data.every((m: any) => String(m.product) === String(product._id)));
    r = await request(app)
      .post(`/api/v1/admin/inventory/${product._id}/adjust`)
      .set('Authorization', `Bearer ${at}`)
      .send({ quantityDelta: -99, reason: 'Too much' });
    assert.equal(r.status, 409);
    assert.equal((await Product.findById(product._id).lean()).stock, 12);
    for (const body of [
      { quantityDelta: 0, reason: 'zero' },
      { quantityDelta: 1.5, reason: 'decimal' },
      { quantityDelta: 1 },
      { quantityDelta: 1, reason: '  ' },
      { quantityDelta: 1, reason: 'valid reason', stock: 0 },
      { quantityDelta: 1, reason: 'valid reason', previousStock: 0 },
      { quantityDelta: 1, reason: 'valid reason', userId: String(customer._id) },
      { quantityDelta: 1, reason: 'valid reason', actor: String(customer._id) },
      { quantityDelta: 1, reason: 'valid reason', role: 'SUPER_ADMIN' },
      { quantityDelta: 1, reason: 'valid reason', $set: { stock: 0 } },
      { quantityDelta: 1, reason: 'valid reason', $inc: { stock: 1 } },
      { quantityDelta: 1, reason: 'valid reason', $where: 'this.stock=0' },
    ]) {
      r = await request(app).post(`/api/v1/admin/inventory/${product._id}/adjust`).set('Authorization', `Bearer ${at}`).send(body);
      assert.equal(r.status, 400);
      assert.ok(!JSON.stringify(r.body).match(/mongoose|stack/i));
    }
    r = await request(app)
      .post('/api/v1/admin/inventory/bad-id/adjust')
      .set('Authorization', `Bearer ${at}`)
      .send({ quantityDelta: 1, reason: 'valid reason' });
    assert.ok([400, 404].includes(r.status));
    r = await request(app)
      .post('/api/v1/admin/inventory/000000000000000000000000/adjust')
      .set('Authorization', `Bearer ${at}`)
      .send({ quantityDelta: 1, reason: 'valid reason' });
    assert.equal(r.status, 409);
    r = await request(app).get('/api/v1/admin/inventory/bad-id/movements').set('Authorization', `Bearer ${at}`);
    assert.ok([400, 404].includes(r.status));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
