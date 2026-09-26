import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
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
import { ReturnRequest } from '../src/models/return.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const MALFORMED = ['not-an-id', '123', '%20', 'null', "' or 1=1", '{"$ne":null}', 'aaaaaaaaaaaaaaaaaaaaaaaaa'];

test('returns, audit trails, ownership boundaries and strict contracts hold across orders and sales', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Order.init(), Refund.init(), ReturnRequest.init(), InventoryBalance.init()]);
    const [a, b, admin] = await User.create([
      { name: 'Customer A', email: 'a@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Customer B', email: 'b@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@d.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const token = (user: any, role: string) => jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!);
    const [at, bt, st] = [token(a, 'CUSTOMER'), token(b, 'CUSTOMER'), token(admin, 'SUPER_ADMIN')];
    const [addressA, addressB] = await Promise.all([
      Address.create({ user: a._id, fullName: 'Customer A', phone: '03001', addressLine1: 'House 1', city: 'Karachi', country: 'PK' }),
      Address.create({ user: b._id, fullName: 'Customer B', phone: '03002', addressLine1: 'House 2', city: 'Lahore', country: 'PK' }),
    ]);
    const product = await Product.create({
      name: 'Returnable item',
      sku: 'RETURN-SKU',
      description: 'x',
      price: 1000,
      category: 'x',
      image: 'https://e/1',
      stock: 40,
      status: 'ACTIVE',
    });
    const place = async (customer: any, customerToken: string, addressId: string, key: string, quantity: number) => {
      await Cart.findOneAndUpdate({ user: customer._id }, { $set: { items: [{ product: product._id, quantity }] } }, { upsert: true });
      const response = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({ addressId, paymentMethod: 'CASH_ON_DELIVERY' });
      assert.equal(response.status, 201);
      return response.body.data;
    };
    const deliver = async (id: string) => {
      for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'])
        assert.equal(
          (await request(app).patch(`/api/v1/admin/orders/${id}/status`).set('Authorization', `Bearer ${st}`).send({ status, reason: 'Return fixture' }))
            .status,
          200
        );
      assert.equal(
        (
          await request(app)
            .patch(`/api/v1/admin/orders/${id}/payment-status`)
            .set('Authorization', `Bearer ${st}`)
            .send({ paymentStatus: 'PAID', reason: 'COD collected' })
        ).status,
        200
      );
    };

    const orderA = await place(a, at, String(addressA._id), 'returns-order-a', 3);
    const orderB = await place(b, bt, String(addressB._id), 'returns-order-b', 1);
    await deliver(String(orderA._id));

    // ---- Ownership boundaries: customer B may not touch customer A's order. ----
    for (const url of [
      `/api/v1/orders/${orderA._id}`,
      `/api/v1/orders/${orderA._id}/tracking`,
      `/api/v1/orders/${orderA._id}/invoice`,
      `/api/v1/orders/${orderA._id}/invoice.pdf`,
    ]) {
      assert.equal((await request(app).get(url).set('Authorization', `Bearer ${bt}`)).status, 404, `${url} must be invisible to another customer`);
      assert.equal((await request(app).get(url)).status, 401);
    }
    assert.equal((await request(app).post(`/api/v1/orders/${orderA._id}/cancel`).set('Authorization', `Bearer ${bt}`).send({})).status, 404);
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/orders/${orderA._id}/returns`)
          .set('Authorization', `Bearer ${bt}`)
          .send({ items: [{ productId: String(product._id), quantity: 1 }], reason: 'Not mine' })
      ).status,
      404
    );
    assert.equal(await ReturnRequest.countDocuments({}), 0);
    let r = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.map((order: any) => String(order._id)),
      [String(orderB._id)],
      'the customer order list is scoped to the caller'
    );

    // ---- Return foundation and quantity safety. ----
    r = await request(app)
      .post(`/api/v1/orders/${orderA._id}/returns`)
      .set('Authorization', `Bearer ${at}`)
      .send({ items: [{ productId: String(product._id), quantity: 5 }], reason: 'Too many' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'RETURN_QUANTITY_INVALID');
    r = await request(app)
      .post(`/api/v1/orders/${orderB._id}/returns`)
      .set('Authorization', `Bearer ${bt}`)
      .send({ items: [{ productId: String(product._id), quantity: 1 }], reason: 'Not delivered yet' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'RETURN_NOT_ELIGIBLE');
    r = await request(app)
      .post(`/api/v1/orders/${orderA._id}/returns`)
      .set('Authorization', `Bearer ${at}`)
      .send({ items: [{ productId: String(product._id), quantity: 2 }], reason: 'Damaged on arrival' });
    assert.equal(r.status, 201);
    const returnId = r.body.data.id;
    assert.equal(r.body.data.status, 'REQUESTED');
    assert.match(r.body.data.returnNumber, /^RET-\d{8}-[0-9A-F]{6}$/);
    // Remaining purchased quantity is 1, so a further 2 must be refused.
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/orders/${orderA._id}/returns`)
          .set('Authorization', `Bearer ${at}`)
          .send({ items: [{ productId: String(product._id), quantity: 2 }], reason: 'Second attempt' })
      ).status,
      400
    );
    assert.equal((await request(app).get(`/api/v1/returns/${returnId}`).set('Authorization', `Bearer ${bt}`)).status, 404);
    assert.equal((await request(app).get(`/api/v1/returns/${returnId}`).set('Authorization', `Bearer ${at}`)).status, 200);

    // ---- Admin return list, detail, workflow and authorization. ----
    assert.equal((await request(app).get('/api/v1/admin/returns')).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/returns').set('Authorization', `Bearer ${at}`)).status, 403);
    r = await request(app).get('/api/v1/admin/returns').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.total, 1);
    assert.equal(r.body.data[0].customer.email, 'a@d.test');
    assert.equal(r.body.data[0].order.orderNumber, orderA.orderNumber);
    assert.ok(!JSON.stringify(r.body).toLowerCase().includes('password'));
    assert.equal((await request(app).get('/api/v1/admin/returns?status=REQUESTED').set('Authorization', `Bearer ${st}`)).body.meta.total, 1);
    assert.equal((await request(app).get('/api/v1/admin/returns?status=COMPLETED').set('Authorization', `Bearer ${st}`)).body.meta.total, 0);
    assert.equal((await request(app).get('/api/v1/admin/returns?status=NOPE').set('Authorization', `Bearer ${st}`)).status, 400);
    r = await request(app).get(`/api/v1/admin/returns/${returnId}`).set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(String(r.body.data._id), String(returnId));
    assert.equal((await request(app).get(`/api/v1/admin/returns/${returnId}`).set('Authorization', `Bearer ${at}`)).status, 403);
    assert.equal((await request(app).get(`/api/v1/admin/returns/${new mongoose.Types.ObjectId()}`).set('Authorization', `Bearer ${st}`)).status, 404);

    // Invalid transition first, then the documented workflow.
    r = await request(app)
      .patch(`/api/v1/admin/returns/${returnId}/status`)
      .set('Authorization', `Bearer ${st}`)
      .send({ status: 'COMPLETED', reason: 'Skipping steps' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'RETURN_TRANSITION_INVALID');
    const balanceBeforeReturn = (await InventoryBalance.findOne({ product: product._id }).lean())!.quantityOnHand;
    const stockBeforeReturn = (await Product.findById(product._id).lean())!.stock;
    for (const status of ['APPROVED', 'RECEIVED', 'COMPLETED']) {
      const response = await request(app)
        .patch(`/api/v1/admin/returns/${returnId}/status`)
        .set('Authorization', `Bearer ${st}`)
        .send({ status, reason: `Moving to ${status}` });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.status, status);
    }
    const completed = await ReturnRequest.findById(returnId).lean();
    assert.deepEqual(
      completed!.history.map((entry: any) => entry.to),
      ['REQUESTED', 'APPROVED', 'RECEIVED', 'COMPLETED']
    );
    assert.ok(completed!.reviewedAt);
    assert.equal(String(completed!.reviewedBy), String(admin._id));

    // ---- Return inventory policy: no automatic restock at any return stage. ----
    assert.equal(
      (await InventoryBalance.findOne({ product: product._id }).lean())!.quantityOnHand,
      balanceBeforeReturn,
      'returns must not silently restock sellable inventory'
    );
    assert.equal((await Product.findById(product._id).lean())!.stock, stockBeforeReturn);
    assert.equal(
      await InventoryMovement.countDocuments({ product: product._id, type: 'RETURN' }),
      0,
      'restocking returned goods requires an explicit inventory adjustment'
    );

    // ---- Audit trail for successful admin operations only. ----
    const auditCount = (action: string, resourceId?: string) => AuditLog.countDocuments({ action, ...(resourceId ? { resourceId } : {}) });
    assert.equal(await auditCount('ORDER_STATUS_UPDATED', String(orderA._id)), 4);
    assert.equal(await auditCount('ORDER_PAYMENT_UPDATED', String(orderA._id)), 1);
    assert.equal(await auditCount('RETURN_REQUESTED', String(returnId)), 1);
    assert.equal(await auditCount('RETURN_STATUS_UPDATED', String(returnId)), 3);
    const refund = await request(app)
      .post(`/api/v1/admin/orders/${orderA._id}/refunds`)
      .set('Authorization', `Bearer ${st}`)
      .set('Idempotency-Key', 'returns-refund-key')
      .send({ amount: 400, reason: 'Approved return refund', returnId });
    assert.equal(refund.status, 201);
    assert.equal(await auditCount('REFUND_CREATED', String(refund.body.data._id)), 1);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/refunds/${refund.body.data._id}/status`).set('Authorization', `Bearer ${st}`).send({ status: 'APPROVED' }))
        .status,
      200
    );
    assert.equal(await auditCount('REFUND_STATUS_UPDATED', String(refund.body.data._id)), 1);

    // Failed and unauthorized operations must not write business audit events.
    const auditsBefore = await AuditLog.countDocuments({});
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${orderA._id}/status`)
          .set('Authorization', `Bearer ${at}`)
          .send({ status: 'CANCELLED', reason: 'Not allowed' })
      ).status,
      403
    );
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${orderA._id}/status`)
          .set('Authorization', `Bearer ${st}`)
          .send({ status: 'PENDING', reason: 'Invalid transition' })
      ).status,
      400
    );
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/returns/${returnId}/status`)
          .set('Authorization', `Bearer ${st}`)
          .send({ status: 'APPROVED', reason: 'Already completed' })
      ).status,
      400
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/admin/orders/${orderA._id}/refunds`)
          .set('Authorization', `Bearer ${st}`)
          .set('Idempotency-Key', 'returns-refund-over-cap')
          .send({ amount: 99999, reason: 'Over the cap' })
      ).status,
      400
    );
    assert.equal((await request(app).post(`/api/v1/admin/orders/${orderA._id}/cancel`).set('Authorization', `Bearer ${st}`).send({})).status, 400);
    assert.equal(await AuditLog.countDocuments({}), auditsBefore, 'rejected operations must not create audit entries');

    // ---- Malformed identifiers stay safe on every order, return and refund route. ----
    const leaky = ['casterror', 'mongo', 'objectid', 'stack', 'e11000', 'jwt', 'secret', 'password', 'at Object.', 'node_modules'];
    const routes = (id: string) => [
      { method: 'get' as const, url: `/api/v1/orders/${id}`, token: at },
      { method: 'get' as const, url: `/api/v1/orders/${id}/tracking`, token: at },
      { method: 'get' as const, url: `/api/v1/orders/${id}/invoice`, token: at },
      { method: 'get' as const, url: `/api/v1/orders/${id}/invoice.pdf`, token: at },
      { method: 'get' as const, url: `/api/v1/returns/${id}`, token: at },
      { method: 'get' as const, url: `/api/v1/admin/orders/${id}`, token: st },
      { method: 'get' as const, url: `/api/v1/admin/orders/${id}/invoice`, token: st },
      { method: 'get' as const, url: `/api/v1/admin/returns/${id}`, token: st },
      { method: 'get' as const, url: `/api/v1/admin/refunds/${id}`, token: st },
    ];
    for (const malformed of MALFORMED)
      for (const route of routes(encodeURIComponent(malformed))) {
        const response = await request(app)[route.method](route.url).set('Authorization', `Bearer ${route.token}`);
        assert.ok([400, 404].includes(response.status), `${route.url} returned ${response.status} for ${malformed}`);
        const payload = JSON.stringify(response.body).toLowerCase();
        for (const term of leaky) assert.ok(!payload.includes(term), `${route.url} leaked ${term} for ${malformed}`);
      }
    for (const malformed of MALFORMED) {
      const patched = await request(app)
        .patch(`/api/v1/admin/returns/${encodeURIComponent(malformed)}/status`)
        .set('Authorization', `Bearer ${st}`)
        .send({ status: 'APPROVED', reason: 'Malformed target' });
      assert.equal(patched.status, 400);
      const posted = await request(app)
        .post(`/api/v1/admin/orders/${encodeURIComponent(malformed)}/refunds`)
        .set('Authorization', `Bearer ${st}`)
        .set('Idempotency-Key', 'malformed-refund-key')
        .send({ amount: 10, reason: 'Malformed target' });
      assert.equal(posted.status, 400);
      for (const payload of [JSON.stringify(patched.body).toLowerCase(), JSON.stringify(posted.body).toLowerCase()])
        for (const term of leaky) assert.ok(!payload.includes(term));
    }

    // ---- Mass assignment: every privileged field stays server-owned. ----
    const rejected = async (method: 'post' | 'patch', url: string, tokenValue: string, body: unknown, key?: string) => {
      let pending = request(app)[method](url).set('Authorization', `Bearer ${tokenValue}`);
      if (key) pending = pending.set('Idempotency-Key', key);
      const response = await pending.send(body as any);
      assert.equal(response.status, 400, `expected 400 for ${method.toUpperCase()} ${url} ${JSON.stringify(body)}`);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    };
    const orderC = await place(a, at, String(addressA._id), 'returns-order-c', 1);
    for (const body of [
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', customer: String(b._id) },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', subtotal: 1 },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', total: 1 },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', discount: 999 },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', shipping: 0 },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', orderStatus: 'DELIVERED' },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', paymentStatus: 'PAID' },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', statusHistory: [{ status: 'DELIVERED' }] },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', items: [{ productId: String(product._id), quantity: 99, unitPrice: 1 }] },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', createdAt: '2020-01-01T00:00:00.000Z' },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: 'header-bypass' },
      { addressId: String(addressA._id), paymentMethod: 'BANK_TRANSFER' },
      { addressId: String(addressA._id), paymentMethod: 'CASH_ON_DELIVERY', $set: { total: 1 } },
    ])
      await rejected('post', '/api/v1/checkout', at, body, `mass-assign-${Math.random()}`);
    for (const body of [
      { status: 'CONFIRMED', actor: String(a._id) },
      { status: 'CONFIRMED', statusHistory: [] },
      { status: 'CONFIRMED', updatedAt: '2020-01-01T00:00:00.000Z' },
    ])
      await rejected('patch', `/api/v1/admin/orders/${orderC._id}/status`, st, body);
    for (const body of [{ paymentStatus: 'PAID', total: 0 }, { paymentStatus: 'PAID', paymentMethod: 'CARD' }, { paymentStatus: 'REFUNDED_EVERYTHING' }])
      await rejected('patch', `/api/v1/admin/orders/${orderC._id}/payment-status`, st, body);
    // Each body below is otherwise valid, so a 400 can only come from the forged field itself.
    const why = 'Mass assignment attempt';
    for (const body of [
      { items: [{ productId: String(product._id), quantity: 1 }], reason: why, status: 'APPROVED' },
      { items: [{ productId: String(product._id), quantity: 1 }], reason: why, reviewedBy: String(admin._id) },
      { items: [{ productId: String(product._id), quantity: 1 }], reason: why, history: [] },
      { items: [{ productId: String(product._id), quantity: 1 }], reason: why, returnNumber: 'RET-FORGED' },
      { items: [{ productId: String(product._id), quantity: 1 }], reason: why, customer: String(b._id) },
      { items: [{ productId: String(product._id), quantity: 1, unitPrice: 1 }], reason: why },
    ])
      await rejected('post', `/api/v1/orders/${orderA._id}/returns`, at, body);
    await rejected('patch', `/api/v1/admin/returns/${returnId}/status`, st, { status: 'RECEIVED', reason: why, reviewedBy: String(a._id) });
    await rejected('patch', `/api/v1/admin/returns/${returnId}/status`, st, { status: 'RECEIVED', reason: why, resolution: 'forced' });
    for (const body of [
      { amount: 10, reason: why, status: 'COMPLETED' },
      { amount: 10, reason: why, refundNumber: 'RFD-FORGED' },
      { amount: 10, reason: why, processedBy: String(a._id) },
      { amount: 10, reason: why, currency: 'USD' },
      { amount: 10, reason: why, idempotencyKey: 'body-key' },
    ])
      await rejected('post', `/api/v1/admin/orders/${orderA._id}/refunds`, st, body, 'mass-assign-refund-key');
    await rejected('patch', `/api/v1/admin/refunds/${refund.body.data._id}/status`, st, { status: 'COMPLETED', amount: 1 });
    await rejected('post', `/api/v1/admin/orders/${orderC._id}/cancel`, st, { restoreInventory: false });
    await rejected('post', `/api/v1/orders/${orderC._id}/cancel`, at, { orderStatus: 'DELIVERED' });

    // Nothing above may have altered server-owned state.
    const finalOrder = await Order.findById(orderC._id).lean();
    assert.equal(finalOrder!.total, 1250);
    assert.equal(finalOrder!.subtotal, 1000);
    assert.equal(finalOrder!.shipping, 250);
    assert.equal(finalOrder!.discount, 0);
    assert.equal(finalOrder!.orderStatus, 'PENDING');
    assert.equal(finalOrder!.paymentStatus, 'UNPAID');
    assert.equal(finalOrder!.paymentMethod, 'CASH_ON_DELIVERY');
    assert.equal(finalOrder!.currency, 'PKR');
    assert.equal(String(finalOrder!.customer), String(a._id));
    assert.equal(finalOrder!.statusHistory.length, 1);
    assert.equal(finalOrder!.refundedTotal, 0);
    assert.equal(finalOrder!.invoiceNumber, `INV-${finalOrder!.orderNumber}`);
    assert.equal(await Refund.countDocuments({ order: orderA._id }), 1);
    assert.equal(await ReturnRequest.countDocuments({}), 1);
    assert.equal((await ReturnRequest.findById(returnId).lean())!.status, 'COMPLETED');

    // Customer refund/return visibility stays scoped.
    r = await request(app).get('/api/v1/refunds').set('Authorization', `Bearer ${bt}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, []);
    r = await request(app).get('/api/v1/refunds').set('Authorization', `Bearer ${at}`);
    assert.equal(r.body.data.length, 1);
    r = await request(app).get('/api/v1/returns').set('Authorization', `Bearer ${bt}`);
    assert.deepEqual(r.body.data, []);
    assert.equal((await request(app).get('/api/v1/admin/refunds').set('Authorization', `Bearer ${at}`)).status, 403);
    assert.equal((await request(app).get('/api/v1/admin/refunds')).status, 401);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
