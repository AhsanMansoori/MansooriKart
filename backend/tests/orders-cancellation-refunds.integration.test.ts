import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Cart } from '../src/models/cart.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { Refund } from '../src/models/refund.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('cancellation restores inventory exactly once and refunds stay idempotent and capped under concurrency', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    // Unique indexes are the durable idempotency authority, so they must exist before concurrency.
    await Promise.all([Order.init(), Refund.init(), InventoryBalance.init()]);
    const [customer, other, admin] = await User.create([
      { name: 'Cancel Customer', email: 'cancel@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Other Customer', email: 'other@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@d.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const token = (user: any, role: string) => jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!);
    const [ct, ot, st] = [token(customer, 'CUSTOMER'), token(other, 'CUSTOMER'), token(admin, 'SUPER_ADMIN')];
    const address = await Address.create({
      user: customer._id,
      fullName: 'Cancel Customer',
      phone: '03001',
      addressLine1: 'House 1',
      city: 'Karachi',
      country: 'PK',
    });
    const product = await Product.create({
      name: 'Cancellable item',
      sku: 'CANCEL-SKU',
      description: 'x',
      price: 1000,
      category: 'x',
      image: 'https://e/1',
      stock: 30,
      status: 'ACTIVE',
    });
    const balanceOf = async () => (await InventoryBalance.findOne({ product: product._id }).lean())?.quantityOnHand;
    const stockOf = async () => (await Product.findById(product._id).lean())!.stock;
    const placeOrder = async (key: string, quantity: number) => {
      await Cart.findOneAndUpdate({ user: customer._id }, { $set: { items: [{ product: product._id, quantity }] } }, { upsert: true });
      const response = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${ct}`)
        .set('Idempotency-Key', key)
        .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' });
      assert.equal(response.status, 201);
      return response.body.data;
    };

    // ---- Admin cancellation of an eligible order restores inventory exactly once. ----
    const first = await placeOrder('cancel-order-one', 3);
    assert.equal(await balanceOf(), 27);
    assert.equal(await stockOf(), 27);
    assert.equal(await InventoryMovement.countDocuments({ product: product._id, type: 'ORDER' }), 1);
    assert.equal((await request(app).post(`/api/v1/admin/orders/${first._id}/cancel`).set('Authorization', `Bearer ${ot}`).send({})).status, 403);
    assert.equal((await request(app).post(`/api/v1/admin/orders/${first._id}/cancel`).send({})).status, 401);
    assert.equal(await balanceOf(), 27, 'a rejected admin cancellation must not touch inventory');

    let r = await request(app).post(`/api/v1/admin/orders/${first._id}/cancel`).set('Authorization', `Bearer ${st}`).send({});
    assert.equal(r.status, 200);
    assert.equal(r.body.data.orderStatus, 'CANCELLED');
    assert.equal(await balanceOf(), 30);
    assert.equal(await stockOf(), 30);
    assert.equal(await InventoryMovement.countDocuments({ type: 'CANCELLATION', referenceType: 'Order', referenceId: String(first._id) }), 1);
    const history = (await Order.findById(first._id).lean())!.statusHistory;
    assert.equal(history.at(-1).to, 'CANCELLED');
    assert.equal(history.at(-1).reason, 'Admin cancellation');
    assert.equal(await AuditLog.countDocuments({ resourceId: String(first._id), action: 'ORDER_ADMIN_CANCELLED' }), 1);

    // A repeat cancellation must not restore inventory a second time.
    r = await request(app).post(`/api/v1/admin/orders/${first._id}/cancel`).set('Authorization', `Bearer ${st}`).send({});
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'ORDER_NOT_CANCELLABLE');
    assert.equal(await balanceOf(), 30);
    assert.equal(await stockOf(), 30);
    assert.equal(await InventoryMovement.countDocuments({ type: 'CANCELLATION', referenceType: 'Order', referenceId: String(first._id) }), 1);
    assert.equal(await AuditLog.countDocuments({ resourceId: String(first._id), action: 'ORDER_ADMIN_CANCELLED' }), 1);
    // The customer route must equally refuse an already-cancelled order.
    r = await request(app).post(`/api/v1/orders/${first._id}/cancel`).set('Authorization', `Bearer ${ct}`).send({});
    assert.equal(r.status, 400);
    assert.equal(await balanceOf(), 30);
    // Invalid forward transition from a terminal state.
    r = await request(app)
      .patch(`/api/v1/admin/orders/${first._id}/status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ status: 'CONFIRMED', reason: 'Invalid revival' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'ORDER_TRANSITION_INVALID');

    // ---- Genuine admin-vs-customer cancellation race on one eligible order. ----
    const raced = await placeOrder('cancel-order-race', 4);
    assert.equal(await balanceOf(), 26);
    const [customerAttempt, adminAttempt] = await Promise.all([
      request(app).post(`/api/v1/orders/${raced._id}/cancel`).set('Authorization', `Bearer ${ct}`).send({}),
      request(app).post(`/api/v1/admin/orders/${raced._id}/cancel`).set('Authorization', `Bearer ${st}`).send({}),
    ]);
    const statuses = [customerAttempt.status, adminAttempt.status];
    assert.equal(statuses.filter(status => status === 200).length, 1, `exactly one cancellation must win, got ${statuses.join('/')}`);
    assert.equal(await balanceOf(), 30, 'inventory must be restored exactly once by the race');
    assert.equal(await stockOf(), 30);
    assert.equal(await InventoryMovement.countDocuments({ type: 'CANCELLATION', referenceType: 'Order', referenceId: String(raced._id) }), 1);
    assert.equal(await AuditLog.countDocuments({ resourceId: String(raced._id), action: { $in: ['ORDER_CANCELLED', 'ORDER_ADMIN_CANCELLED'] } }), 1);
    const racedOrder = await Order.findById(raced._id).lean();
    assert.equal(racedOrder!.orderStatus, 'CANCELLED');
    assert.equal(racedOrder!.statusHistory.filter((entry: any) => entry.to === 'CANCELLED').length, 1);

    // ---- Refund idempotency and cap safety on a delivered, paid order. ----
    const payable = await placeOrder('cancel-order-refundable', 1);
    assert.equal(payable.total, 1250);
    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'])
      assert.equal(
        (await request(app).patch(`/api/v1/admin/orders/${payable._id}/status`).set('Authorization', `Bearer ${st}`).send({ status, reason: 'Refund fixture' }))
          .status,
        200
      );
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${payable._id}/payment-status`)
          .set('Authorization', `Bearer ${st}`)
          .send({ paymentStatus: 'PAID', reason: 'COD collected' })
      ).status,
      200
    );
    const refundUrl = `/api/v1/admin/orders/${payable._id}/refunds`;
    const postRefund = (key: string, amount: number) =>
      request(app).post(refundUrl).set('Authorization', `Bearer ${st}`).set('Idempotency-Key', key).send({ amount, reason: 'Manual COD refund' });

    // Sequential replay of the same Idempotency-Key yields one logical refund.
    const created = await postRefund('refund-idem-key-1', 500);
    assert.equal(created.status, 201);
    const replay = await postRefund('refund-idem-key-1', 500);
    assert.equal(replay.status, 201);
    assert.equal(String(replay.body.data._id), String(created.body.data._id));
    assert.equal(replay.body.data.refundNumber, created.body.data.refundNumber);
    assert.equal(await Refund.countDocuments({ order: payable._id }), 1);
    assert.equal((await Order.findById(payable._id).lean())!.refundedTotal, 500);
    // A replay must not be able to smuggle a different amount through the same key.
    const tampered = await postRefund('refund-idem-key-1', 900);
    assert.equal(tampered.status, 201);
    assert.equal(tampered.body.data.amount, 500);
    assert.equal(await Refund.countDocuments({ order: payable._id }), 1);
    assert.equal((await Order.findById(payable._id).lean())!.refundedTotal, 500);

    // Concurrent duplicate requests under one key must still produce a single refund.
    const concurrentDuplicates = await Promise.all([
      postRefund('refund-idem-key-2', 200),
      postRefund('refund-idem-key-2', 200),
      postRefund('refund-idem-key-2', 200),
    ]);
    assert.deepEqual(
      concurrentDuplicates.map(response => response.status),
      [201, 201, 201]
    );
    assert.equal(new Set(concurrentDuplicates.map(response => String(response.body.data._id))).size, 1);
    assert.equal(await Refund.countDocuments({ order: payable._id, idempotencyKey: 'refund-idem-key-2' }), 1);
    assert.equal((await Order.findById(payable._id).lean())!.refundedTotal, 700);

    // Refund cap: 1250 total, 700 already refunded, 550 remaining. Two concurrent 500s must not
    // both be accepted, and the accepted total may never exceed the order total.
    const remaining = 1250 - 700;
    assert.equal(remaining, 550);
    const capRace = await Promise.all([postRefund('refund-cap-key-a', 500), postRefund('refund-cap-key-b', 500)]);
    assert.equal(
      capRace.filter(response => response.status === 201).length,
      1,
      `exactly one capped refund may win, got ${capRace.map(x => x.status).join('/')}`
    );
    const rejected = capRace.find(response => response.status !== 201)!;
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error.code, 'REFUND_AMOUNT_INVALID');
    // Aggregation does not cast, so the raw pipeline needs an explicit ObjectId.
    const accepted = await Refund.aggregate([
      { $match: { order: new mongoose.Types.ObjectId(String(payable._id)), status: { $ne: 'FAILED' } } },
      { $group: { _id: null, value: { $sum: '$amount' } } },
    ]);
    assert.equal(accepted[0].value, 1200);
    assert.ok(accepted[0].value <= 1250, 'accepted refunds may never exceed the order total');
    const afterRace = await Order.findById(payable._id).lean();
    assert.equal(afterRace!.refundedTotal, 1200);
    assert.ok(afterRace!.refundedTotal <= afterRace!.total);

    // Over-cap and non-positive amounts are refused outright.
    assert.equal((await postRefund('refund-over-cap-key', 100)).status, 400);
    assert.equal((await postRefund('refund-zero-key', 0)).status, 400);
    assert.equal((await postRefund('refund-negative-key', -50)).status, 400);
    assert.equal((await request(app).post(refundUrl).set('Authorization', `Bearer ${st}`).send({ amount: 10, reason: 'No key' })).status, 400);

    // A FAILED refund releases its headroom so the accounting matches the sales dashboard.
    const failing = await postRefund('refund-release-key', 50);
    assert.equal(failing.status, 201);
    assert.equal((await Order.findById(payable._id).lean())!.refundedTotal, 1250);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/refunds/${failing.body.data._id}/status`).set('Authorization', `Bearer ${st}`).send({ status: 'FAILED' }))
        .status,
      200
    );
    assert.equal((await Order.findById(payable._id).lean())!.refundedTotal, 1200);
    assert.equal((await postRefund('refund-after-release-key', 50)).status, 201);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
