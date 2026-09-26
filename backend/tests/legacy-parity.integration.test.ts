import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { Brand } from '../src/models/brand.js';
import { Cart } from '../src/models/cart.js';
import { Category } from '../src/models/category.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';

/**
 * Behaviour carried forward from the removed legacy Express runtime.
 *
 * The legacy `backend/__tests__` suites covered `GET /api/products`, `GET /api/products/:id`,
 * `GET /api/products/category/:category`, `GET /api/search`, `POST /api/orders/track` and
 * `PUT /api/products/:id/rating`. Those routes are gone, so the properties they protected are
 * re-asserted here against the v1 endpoints that replaced them instead of being dropped.
 *
 * Two legacy behaviours are deliberately not reproduced, and the change is pinned instead: order
 * tracking is no longer answered for an anonymous caller, and a rating can no longer be written
 * without a session. Both were enumeration and vandalism surfaces.
 */
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('v1 replaces the removed legacy catalog, search, tracking and rating behaviour', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const customer = await User.create({ name: 'Shopper', email: 'shopper@parity.test', password: 'x', role: 'CUSTOMER' });
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    await Category.create({ name: 'Laptops', slug: 'laptops' });
    await Brand.create({ name: 'Acme', slug: 'acme' });
    const [listed] = await Product.create([
      {
        name: 'Acme Laptop Pro',
        slug: 'acme-laptop-pro',
        sku: 'PARITY-1',
        description: 'A portable workstation.',
        price: 250000,
        costPrice: 180000,
        category: 'Laptops',
        brand: 'Acme',
        image: 'https://example.test/laptop',
        stock: 5,
        status: 'ACTIVE',
      },
      {
        name: 'Retired Laptop',
        slug: 'retired-laptop',
        sku: 'PARITY-2',
        description: 'Withdrawn from sale.',
        price: 99000,
        category: 'Laptops',
        image: 'https://example.test/retired',
        stock: 0,
        status: 'ARCHIVED',
      },
    ]);

    // The legacy list returned the whole collection with no envelope and no bounds. The v1 list
    // publishes only what is sellable and always carries pagination meta.
    let r = await request(app).get('/api/v1/products');
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.deepEqual(
      r.body.data.map((product: any) => product.slug),
      ['acme-laptop-pro']
    );
    assert.deepEqual(r.body.meta, { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false });

    // A caller cannot page past the published bound, reorder by an unsupported key, or add a
    // parameter the contract does not name.
    for (const query of ['limit=999', 'limit=0', 'page=0', 'sort=cheapest', 'unexpected=1', `search=${'x'.repeat(81)}`, 'minPrice=500&maxPrice=100']) {
      r = await request(app).get(`/api/v1/products?${query}`);
      assert.equal(r.status, 400, query);
      assert.equal(r.body.success, false, query);
      assert.ok(['VALIDATION_ERROR', 'PRICE_RANGE_INVALID'].includes(r.body.error.code), query);
    }

    // The legacy search route interpolated the raw query straight into a MongoDB regex, so `.*`
    // matched the entire catalogue. v1 escapes the term, which makes metacharacters literal.
    r = await request(app).get('/api/v1/products?search=.*');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, []);
    assert.equal(r.body.meta.total, 0);

    // Substring matching stays case-insensitive and still reaches the description, as it did before.
    r = await request(app).get('/api/v1/products?search=LAPTOP%20pro');
    assert.equal(r.body.meta.total, 1);
    r = await request(app).get('/api/v1/products?search=workstation');
    assert.equal(r.body.meta.total, 1);

    // A withdrawn product stays out of results even when the term matches it.
    r = await request(app).get('/api/v1/products?search=Withdrawn');
    assert.deepEqual(r.body.data, []);

    // `GET /api/products/category/:category` is now a filter on the same list endpoint.
    r = await request(app).get('/api/v1/products?category=Laptops');
    assert.equal(r.body.meta.total, 1);
    r = await request(app).get('/api/v1/products?category=Cameras');
    assert.equal(r.body.meta.total, 0);

    // Detail reads: the legacy handler returned the raw Mongoose document, buying price included.
    // v1 serialises an allowlist, so neither cost nor raw stock reaches the storefront.
    for (const identifier of [String(listed._id), 'acme-laptop-pro']) {
      r = await request(app).get(`/api/v1/products/${identifier}`);
      assert.equal(r.status, 200, identifier);
      assert.equal(r.body.data.slug, 'acme-laptop-pro');
      assert.equal(r.body.data.costPrice, undefined, identifier);
      assert.equal(r.body.data.stock, undefined, identifier);
      assert.equal(r.body.data.availableStock, 5, identifier);
    }
    for (const identifier of [new mongoose.Types.ObjectId().toHexString(), 'retired-laptop', 'not-a-real-slug']) {
      r = await request(app).get(`/api/v1/products/${identifier}`);
      assert.equal(r.status, 404, identifier);
      assert.equal(r.body.error.code, 'PRODUCT_NOT_FOUND', identifier);
    }

    // Category and brand lookups answer with their own codes rather than one generic not-found body.
    assert.equal((await request(app).get('/api/v1/categories/laptops')).status, 200);
    assert.equal((await request(app).get('/api/v1/categories/missing')).body.error.code, 'CATEGORY_NOT_FOUND');
    assert.equal((await request(app).get('/api/v1/brands/acme')).status, 200);
    assert.equal((await request(app).get('/api/v1/brands/missing')).body.error.code, 'BRAND_NOT_FOUND');

    // Order tracking. `POST /api/orders/track` answered an anonymous caller who supplied an order
    // number and an email, which made orders enumerable. The v1 read is owner-scoped.
    const address = await Address.create({ user: customer._id, fullName: 'Shopper', phone: '1', addressLine1: 'x', city: 'Karachi', country: 'PK' });
    await Cart.create({ user: customer._id, items: [{ product: listed._id, quantity: 1 }] });
    r = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'legacy-parity-order')
      .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201);
    const orderId = r.body.data._id;
    assert.equal((await request(app).get(`/api/v1/orders/${orderId}/tracking`)).status, 401);

    // Reading the trail must not advance it. The legacy handler recomputed and saved a status while
    // answering; v1 only projects what is already stored, so repeated reads leave the order alone.
    const before = await Order.findById(orderId).lean();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      r = await request(app).get(`/api/v1/orders/${orderId}/tracking`).set('Authorization', `Bearer ${customerToken}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.currentStatus, 'PENDING');
    }
    const after = await Order.findById(orderId).lean();
    assert.equal(after.orderStatus, before.orderStatus);
    assert.equal(after.statusHistory.length, before.statusHistory.length);
    assert.equal(String(after.updatedAt), String(before.updatedAt));

    // The published trail carries no internal attribution: `actor` and `requestId` stay server-side.
    for (const entry of r.body.data.timeline) assert.deepEqual(Object.keys(entry).sort(), ['at', 'from', 'reason', 'status', 'to']);

    // `PUT /api/products/:id/rating` accepted a rating from anyone. Its replacement is a review that
    // requires a session, so the rating aggregate can no longer be moved by an anonymous caller.
    const review = { rating: 5, title: 'Solid', body: 'Handles everything I asked of it.' };
    assert.equal((await request(app).post(`/api/v1/products/${listed._id}/reviews`).send(review)).status, 401);
    r = await request(app).post(`/api/v1/products/${listed._id}/reviews`).set('Authorization', `Bearer ${customerToken}`).send(review);
    assert.equal(r.status, 201);
    assert.equal(r.body.data.verifiedPurchase, false);
    r = await request(app).get(`/api/v1/products/${listed._id}`);
    assert.equal(r.body.data.ratingAverage, 5);
    assert.equal(r.body.data.ratingCount, 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
