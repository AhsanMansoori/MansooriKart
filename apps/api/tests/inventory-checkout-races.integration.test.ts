import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { Cart } from '../src/models/cart.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { StockLocation } from '../src/models/stockLocation.js';
import { User } from '../src/models/user.js';
import { Warehouse } from '../src/models/warehouse.js';
import { ensureDefaultWarehouse } from '../src/services/inventoryService.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const auth = (user: any, role: string) => `Bearer ${jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!)}`;

async function fixture(suffix: string) {
  const [customer, admin] = await User.create([
    { name: 'Customer', email: `customer-${suffix}@race.test`, password: 'x', role: 'CUSTOMER' },
    { name: 'Admin', email: `admin-${suffix}@race.test`, password: 'x', role: 'SUPER_ADMIN' },
  ]);
  const product = await Product.create({
    name: `Race ${suffix}`,
    slug: `race-${suffix}`,
    sku: `RACE-${suffix}`,
    description: 'x',
    category: 'x',
    image: 'https://e.test/x',
    price: 100,
    stock: 1,
    status: 'ACTIVE',
  });
  const address = await Address.create({ user: customer._id, fullName: 'Customer', phone: '123', addressLine1: 'Street', city: 'Karachi', country: 'PK' });
  await Cart.create({ user: customer._id, items: [{ product: product._id, quantity: 1 }] });
  const defaults = await ensureDefaultWarehouse();
  let destinationWarehouse = await Warehouse.create({ name: `Destination ${suffix}`, code: `DST-${suffix}`, status: 'ACTIVE' });
  const destinationLocation = await StockLocation.create({ warehouse: destinationWarehouse._id, name: 'Destination', code: 'PRIMARY', status: 'ACTIVE' });
  return { customer, admin, product, address, defaults, destinationWarehouse, destinationLocation };
}

