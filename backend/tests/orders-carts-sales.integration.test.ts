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
import { Refund } from '../src/models/refund.js';
import { User } from '../src/models/user.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const HOUR = 3600000;

test('abandoned carts are derived safely from persisted carts and sales figures follow documented formulas', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Order.init(), Refund.init()]);
    const [stale, fresh, emptied, admin] = await User.create([
      { name: 'Stale Shopper', email: 'stale@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Fresh Shopper', email: 'fresh@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Converted Shopper', email: 'converted@d.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@d.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const token = (user: any, role: string) => jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!);
    const [staleToken, st] = [token(stale, 'CUSTOMER'), token(admin, 'SUPER_ADMIN')];
    const [cheap, pricey, archived] = await Product.create([
      { name: 'Cart mouse', sku: 'CART-CHEAP', description: 'x', price: 500, category: 'x', image: 'https://e/1', stock: 50, status: 'ACTIVE' },
      { name: 'Cart monitor', sku: 'CART-PRICEY', description: 'x', price: 2000, category: 'x', image: 'https://e/2', stock: 50, status: 'ACTIVE' },
      { name: 'Cart discontinued', sku: 'CART-GONE', description: 'x', price: 3000, category: 'x', image: 'https://e/3', stock: 50, status: 'ARCHIVED' },
    ]);

    // ---- Abandoned cart foundation. ----
    const staleCart = await Cart.create({
      user: stale._id,
      items: [
        { product: cheap._id, quantity: 2 },
        { product: pricey._id, quantity: 1 },
        { product: archived._id, quantity: 1 },
      ],
    });
    await Cart.create({ user: fresh._id, items: [{ product: cheap._id, quantity: 1 }] });
    await Cart.create({ user: emptied._id, items: [] });
    // Backdate through the driver so the timestamp plugin does not overwrite the fixture.
    const backdate = (id: unknown, hours: number) =>
      Cart.collection.updateOne({ _id: id as never }, { $set: { updatedAt: new Date(Date.now() - hours * HOUR) } });
    await backdate(staleCart._id, 30);
    await backdate((await Cart.findOne({ user: emptied._id }).lean())!._id, 40);

    assert.equal((await request(app).get('/api/v1/admin/abandoned-carts')).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/abandoned-carts').set('Authorization', `Bearer ${staleToken}`)).status, 403);
    let r = await request(app).get('/api/v1/admin/abandoned-carts').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.olderThanHours, 24, 'the documented default inactivity threshold is 24 hours');
    assert.equal(r.body.meta.valuation, 'CURRENT_CATALOG_PRICE');
    assert.equal(r.body.data.length, 1, 'only the stale non-empty cart qualifies');
    const abandoned = r.body.data[0];
    assert.equal(abandoned.cartId, String(staleCart._id));
    assert.equal(abandoned.customer.id, String(stale._id));
    assert.equal(abandoned.customer.name, 'Stale Shopper');
    assert.equal(abandoned.customer.email, 'stale@d.test');
    assert.deepEqual(Object.keys(abandoned.customer).sort(), ['email', 'id', 'name']);
    assert.equal(abandoned.itemCount, 4);
    assert.equal(abandoned.distinctItems, 3);
    // 2 x 500 + 1 x 2000, with the archived line excluded from sellable value.
    assert.equal(abandoned.estimatedValue, 3000);
    assert.equal(abandoned.currency, 'PKR');
    assert.ok(abandoned.ageHours >= 29 && abandoned.ageHours <= 31);
    assert.ok(abandoned.lastActivityAt && abandoned.createdAt && abandoned.updatedAt);
    assert.ok(!JSON.stringify(r.body).toLowerCase().includes('password'));

    // Value safety: the estimate follows current server-side catalog data, never a stored price.
    await Product.updateOne({ _id: cheap._id }, { $set: { price: 750 } });
    r = await request(app).get('/api/v1/admin/abandoned-carts').set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data[0].estimatedValue, 3500);
    await Product.updateOne({ _id: pricey._id }, { $set: { status: 'DRAFT' } });
    r = await request(app).get('/api/v1/admin/abandoned-carts').set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data[0].estimatedValue, 1500);
    await Product.updateOne({ _id: pricey._id }, { $set: { status: 'ACTIVE' } });
    await Product.updateOne({ _id: cheap._id }, { $set: { price: 500 } });

    // Threshold and pagination controls.
    r = await request(app).get('/api/v1/admin/abandoned-carts?olderThanHours=48').set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data.length, 0);
    r = await request(app).get('/api/v1/admin/abandoned-carts?olderThanHours=1').set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data.length, 1);
    r = await request(app).get('/api/v1/admin/abandoned-carts?page=1&limit=1&olderThanHours=1').set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.meta.limit, 1);
    assert.equal(r.body.meta.total, 1);
    for (const query of ['olderThanHours=0', 'olderThanHours[$gt]=1', 'limit=500', 'unknownFilter=1', 'page=0']) {
      const response = await request(app).get(`/api/v1/admin/abandoned-carts?${query}`).set('Authorization', `Bearer ${st}`);
      assert.equal(response.status, 400, `expected 400 for ${query}`);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
    // A converted cart drops out: checkout empties it, so it can no longer be abandoned.
    const address = await Address.create({
      user: stale._id,
      fullName: 'Stale Shopper',
      phone: '03001',
      addressLine1: 'House 1',
      city: 'Karachi',
      country: 'PK',
    });
    // Checkout only accepts ACTIVE products, so the archived line is removed before converting.
    await Cart.findOneAndUpdate({ user: stale._id }, { $set: { items: [{ product: cheap._id, quantity: 2 }] } });
    assert.equal(
      (
        await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${staleToken}`)
          .set('Idempotency-Key', 'abandoned-converts')
          .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' })
      ).status,
      201
    );
    r = await request(app).get('/api/v1/admin/abandoned-carts?olderThanHours=1').set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data.length, 0, 'a converted cart is no longer abandoned');

    // ---- Sales semantics on a deterministic dataset. ----
    await Promise.all([Order.deleteMany({}), Refund.deleteMany({})]);
    const buyer = await User.create({ name: 'Sales Buyer', email: 'sales@d.test', password: 'x', role: 'CUSTOMER' });
    const buyerToken = token(buyer, 'CUSTOMER');
    const buyerAddress = await Address.create({
      user: buyer._id,
      fullName: 'Sales Buyer',
      phone: '03009',
      addressLine1: 'House 9',
      city: 'Karachi',
      country: 'PK',
    });
    const place = async (key: string, quantity: number) => {
      await Cart.findOneAndUpdate({ user: buyer._id }, { $set: { items: [{ product: cheap._id, quantity }] } }, { upsert: true });
      const response = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${buyerToken}`)
        .set('Idempotency-Key', key)
        .send({ addressId: String(buyerAddress._id), paymentMethod: 'CASH_ON_DELIVERY' });
      assert.equal(response.status, 201);
      return response.body.data;
    };
    const advance = async (id: string, statuses: string[]) => {
      for (const status of statuses)
        assert.equal(
          (await request(app).patch(`/api/v1/admin/orders/${id}/status`).set('Authorization', `Bearer ${st}`).send({ status, reason: 'Sales fixture' })).status,
          200
        );
    };
    // Delivered and paid: the only realized revenue. 4 x 500 + 250 shipping = 2250.
    const realizedOrder = await place('sales-realized', 4);
    assert.equal(realizedOrder.total, 2250);
    await advance(String(realizedOrder._id), ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${realizedOrder._id}/payment-status`)
          .set('Authorization', `Bearer ${st}`)
          .send({ paymentStatus: 'PAID', reason: 'COD collected' })
      ).status,
      200
    );
    // Delivered but COD never collected: gross only, never realized.
    const unpaidOrder = await place('sales-unpaid-cod', 2);
    assert.equal(unpaidOrder.total, 1250);
    await advance(String(unpaidOrder._id), ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
    assert.equal((await Order.findById(unpaidOrder._id).lean())!.paymentStatus, 'UNPAID');
    // Cancelled: gross only, never realized.
    const cancelledOrder = await place('sales-cancelled', 1);
    assert.equal(cancelledOrder.total, 750);
    assert.equal((await request(app).post(`/api/v1/admin/orders/${cancelledOrder._id}/cancel`).set('Authorization', `Bearer ${st}`).send({})).status, 200);

    const gross = 2250 + 1250 + 750;
    // One counted refund and one FAILED refund that must be excluded.
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/admin/orders/${realizedOrder._id}/refunds`)
          .set('Authorization', `Bearer ${st}`)
          .set('Idempotency-Key', 'sales-refund-counted')
          .send({ amount: 300, reason: 'Partial goodwill refund' })
      ).status,
      201
    );
    const failedRefund = await request(app)
      .post(`/api/v1/admin/orders/${realizedOrder._id}/refunds`)
      .set('Authorization', `Bearer ${st}`)
      .set('Idempotency-Key', 'sales-refund-failed')
      .send({ amount: 100, reason: 'Refund that fails' });
    assert.equal(failedRefund.status, 201);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/refunds/${failedRefund.body.data._id}/status`).set('Authorization', `Bearer ${st}`).send({ status: 'FAILED' }))
        .status,
      200
    );

    assert.equal((await request(app).get('/api/v1/admin/sales/dashboard?range=30d')).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/sales/dashboard?range=30d').set('Authorization', `Bearer ${buyerToken}`)).status, 403);
    r = await request(app).get('/api/v1/admin/sales/dashboard?range=30d').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    const dashboard = r.body.data;
    assert.equal(dashboard.orders, 3);
    // GROSS SALES = sum of order.total for every order created in range, any status.
    assert.equal(dashboard.grossSales, gross);
    // REALIZED REVENUE = sum of order.total where orderStatus DELIVERED and paymentStatus PAID.
    assert.equal(dashboard.realizedRevenue, 2250);
    // REFUNDS = sum of refund.amount for refunds created in range whose status is not FAILED.
    assert.equal(dashboard.refunds, 300);
    // NET SALES = GROSS SALES - REFUNDS.
    assert.equal(dashboard.netSales, gross - 300);
    assert.equal(dashboard.averageOrderValue, gross / 3);
    assert.equal(dashboard.cancelledOrders, 1);
    assert.equal(dashboard.returnedOrders, 0);
    assert.equal(dashboard.topProducts.length, 1);
    assert.equal(dashboard.topProducts[0].quantity, 7);
    assert.equal(dashboard.recentOrders.length, 3);
    assert.ok(r.body.meta.from && r.body.meta.to);
    assert.ok(!JSON.stringify(dashboard).toLowerCase().includes('password'));

    // Explicit from/to windows and rejected range combinations.
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    r = await request(app)
      .get(`/api/v1/admin/sales/dashboard?from=${iso(-HOUR)}&to=${iso(HOUR)}`)
      .set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data.grossSales, gross);
    r = await request(app)
      .get(`/api/v1/admin/sales/dashboard?from=${iso(-72 * HOUR)}&to=${iso(-48 * HOUR)}`)
      .set('Authorization', `Bearer ${st}`);
    assert.equal(r.body.data.grossSales, 0);
    assert.equal(r.body.data.realizedRevenue, 0);
    assert.equal(r.body.data.netSales, 0);
    for (const query of ['range=45d', 'from=not-a-date', 'range=30d&unknown=1', 'range[$ne]=30d'])
      assert.equal(
        (await request(app).get(`/api/v1/admin/sales/dashboard?${query}`).set('Authorization', `Bearer ${st}`)).status,
        400,
        `expected 400 for ${query}`
      );

    // ---- Analytics uses the same aggregates. ----
    r = await request(app).get('/api/v1/admin/sales/analytics?range=30d').set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.salesByDate.length, 1);
    assert.equal(r.body.data.salesByDate[0].orders, 3);
    assert.equal(r.body.data.salesByDate[0].grossSales, gross);
    assert.equal(r.body.data.salesByDate[0].realizedRevenue, 2250);
    const breakdown = new Map<string, number>(r.body.data.statusBreakdown.map((entry: any) => [entry.status, entry.count]));
    assert.equal(breakdown.get('DELIVERED'), 2);
    assert.equal(breakdown.get('CANCELLED'), 1);
    assert.equal((await request(app).get('/api/v1/admin/sales/analytics?range=30d').set('Authorization', `Bearer ${buyerToken}`)).status, 403);
    assert.equal((await request(app).get('/api/v1/admin/sales/analytics?range=30d')).status, 401);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
