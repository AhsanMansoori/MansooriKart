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
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { Refund } from '../src/models/refund.js';
import { ReturnRequest } from '../src/models/return.js';
import { Review } from '../src/models/review.js';
import { User } from '../src/models/user.js';
import { Wishlist } from '../src/models/wishlist.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

const SECRET_FIELDS = ['password', 'passwordHash', 'resetPasswordToken', 'resetPasswordTokenHash', 'resetPasswordExpires', '__v'];

/** Recursively asserts that no credential-bearing key appears anywhere in a payload. */
const assertNoSecrets = (value: unknown, path = 'body') => {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoSecrets(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!SECRET_FIELDS.includes(key), `${path}.${key} must never be serialised`);
      assertNoSecrets(nested, `${path}.${key}`);
    }
  }
};

const address = {
  fullName: 'Buyer',
  phone: '03001234567',
  addressLine1: 'Street 1',
  city: 'Karachi',
  stateProvince: 'Sindh',
  postalCode: '75000',
  country: 'PK',
};

test('customers ERP reports real order history and cannot escalate privileges or leak secrets', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([User.init(), Order.init(), Product.init()]);
    const [admin, otherAdmin, vip, casual, prospect, suspended] = await User.create([
      { name: 'Admin', email: 'cust-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Second Admin', email: 'cust-admin2@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Vip Buyer', email: 'vip@test.local', password: 'Secret123!', phone: '03001110000' },
      { name: 'Casual Buyer', email: 'casual@test.local', password: 'Secret123!' },
      { name: 'Never Bought', email: 'prospect@test.local', password: 'Secret123!' },
      { name: 'Blocked', email: 'blocked@test.local', password: 'Secret123!', status: 'SUSPENDED' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(casual._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };

    const product = await Product.create({
      name: 'Customer ERP widget',
      slug: 'customer-erp-widget',
      sku: 'CUST-001',
      description: 'x',
      category: 'x',
      image: 'https://e.test/x',
      price: 60_000,
      stock: 100,
      status: 'ACTIVE',
    });
    const line = (quantity: number, unitPrice: number) => [
      { productId: product._id, name: product.name, sku: product.sku, unitPrice, quantity, lineSubtotal: unitPrice * quantity },
    ];
    // Two realized (DELIVERED + PAID) orders plus one cancelled order: the
    // cancelled order must count towards totalOrders but never towards spend.
    const [vipDelivered, , , casualOrder] = await Order.create([
      {
        customer: vip._id,
        orderNumber: 'MK-T-1',
        idempotencyKey: 'k1',
        items: line(1, 60_000),
        shippingAddress: address,
        subtotal: 60_000,
        total: 60_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: vip._id,
        orderNumber: 'MK-T-2',
        idempotencyKey: 'k2',
        items: line(1, 60_000),
        shippingAddress: address,
        subtotal: 60_000,
        total: 60_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: vip._id,
        orderNumber: 'MK-T-3',
        idempotencyKey: 'k3',
        items: line(1, 90_000),
        shippingAddress: address,
        subtotal: 90_000,
        total: 90_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'CANCELLED',
      },
      {
        customer: casual._id,
        orderNumber: 'MK-T-4',
        idempotencyKey: 'k4',
        items: line(1, 5_000),
        shippingAddress: address,
        subtotal: 5_000,
        total: 5_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PAID',
        orderStatus: 'DELIVERED',
      },
    ]);

    // Real activity across the existing domain collections: the 360° view is a
    // read model over these, never a copy of them.
    await Address.create([
      { user: vip._id, ...address, label: 'Home', isDefault: true },
      { user: vip._id, ...address, label: 'Office', addressLine1: 'Street 2', isDefault: false },
    ]);
    await Cart.create({ user: vip._id, items: [{ product: product._id, quantity: 3 }] });
    await Wishlist.create({ user: vip._id, products: [product._id] });
    await Review.create({ product: product._id, customer: vip._id, rating: 5, title: 'Great', body: 'Works well', verifiedPurchase: true });
    await ReturnRequest.create({
      returnNumber: 'RET-T-1',
      order: vipDelivered._id,
      customer: vip._id,
      items: [{ productId: product._id, quantity: 1 }],
      reason: 'Damaged in transit',
    });
    await Refund.create([
      {
        refundNumber: 'RFD-T-1',
        order: vipDelivered._id,
        amount: 60_000,
        currency: 'PKR',
        reason: 'Return accepted',
        paymentMethod: 'CASH_ON_DELIVERY',
        processedBy: admin._id,
        idempotencyKey: 'r1',
      },
      // Another customer's refund: it must never be attributed to the VIP account.
      {
        refundNumber: 'RFD-T-2',
        order: casualOrder._id,
        amount: 5_000,
        currency: 'PKR',
        reason: 'Goodwill',
        paymentMethod: 'CASH_ON_DELIVERY',
        processedBy: admin._id,
        idempotencyKey: 'r2',
      },
    ]);

    /* ---------------------------------------------------------------- RBAC */
    for (const path of ['/customers', '/customers/analytics', `/customers/${vip._id}`, `/customers/${vip._id}/orders`]) {
      assert.equal((await request(app).get(`/api/v1/admin${path}`)).status, 401, `${path} must reject anonymous access`);
      assert.equal(
        (await request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${customerToken}`)).status,
        403,
        `${path} must reject a customer token`
      );
    }
    assert.equal((await request(app).patch(`/api/v1/admin/customers/${vip._id}/status`).send({ status: 'SUSPENDED' })).status, 401);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/customers/${vip._id}/status`).set('Authorization', `Bearer ${customerToken}`).send({ status: 'SUSPENDED' }))
        .status,
      403
    );

    /* ---------------------------------------------------------------- List */
    let response = await request(app).get('/api/v1/admin/customers?limit=100').set(auth);
    assert.equal(response.status, 200);
    assertNoSecrets(response.body);
    const rows = response.body.data as any[];
    // SUPER_ADMIN accounts are not customers and must not appear by default.
    assert.ok(!rows.some(row => row.role === 'SUPER_ADMIN'));
    assert.equal(rows.length, 4);
    const vipRow = rows.find(row => row.email === 'vip@test.local');
    assert.ok(vipRow);
    assert.equal(vipRow.totalOrders, 3);
    assert.equal(vipRow.realizedSpend, 120_000);
    assert.equal(vipRow.grossSpend, 210_000);
    assert.equal(vipRow.cancelledOrders, 1);
    assert.equal(vipRow.segment, 'VIP');
    assert.equal(rows.find(row => row.email === 'prospect@test.local').segment, 'PROSPECT');
    assert.equal(rows.find(row => row.email === 'prospect@test.local').totalOrders, 0);

    // Filters run against real data, not client-supplied aggregates.
    response = await request(app).get('/api/v1/admin/customers?hasOrders=false').set(auth);
    assert.equal(response.status, 200);
    assert.ok(response.body.data.every((row: any) => row.totalOrders === 0));
    response = await request(app).get('/api/v1/admin/customers?status=SUSPENDED').set(auth);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].email, 'blocked@test.local');
    response = await request(app).get('/api/v1/admin/customers?search=vip%40test.local').set(auth);
    assert.equal(response.body.data.length, 1);
    // A regex-flavoured search value can only ever match literally.
    response = await request(app).get('/api/v1/admin/customers?search=.%2A').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 0);
    response = await request(app).get('/api/v1/admin/customers?sort=realizedSpend&direction=desc&limit=100').set(auth);
    assert.equal(response.body.data[0].email, 'vip@test.local');
    // Unknown query parameters are rejected by the strict allowlist.
    assert.equal((await request(app).get('/api/v1/admin/customers?role=SUPER_ADMIN&injected=1').set(auth)).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/customers?limit=5000').set(auth)).status, 400);

    /* ----------------------------------------------------------- Analytics */
    response = await request(app).get('/api/v1/admin/customers/analytics').set(auth);
    assert.equal(response.status, 200);
    assertNoSecrets(response.body);
    const analytics = response.body.data;
    assert.equal(analytics.totals.customers, 4);
    assert.equal(analytics.totals.active, 3);
    assert.equal(analytics.totals.suspended, 1);
    assert.equal(analytics.totals.purchasing, 2);
    assert.equal(analytics.totals.repeatPurchasers, 1);
    assert.equal(analytics.totals.averageLifetimeValue, 62_500);
    assert.equal(analytics.segments.PROSPECT, 2);
    assert.equal(analytics.segments.VIP, 1);
    assert.equal(analytics.topCustomers[0].email, 'vip@test.local');

    /* -------------------------------------------------------------- Detail */
    response = await request(app).get(`/api/v1/admin/customers/${vip._id}`).set(auth);
    assert.equal(response.status, 200);
    assertNoSecrets(response.body);
    const detail = response.body.data;
    assert.equal(detail.email, 'vip@test.local');
    assert.equal(detail.phone, '03001110000');
    assert.equal(detail.totalOrders, 3);
    assert.equal(detail.realizedSpend, 120_000);
    assert.equal(detail.recentOrders.length, 3);
    assert.deepEqual(Object.keys(detail).includes('password'), false);
    // Addresses are read straight from the existing Address collection.
    assert.equal(detail.addresses.length, 2);
    assert.equal(detail.addresses[0].label, 'Home');
    assert.equal(detail.addresses[0].isDefault, true);
    assert.equal(detail.addresses[0].line1, 'Street 1');
    assert.equal(detail.addresses[0].city, 'Karachi');
    // Activity: cart and wishlist are summarised, not dumped; reviews, returns
    // and refunds come from their own collections.
    assert.equal(detail.cart.itemCount, 3);
    assert.equal(detail.cart.distinctItems, 1);
    assert.equal(detail.wishlist.itemCount, 1);
    assert.equal(detail.reviews.length, 1);
    assert.equal(detail.reviews[0].rating, 5);
    assert.equal(detail.returns.length, 1);
    assert.equal(detail.returns[0].returnNumber, 'RET-T-1');
    // Refunds are resolved through the customer's own orders, so another
    // account's refund can never appear here.
    assert.equal(detail.refunds.length, 1);
    assert.equal(detail.refunds[0].refundNumber, 'RFD-T-1');
    assert.equal(detail.refunds[0].amount, 60_000);
    // A customer with no activity gets empty collections, not missing keys.
    const quiet = (await request(app).get(`/api/v1/admin/customers/${prospect._id}`).set(auth)).body.data;
    assert.deepEqual(quiet.addresses, []);
    assert.deepEqual(quiet.recentOrders, []);
    assert.equal(quiet.cart, null);
    assert.equal(quiet.wishlist, null);
    assert.deepEqual(quiet.refunds, []);
    assert.equal((await request(app).get(`/api/v1/admin/customers/${new mongoose.Types.ObjectId()}`).set(auth)).status, 404);
    // An unparseable id is a clean validation failure, never a driver CastError.
    response = await request(app).get('/api/v1/admin/customers/not-an-id').set(auth);
    assert.equal(response.status, 400);
    assert.ok(!JSON.stringify(response.body).includes('CastError'));

    response = await request(app).get(`/api/v1/admin/customers/${vip._id}/orders?limit=2`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 2);
    assert.equal(response.body.meta.total, 3);

    /* -------------------------------------------------- Status transitions */
    // `role` is not part of the schema, so a privilege-escalation payload is rejected outright.
    response = await request(app).patch(`/api/v1/admin/customers/${casual._id}/status`).set(auth).send({ status: 'SUSPENDED', role: 'SUPER_ADMIN' });
    assert.equal(response.status, 400);
    assert.equal((await User.findById(casual._id).lean()).role, 'CUSTOMER');

    response = await request(app).patch(`/api/v1/admin/customers/${casual._id}/status`).set(auth).send({ status: 'SUSPENDED', reason: 'Chargeback abuse' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'SUSPENDED');
    assertNoSecrets(response.body);
    assert.equal((await User.findById(casual._id).lean()).status, 'SUSPENDED');
    assert.equal(await AuditLog.countDocuments({ action: 'CUSTOMER_SUSPENDED', resourceId: String(casual._id) }), 1);

    // Idempotent re-suspension is a conflict, and it writes no second audit row.
    assert.equal((await request(app).patch(`/api/v1/admin/customers/${casual._id}/status`).set(auth).send({ status: 'SUSPENDED' })).status, 409);
    assert.equal(await AuditLog.countDocuments({ action: 'CUSTOMER_SUSPENDED', resourceId: String(casual._id) }), 1);

    // A suspended customer's own token is refused by requireAuth.
    assert.equal((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${customerToken}`)).status, 401);

    response = await request(app).patch(`/api/v1/admin/customers/${casual._id}/status`).set(auth).send({ status: 'ACTIVE' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ACTIVE');
    assert.equal(await AuditLog.countDocuments({ action: 'CUSTOMER_REACTIVATED', resourceId: String(casual._id) }), 1);

    // Neither another Super Admin nor the caller's own account may be suspended here.
    response = await request(app).patch(`/api/v1/admin/customers/${otherAdmin._id}/status`).set(auth).send({ status: 'SUSPENDED' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'CUSTOMER_STATUS_FORBIDDEN');
    assert.equal((await User.findById(otherAdmin._id).lean()).status, 'ACTIVE');
    response = await request(app).patch(`/api/v1/admin/customers/${admin._id}/status`).set(auth).send({ status: 'SUSPENDED' });
    assert.equal(response.status, 409);
    assert.equal((await User.findById(admin._id).lean()).status, 'ACTIVE');

    // There is no admin route that writes User.role at all.
    for (const body of [{ role: 'SUPER_ADMIN' }, { status: 'ACTIVE', role: 'SUPER_ADMIN' }]) {
      const attempt = await request(app).patch(`/api/v1/admin/customers/${prospect._id}`).set(auth).send(body);
      assert.ok([404, 400, 405].includes(attempt.status), `no generic customer mutation route may exist (got ${attempt.status})`);
      assert.equal((await User.findById(prospect._id).lean()).role, 'CUSTOMER');
    }
    // Public registration always creates a CUSTOMER even when a role is submitted.
    response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Escalator', email: 'escalate@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' });
    assert.ok([201, 400].includes(response.status));
    const registered = await User.findOne({ email: 'escalate@test.local' }).lean();
    if (registered) assert.equal(registered.role, 'CUSTOMER');
    assert.equal(await User.countDocuments({ role: 'SUPER_ADMIN' }), 2);
    assert.equal(suspended.status, 'SUSPENDED');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