test('checkout races transfer and negative adjustment without consuming the final unit twice', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const transferRace = await fixture('transfer');
    const checkoutRequest = request(app)
      .post('/api/v1/checkout')
      .set('Authorization', auth(transferRace.customer, 'CUSTOMER'))
      .set('Idempotency-Key', 'checkout-transfer-race')
      .send({ addressId: String(transferRace.address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    const transferRequest = request(app)
      .post('/api/v1/admin/inventory/transfers')
      .set('Authorization', auth(transferRace.admin, 'SUPER_ADMIN'))
      .set('Idempotency-Key', 'transfer-checkout-race')
      .send({
        productId: String(transferRace.product._id),
        sourceWarehouseId: String(transferRace.defaults.warehouse._id),
        sourceLocationId: String(transferRace.defaults.location._id),
        destinationWarehouseId: String(transferRace.destinationWarehouse._id),
        destinationLocationId: String(transferRace.destinationLocation._id),
        quantity: 1,
        reason: 'Race transfer',
      });
    const [checkout, transfer] = await Promise.all([checkoutRequest, transferRequest]);
    assert.equal(
      [checkout.status, transfer.status].filter(status => status === 201).length,
      1,
      JSON.stringify({ checkout: checkout.body, transfer: transfer.body })
    );
    const balances = await InventoryBalance.find({ product: transferRace.product._id }).lean();
    const expectedTotal = checkout.status === 201 ? 0 : 1;
    assert.equal(
      balances.reduce((sum: number, balance: any) => sum + balance.quantityOnHand, 0),
      expectedTotal
    );
    assert.equal((await Product.findById(transferRace.product._id).lean()).stock, expectedTotal);
    assert.equal(await Order.countDocuments({ customer: transferRace.customer._id }), checkout.status === 201 ? 1 : 0);
    assert.ok((await InventoryMovement.find({ product: transferRace.product._id }).lean()).every((movement: any) => movement.newStock >= 0));

    const adjustmentRace = await fixture('adjustment');
    const checkoutAdjustment = request(app)
      .post('/api/v1/checkout')
      .set('Authorization', auth(adjustmentRace.customer, 'CUSTOMER'))
      .set('Idempotency-Key', 'checkout-adjustment-race')
      .send({ addressId: String(adjustmentRace.address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    const adjustment = request(app)
      .post('/api/v1/admin/inventory/adjustments')
      .set('Authorization', auth(adjustmentRace.admin, 'SUPER_ADMIN'))
      .send({
        productId: String(adjustmentRace.product._id),
        warehouseId: String(adjustmentRace.defaults.warehouse._id),
        locationId: String(adjustmentRace.defaults.location._id),
        quantityDelta: -1,
        reason: 'Race adjustment',
      });
    const [checkoutResult, adjustmentResult] = await Promise.all([checkoutAdjustment, adjustment]);
    assert.equal([checkoutResult.status, adjustmentResult.status].filter(status => status === 201 || status === 200).length, 1);
    const adjustmentBalances = await InventoryBalance.find({ product: adjustmentRace.product._id }).lean();
    assert.equal(
      adjustmentBalances.reduce((sum: number, balance: any) => sum + balance.quantityOnHand, 0),
      0
    );
    assert.equal((await Product.findById(adjustmentRace.product._id).lean()).stock, 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test('cancellation restores the default fulfillment balance exactly once', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const data = await fixture('cancel');
    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', auth(data.customer, 'CUSTOMER'))
      .set('Idempotency-Key', 'cancel-balance-check')
      .send({ addressId: String(data.address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(checkout.status, 201);
    const orderId = checkout.body.data._id;
    let balance = await InventoryBalance.findOne({
      product: data.product._id,
      warehouse: data.defaults.warehouse._id,
      location: data.defaults.location._id,
    }).lean();
    assert.equal(balance.quantityOnHand, 0);
    const cancel = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set('Authorization', auth(data.customer, 'CUSTOMER')).send({});
    assert.equal(cancel.status, 200);
    balance = await InventoryBalance.findOne({
      product: data.product._id,
      warehouse: data.defaults.warehouse._id,
      location: data.defaults.location._id,
    }).lean();
    assert.equal(balance.quantityOnHand, 1);
    assert.equal((await Product.findById(data.product._id).lean()).stock, 1);
    assert.equal(
      await InventoryMovement.countDocuments({
        product: data.product._id,
        type: 'CANCELLATION',
        warehouse: data.defaults.warehouse._id,
        location: data.defaults.location._id,
      }),
      1
    );
    const second = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set('Authorization', auth(data.customer, 'CUSTOMER')).send({});
    assert.ok([400, 409].includes(second.status));
    assert.equal(
      (await InventoryBalance.findOne({ product: data.product._id, warehouse: data.defaults.warehouse._id, location: data.defaults.location._id }).lean())
        .quantityOnHand,
      1
    );
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test('low and out-of-stock endpoints aggregate authoritative balances across warehouses', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const data = await fixture('aggregate');
    await Product.updateOne({ _id: data.product._id }, { $set: { stock: 6, lowStockThreshold: 5 } });
    const products = await Product.create([
      {
        name: 'Six',
        slug: 'six',
        sku: 'LOW-006',
        description: 'x',
        category: 'x',
        image: 'https://e.test/6',
        price: 1,
        stock: 6,
        lowStockThreshold: 5,
        status: 'ACTIVE',
      },
      {
        name: 'Five',
        slug: 'five',
        sku: 'LOW-005',
        description: 'x',
        category: 'x',
        image: 'https://e.test/5',
        price: 1,
        stock: 5,
        lowStockThreshold: 5,
        status: 'ACTIVE',
      },
      {
        name: 'Four',
        slug: 'four',
        sku: 'LOW-004',
        description: 'x',
        category: 'x',
        image: 'https://e.test/4',
        price: 1,
        stock: 4,
        lowStockThreshold: 5,
        status: 'ACTIVE',
      },
      {
        name: 'Zero',
        slug: 'zero',
        sku: 'LOW-000',
        description: 'x',
        category: 'x',
        image: 'https://e.test/0',
        price: 1,
        stock: 0,
        lowStockThreshold: 5,
        status: 'ACTIVE',
      },
    ]);
    await InventoryBalance.create([
      { product: products[0]._id, warehouse: data.defaults.warehouse._id, location: data.defaults.location._id, quantityOnHand: 6, quantityReserved: 0 },
      { product: products[1]._id, warehouse: data.defaults.warehouse._id, location: data.defaults.location._id, quantityOnHand: 5, quantityReserved: 0 },
      { product: products[2]._id, warehouse: data.defaults.warehouse._id, location: data.defaults.location._id, quantityOnHand: 2, quantityReserved: 0 },
      { product: products[2]._id, warehouse: data.destinationWarehouse._id, location: data.destinationLocation._id, quantityOnHand: 2, quantityReserved: 0 },
      { product: products[3]._id, warehouse: data.defaults.warehouse._id, location: data.defaults.location._id, quantityOnHand: 0, quantityReserved: 0 },
      { product: products[3]._id, warehouse: data.destinationWarehouse._id, location: data.destinationLocation._id, quantityOnHand: 0, quantityReserved: 0 },
    ]);
    const token = auth(data.admin, 'SUPER_ADMIN');
    const low = await request(app).get('/api/v1/admin/inventory/low-stock').set('Authorization', token);
    assert.equal(low.status, 200);
    assert.deepEqual(low.body.data.map((item: any) => item.id).sort(), [String(products[1]._id), String(products[2]._id)].sort());
    const out = await request(app).get('/api/v1/admin/inventory/out-of-stock').set('Authorization', token);
    assert.equal(out.status, 200);
    assert.deepEqual(
      out.body.data.map((item: any) => item.id),
      [String(products[3]._id)]
    );
    const dashboard = await request(app).get('/api/v1/admin/inventory/dashboard').set('Authorization', token);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.data.lowStockItems, 2);
    assert.equal(dashboard.body.data.outOfStockItems, 1);
    assert.equal(dashboard.body.data.totalUnits, 15);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
