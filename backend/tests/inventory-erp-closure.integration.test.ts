import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { InventoryTransfer } from '../src/models/inventoryTransfer.js';
import { Product } from '../src/models/product.js';
import { StockLocation } from '../src/models/stockLocation.js';
import { User } from '../src/models/user.js';
import { Warehouse } from '../src/models/warehouse.js';
import { adjustStockWithAudit, InventoryError, transferStock } from '../src/services/inventoryService.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('inventory ERP persists balances, preserves transfers, and protects admin mutations', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Warehouse.init(), StockLocation.init(), InventoryBalance.init(), InventoryTransfer.init()]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'erp-admin@test.local', password: 'x', role: 'SUPER_ADMIN' },
      { name: 'Customer', email: 'erp-customer@test.local', password: 'x', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };
    const product = await Product.create({
      name: 'ERP stock',
      slug: 'erp-stock',
      sku: 'ERP-001',
      description: 'x',
      category: 'x',
      image: 'https://e.test/x',
      price: 1,
      stock: 10,
      lowStockThreshold: 5,
      status: 'ACTIVE',
    });
    let response = await request(app).get('/api/v1/admin/inventory/warehouses');
    assert.equal(response.status, 401);
    response = await request(app).get('/api/v1/admin/inventory/warehouses').set('Authorization', `Bearer ${customerToken}`);
    assert.equal(response.status, 403);
    response = await request(app).get('/api/v1/admin/inventory/bootstrap-default').set(auth);
    assert.equal(response.status, 200);
    const main = response.body.data;
    const repeat = await request(app).get('/api/v1/admin/inventory/bootstrap-default').set(auth);
    assert.deepEqual(repeat.body.data, main);
    assert.equal(await Warehouse.countDocuments({ isDefault: true }), 1);
    response = await request(app).post('/api/v1/admin/inventory/warehouses').set(auth).send({ name: 'Second', code: 'SECOND' });
    assert.equal(response.status, 201);
    const second = response.body.data;
    response = await request(app).post('/api/v1/admin/inventory/warehouses').set(auth).send({ name: 'Duplicate', code: 'SECOND' });
    assert.equal(response.status, 409);
    response = await request(app).post('/api/v1/admin/inventory/locations').set(auth).send({ warehouseId: second.id, name: 'Rack A', code: 'A-01' });
    assert.equal(response.status, 201);
    const destination = response.body.data;
    response = await request(app).post('/api/v1/admin/inventory/locations').set(auth).send({ warehouseId: second.id, name: 'Duplicate', code: 'A-01' });
    assert.equal(response.status, 409);
    response = await request(app)
      .post('/api/v1/admin/inventory/locations')
      .set(auth)
      .send({ warehouseId: main.warehouseId, name: 'Same code other warehouse', code: 'A-01' });
    assert.equal(response.status, 201);
    response = await request(app)
      .post('/api/v1/admin/inventory/adjustments')
      .set(auth)
      .send({
        productId: String(product._id),
        warehouseId: main.warehouseId,
        locationId: main.locationId,
        quantityDelta: -1,
        reason: 'Verify default backfill',
      });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.stock, 9);
    let balances = await InventoryBalance.find({ product: product._id }).lean();
    assert.equal(balances.length, 1);
    assert.equal(balances[0].quantityOnHand, 9);
    response = await request(app)
      .post('/api/v1/admin/inventory/adjustments')
      .set(auth)
      .send({ productId: String(product._id), warehouseId: main.warehouseId, locationId: main.locationId, quantityDelta: 1, reason: 'Restore backfill check' });
    assert.equal(response.status, 200);
    assert.equal((await Product.findById(product._id).lean()).stock, 10);
    response = await request(app)
      .post('/api/v1/admin/inventory/transfers')
      .set(auth)
      .set('Idempotency-Key', 'transfer-erp-0001')
      .send({
        productId: String(product._id),
        sourceWarehouseId: main.warehouseId,
        sourceLocationId: main.locationId,
        destinationWarehouseId: second.id,
        destinationLocationId: destination.id,
        quantity: 4,
        reason: 'Move inventory',
      });
    assert.equal(response.status, 201);
    const transferId = response.body.data._id;
    balances = await InventoryBalance.find({ product: product._id }).lean();
    assert.equal(
      balances.reduce((sum: number, item: any) => sum + item.quantityOnHand, 0),
      10
    );
    assert.equal(balances.find((item: any) => String(item.location) === main.locationId).quantityOnHand, 6);
    assert.equal(balances.find((item: any) => String(item.location) === destination.id).quantityOnHand, 4);
    assert.equal((await Product.findById(product._id).lean()).stock, 10);
    assert.equal(await InventoryMovement.countDocuments({ referenceId: String(transferId) }), 2);
    const replay = await request(app)
      .post('/api/v1/admin/inventory/transfers')
      .set(auth)
      .set('Idempotency-Key', 'transfer-erp-0001')
      .send({
        productId: String(product._id),
        sourceWarehouseId: main.warehouseId,
        sourceLocationId: main.locationId,
        destinationWarehouseId: second.id,
        destinationLocationId: destination.id,
        quantity: 4,
        reason: 'Move inventory',
      });
    assert.equal(replay.status, 201);
    assert.equal(await InventoryTransfer.countDocuments(), 1);
    response = await request(app)
      .post('/api/v1/admin/inventory/transfers')
      .set(auth)
      .set('Idempotency-Key', 'self-erp-0001')
      .send({
        productId: String(product._id),
        sourceWarehouseId: main.warehouseId,
        sourceLocationId: main.locationId,
        destinationWarehouseId: main.warehouseId,
        destinationLocationId: main.locationId,
        quantity: 1,
        reason: 'Self transfer',
      });
    assert.equal(response.status, 400);
    response = await request(app)
      .post('/api/v1/admin/inventory/transfers')
      .set(auth)
      .set('Idempotency-Key', 'too-much-0001')
      .send({
        productId: String(product._id),
        sourceWarehouseId: main.warehouseId,
        sourceLocationId: main.locationId,
        destinationWarehouseId: second.id,
        destinationLocationId: destination.id,
        quantity: 99,
        reason: 'Too much stock',
      });
    assert.equal(response.status, 409);
    assert.equal(await AuditLog.countDocuments({ action: 'INVENTORY_TRANSFERRED' }), 1);
    const concurrentBody = {
      productId: String(product._id),
      sourceWarehouseId: main.warehouseId,
      sourceLocationId: main.locationId,
      destinationWarehouseId: second.id,
      destinationLocationId: destination.id,
      quantity: 4,
      reason: 'Concurrent limited transfer',
    };
    const [firstConcurrent, secondConcurrent] = await Promise.all([
      request(app).post('/api/v1/admin/inventory/transfers').set(auth).set('Idempotency-Key', 'concurrent-erp-0001').send(concurrentBody),
      request(app).post('/api/v1/admin/inventory/transfers').set(auth).set('Idempotency-Key', 'concurrent-erp-0002').send(concurrentBody),
    ]);
    assert.equal([firstConcurrent.status, secondConcurrent.status].filter(value => value === 201).length, 1);
    assert.equal([firstConcurrent.status, secondConcurrent.status].filter(value => value === 409).length, 1);
    const sameKeyBody = { ...concurrentBody, quantity: 1, reason: 'Concurrent replay transfer' };
    const [sameKeyA, sameKeyB] = await Promise.all([
      request(app).post('/api/v1/admin/inventory/transfers').set(auth).set('Idempotency-Key', 'same-key-erp-0001').send(sameKeyBody),
      request(app).post('/api/v1/admin/inventory/transfers').set(auth).set('Idempotency-Key', 'same-key-erp-0001').send(sameKeyBody),
    ]);
    assert.equal(sameKeyA.status, 201);
    assert.equal(sameKeyB.status, 201);
    balances = await InventoryBalance.find({ product: product._id }).lean();
    assert.equal(
      balances.reduce((sum: number, item: any) => sum + item.quantityOnHand, 0),
      10
    );
    assert.equal(await InventoryTransfer.countDocuments(), 3);
    assert.equal(await AuditLog.countDocuments({ action: 'INVENTORY_TRANSFERRED' }), 3);
    const beforeForcedTransfer = await InventoryBalance.find({ product: product._id }).lean();
    await assert.rejects(() =>
      transferStock({
        productId: String(product._id),
        sourceWarehouseId: main.warehouseId,
        sourceLocationId: main.locationId,
        destinationWarehouseId: second.id,
        destinationLocationId: destination.id,
        quantity: 1,
        reason: 'x'.repeat(501),
        actor: String(admin._id),
        idempotencyKey: 'forced-failure-0001',
      })
    );
    const afterForcedTransfer = await InventoryBalance.find({ product: product._id }).lean();
    assert.equal(
      afterForcedTransfer.reduce((sum: number, item: any) => sum + item.quantityOnHand, 0),
      beforeForcedTransfer.reduce((sum: number, item: any) => sum + item.quantityOnHand, 0)
    );
    assert.deepEqual(
      afterForcedTransfer.map((item: any) => [String(item.location), item.quantityOnHand]).sort(),
      beforeForcedTransfer.map((item: any) => [String(item.location), item.quantityOnHand]).sort()
    );
    assert.equal(await InventoryTransfer.countDocuments({ idempotencyKey: 'forced-failure-0001' }), 0);
    response = await request(app)
      .get(
        `/api/v1/admin/inventory/movements?product=${product._id}&warehouse=${main.warehouseId}&type=TRANSFER_OUT&referenceType=InventoryTransfer&referenceId=${transferId}&page=1&limit=1`
      )
      .set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.limit, 1);
    assert.equal(response.body.meta.total, 1);
    assert.equal(response.body.data[0].type, 'TRANSFER_OUT');
    const firstMovement = await InventoryMovement.findOne({ referenceId: String(transferId) }).lean();
    response = await request(app)
      .get(`/api/v1/admin/inventory/movements?from=${new Date(firstMovement.createdAt).toISOString()}&to=${new Date(firstMovement.createdAt).toISOString()}`)
      .set(auth);
    assert.equal(response.status, 200);
    assert.ok(response.body.data.length >= 1);
    response = await request(app).get('/api/v1/admin/inventory/movements').set('Authorization', `Bearer ${customerToken}`);
    assert.equal(response.status, 403);
    response = await request(app).get('/api/v1/admin/inventory/dashboard').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.totalUnits, 10);
    assert.equal(response.body.data.availableUnits, 10);
    assert.equal(response.body.data.totalSKUs, 1);
    response = await request(app)
      .post('/api/v1/admin/inventory/adjustments')
      .set(auth)
      .send({ productId: String(product._id), quantityDelta: 1, reason: 'unsafe payload', actor: String(customer._id) });
    assert.equal(response.status, 400);
    const beforeAuditFailure = await Product.findById(product._id).lean();
    await assert.rejects(
      () =>
        adjustStockWithAudit({ productId: String(product._id), quantityDelta: -1, reason: 'Controlled audit failure', actor: String(admin._id) }, async () => {
          throw new Error('audit persistence failure');
        }),
      (error: any) => error instanceof InventoryError && error.code === 'ADJUSTMENT_AUDIT_FAILED'
    );
    assert.equal((await Product.findById(product._id).lean()).stock, beforeAuditFailure.stock);
    assert.equal(
      (await InventoryBalance.find({ product: product._id }).lean()).reduce((sum: number, item: any) => sum + item.quantityOnHand, 0),
      beforeAuditFailure.stock
    );
    response = await request(app).get('/api/v1/admin/inventory/warehouses/not-an-id').set(auth);
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).match(/mongoose|casterror|stack/i), null);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
