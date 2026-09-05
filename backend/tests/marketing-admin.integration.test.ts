import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Banner } from '../src/models/banner.js';
import { Category } from '../src/models/category.js';
import { Coupon } from '../src/models/coupon.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { Promotion } from '../src/models/promotion.js';
import { User } from '../src/models/user.js';

/**
 * Super Admin marketing surface: coupons, promotions, banners, homepage merchandising.
 *
 * The load-bearing assertions here are the ones that prove marketing stayed *marketing*:
 * a promotion carries no discount field, editing a coupon leaves the order that already
 * used it priced exactly as it was, and every link and image is scheme-checked before it
 * is stored (§5–13, §64, §67–68).
 */
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('marketing admin manages coupons, promotions, banners and homepage without becoming a second pricing authority', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Coupon.init(), Promotion.init(), Banner.init(), Product.init(), Category.init()]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'admin@marketing.test', password: 'x', role: 'SUPER_ADMIN' },
      { name: 'Buyer', email: 'buyer@marketing.test', password: 'x', role: 'CUSTOMER' },
    ]);
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const [category, product, address] = await Promise.all([
      Category.create({ name: 'Phones', slug: 'phones', status: 'ACTIVE' }),
      Product.create({
        name: 'Marketing product',
        description: 'x',
        price: 1000,
        category: 'Phones',
        image: 'https://e.test/p',
        stock: 20,
        status: 'ACTIVE',
        sku: 'MKT-1',
        featured: true,
      }),
      Address.create({ user: customer._id, fullName: 'Buyer', phone: '1', addressLine1: 'Street', city: 'Karachi', country: 'PK' }),
    ]);

    /* ------------------------------------------------------ §57 authorization on every surface */
    for (const path of ['/api/v1/admin/coupons', '/api/v1/admin/promotions', '/api/v1/admin/banners', '/api/v1/admin/homepage']) {
      assert.equal((await request(app).get(path)).status, 401);
      assert.equal((await request(app).get(path).set(auth(ct))).status, 403);
      assert.equal((await request(app).get(path).set(auth(st))).status, 200);
    }

    /* -------------------------------------------------------------- §6 coupon code normalisation */
    let r = await request(app).post('/api/v1/admin/coupons').set(auth(st)).send({ code: ' save10 ', type: 'PERCENTAGE', value: 10 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.code, 'SAVE10');
    assert.equal(r.body.data.state, 'ACTIVE');
    const couponId = r.body.data._id;
    // An ambiguous duplicate is the same coupon in a different case, and it is refused.
    r = await request(app).post('/api/v1/admin/coupons').set(auth(st)).send({ code: 'Save10', type: 'FIXED', value: 50 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'COUPON_CODE_EXISTS');

    /* --------------------------------------------------------------- §6 coupon value validation */
    for (const body of [
      { code: 'BAD1', type: 'PERCENTAGE', value: -5 },
      { code: 'BAD2', type: 'PERCENTAGE', value: 150 },
      { code: 'BAD3', type: 'FIXED', value: 0 },
      { code: 'BAD4', type: 'FIXED', value: 10, minimumOrderAmount: -1 },
      { code: 'BAD5', type: 'FIXED', value: 10, usageLimit: 0 },
      { code: 'BAD6', type: 'FIXED', value: 10, perCustomerLimit: -2 },
      { code: 'BAD7', type: 'FIXED', value: 10, startsAt: '2026-05-01T00:00:00.000Z', expiresAt: '2026-04-01T00:00:00.000Z' },
      { code: 'B', type: 'FIXED', value: 10 },
      { code: 'X'.repeat(65), type: 'FIXED', value: 10 },
      { code: 'BAD 8!', type: 'FIXED', value: 10 },
      { code: 'BAD9', type: 'GIFT', value: 10 },
      { code: 'BADA', type: 'FIXED' },
    ]) {
      assert.equal((await request(app).post('/api/v1/admin/coupons').set(auth(st)).send(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(await Coupon.countDocuments(), 1);

    /* ------------------------------------------- §53 mass assignment of internals is impossible */
    for (const body of [
      { code: 'MASS1', type: 'FIXED', value: 10, _id: '507f1f77bcf86cd799439011' },
      { code: 'MASS2', type: 'FIXED', value: 10, usageCount: 99 },
      { code: 'MASS3', type: 'FIXED', value: 10, createdBy: String(admin._id) },
      { code: 'MASS4', type: 'FIXED', value: 10, createdAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      assert.equal((await request(app).post('/api/v1/admin/coupons').set(auth(st)).send(body)).status, 400);
    }

    /* ------------------------------------------------ §5 filters, sorting and bounded pagination */
    await Coupon.create([
      { code: 'OFFCODE', type: 'FIXED', value: 100, enabled: false },
      { code: 'FUTURE', type: 'FIXED', value: 100, startsAt: new Date(Date.now() + 86_400_000) },
      { code: 'GONE', type: 'FIXED', value: 100, expiresAt: new Date(Date.now() - 86_400_000) },
      { code: 'USEDUP', type: 'FIXED', value: 100, usageLimit: 2, usageCount: 2 },
    ]);
    const states: Record<string, string[]> = {
      DISABLED: ['OFFCODE'],
      SCHEDULED: ['FUTURE'],
      EXPIRED: ['GONE'],
      EXHAUSTED: ['USEDUP'],
      ACTIVE: ['SAVE10', 'USEDUP'],
    };
    for (const [state, expected] of Object.entries(states)) {
      r = await request(app).get(`/api/v1/admin/coupons?state=${state}`).set(auth(st));
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.map((c: any) => c.code).sort(), [...expected].sort(), state);
    }
    r = await request(app).get('/api/v1/admin/coupons?code=save&sort=code&limit=1&page=1').set(auth(st));
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].code, 'SAVE10');
    assert.equal(r.body.meta.total, 1);
    assert.equal((await request(app).get('/api/v1/admin/coupons?limit=101').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/coupons?state=UNKNOWN').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/coupons?sort=value;drop').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/coupons?from=2026-05-01&to=2026-04-01').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/coupons?rogue=1').set(auth(st))).status, 400);
    // A code search cannot smuggle a regular expression through the filter.
    r = await request(app).get('/api/v1/admin/coupons?search=.*').set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 0);

    /* ------------------------------------------------------- §55 malformed identifiers are 404s */
    for (const path of [
      '/api/v1/admin/coupons/not-an-id',
      '/api/v1/admin/coupons/not-an-id/usage',
      '/api/v1/admin/promotions/%20',
      '/api/v1/admin/banners/12345',
    ]) {
      r = await request(app).get(path).set(auth(st));
      assert.equal(r.status, 404, path);
      assert.equal(r.body.success, false);
      assert.equal(r.body.error.stack, undefined);
    }

    /* ------------------ §6 editing a coupon never rewrites an order's historical coupon snapshot */
    assert.equal(
      (
        await request(app)
          .post('/api/v1/cart/items')
          .set(auth(ct))
          .send({ productId: String(product._id), quantity: 1 })
      ).status,
      201
    );
    r = await request(app)
      .post('/api/v1/checkout')
      .set(auth(ct))
      .set('Idempotency-Key', 'marketing-1')
      .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'save10' });
    assert.equal(r.status, 201);
    const orderId = r.body.data._id;
    // 1000 − 10% = 900 discounted subtotal, plus the default PKR 250 delivery fee.
    assert.equal(r.body.data.discount, 100);
    assert.equal(r.body.data.total, 1150);
    const before = await Order.findById(orderId).lean();
    assert.equal((before as any).coupon.code, 'SAVE10');
    assert.equal((before as any).coupon.value, 10);
    assert.equal((before as any).coupon.actualDiscount, 100);

    r = await request(app).get(`/api/v1/admin/coupons/${couponId}/usage`).set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.usageCount, 1);
    assert.equal(r.body.data.redemptions, 1);
    assert.equal(r.body.data.distinctCustomers, 1);
    assert.equal(r.body.data.orders, 1);
    assert.equal(r.body.data.totalDiscountGiven, 100);
    assert.equal(r.body.data.orderRevenue, 1150);
    assert.equal(r.body.data.remainingUses, null);
    assert.ok(r.body.data.lastUsedAt);

    r = await request(app).patch(`/api/v1/admin/coupons/${couponId}`).set(auth(st)).send({ value: 50, enabled: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.value, 50);
    assert.equal(r.body.data.state, 'DISABLED');
    const after = await Order.findById(orderId).lean();
    assert.equal((after as any).coupon.code, 'SAVE10');
    assert.equal((after as any).coupon.value, 10);
    assert.equal((after as any).coupon.actualDiscount, 100);
    assert.equal((after as any).discount, 100);
    assert.equal((after as any).total, 1150);
    // The archive is a soft one for exactly this reason: redemptions still reference it.
    r = await request(app).delete(`/api/v1/admin/coupons/${couponId}`).set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.archived, true);
    assert.ok(await Coupon.findById(couponId));

    /* ------------------------------------------------------- §59 a no-op patch writes no audit */
    const auditsBefore = await AuditLog.countDocuments({ resourceType: 'Coupon' });
    r = await request(app).patch(`/api/v1/admin/coupons/${couponId}`).set(auth(st)).send({ value: 50 });
    assert.equal(r.status, 200);
    assert.equal(await AuditLog.countDocuments({ resourceType: 'Coupon' }), auditsBefore);
    r = await request(app).post(`/api/v1/admin/coupons/${couponId}/disable`).set(auth(st)).send({});
    assert.equal(r.status, 200);
    assert.equal(await AuditLog.countDocuments({ resourceType: 'Coupon' }), auditsBefore);
    r = await request(app).post(`/api/v1/admin/coupons/${couponId}/activate`).set(auth(st)).send({});
    assert.equal(r.status, 200);
    assert.equal(r.body.data.enabled, true);
    assert.equal(await AuditLog.countDocuments({ action: 'COUPON_ENABLED' }), 1);
    r = await request(app).patch(`/api/v1/admin/coupons/${couponId}`).set(auth(st)).send({ minimumOrderAmount: 500, expiresAt: '2030-01-01T00:00:00.000Z' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.minimumOrderAmount, 500);
    assert.equal(await AuditLog.countDocuments({ action: 'COUPON_UPDATED' }), 1);

    /* -------------------------------- §7 a promotion is merchandising, not a discount authority */
    for (const body of [
      { name: 'Bad', discountType: 'PERCENTAGE' },
      { name: 'Bad', value: 10 },
      { name: 'Bad', discount: 10 },
      { name: 'Bad', maximumDiscount: 10 },
    ]) {
      assert.equal((await request(app).post('/api/v1/admin/promotions').set(auth(st)).send(body)).status, 400, JSON.stringify(body));
    }
    r = await request(app)
      .post('/api/v1/admin/promotions')
      .set(auth(st))
      .send({
        name: 'Eid Sale',
        headline: 'Up to 40% off',
        couponCode: ' save10 ',
        linkType: 'CATEGORY',
        linkCategory: String(category._id),
        status: 'ACTIVE',
        priority: 10,
      });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.slug, 'eid-sale');
    assert.equal(r.body.data.couponCode, 'SAVE10');
    assert.equal(r.body.data.effectiveStatus, 'ACTIVE');
    const promotionId = r.body.data.id;
    assert.equal((await request(app).post('/api/v1/admin/promotions').set(auth(st)).send({ name: 'Eid  Sale' })).status, 409);
    // A link must actually resolve: a missing target and an unknown reference are both refused.
    assert.equal((await request(app).post('/api/v1/admin/promotions').set(auth(st)).send({ name: 'No target', linkType: 'PRODUCT' })).status, 400);
    r = await request(app).post('/api/v1/admin/promotions').set(auth(st)).send({ name: 'Ghost', linkType: 'PRODUCT', linkProduct: '507f1f77bcf86cd799439011' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'REFERENCE_NOT_FOUND');
    assert.equal((await request(app).patch(`/api/v1/admin/promotions/${promotionId}`).set(auth(st)).send({ linkType: 'PRODUCT' })).status, 400);

    /* -------------------------------------- §8 visibility is derived from status plus the window */
    const windows: [string, Record<string, unknown>, string][] = [
      ['draft', { status: 'DRAFT' }, 'DRAFT'],
      ['future', { status: 'SCHEDULED', startAt: new Date(Date.now() + 86_400_000) }, 'SCHEDULED'],
      ['live', { status: 'ACTIVE', startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) }, 'ACTIVE'],
      ['past', { status: 'ACTIVE', startAt: new Date(Date.now() - 172_800_000), endAt: new Date(Date.now() - 86_400_000) }, 'EXPIRED'],
      ['shelved', { status: 'ARCHIVED' }, 'ARCHIVED'],
    ];
    for (const [slug, patch, expected] of windows) {
      const created = await Promotion.create({ name: slug, slug, ...patch });
      r = await request(app)
        .get(`/api/v1/admin/promotions/${String(created._id)}`)
        .set(auth(st));
      assert.equal(r.status, 200);
      assert.equal(r.body.data.effectiveStatus, expected, slug);
    }
    r = await request(app).get('/api/v1/admin/promotions?status=ACTIVE&sort=name').set(auth(st));
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.map((p: any) => p.slug),
      ['eid-sale', 'live', 'past']
    );
    assert.equal((await request(app).get('/api/v1/admin/promotions?status=BOGUS').set(auth(st))).status, 400);
    r = await request(app).post(`/api/v1/admin/promotions/${promotionId}/archive`).set(auth(st)).send({});
    assert.equal(r.body.data.status, 'ARCHIVED');
    r = await request(app).post(`/api/v1/admin/promotions/${promotionId}/activate`).set(auth(st)).send({});
    assert.equal(r.body.data.status, 'ACTIVE');
    assert.equal(await AuditLog.countDocuments({ action: 'PROMOTION_ARCHIVED' }), 1);

    /* ------------------------------------------------ §10, §68 banner links are scheme-validated */
    for (const body of [
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'javascript:alert(1)' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'file:///etc/passwd' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', linkType: 'EXTERNAL_URL', linkUrl: 'javascript:void(0)' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', linkType: 'EXTERNAL_URL', linkUrl: 'vbscript:msgbox(1)' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', linkType: 'INTERNAL_PATH', linkPath: '//evil.test/steal' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', linkType: 'INTERNAL_PATH', linkPath: 'shop' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', linkType: 'INTERNAL_PATH', linkPath: '/shop/../../etc' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', linkType: 'PRODUCT' },
      { title: 'Hero', placement: 'CATEGORY_HERO', imageUrl: 'https://e.test/a.png' },
      { title: 'Hero', placement: 'SIDEBAR', imageUrl: 'https://e.test/a.png' },
      { title: 'Hero', imageUrl: 'https://e.test/a.png' },
      { placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', startAt: '2026-06-02T00:00:00.000Z', endAt: '2026-06-01T00:00:00.000Z' },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', priority: -1 },
      { title: 'Hero', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png', status: 'LIVE' },
    ]) {
      assert.equal((await request(app).post('/api/v1/admin/banners').set(auth(st)).send(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(await Banner.countDocuments(), 0);

    /* -------------------------------------------------- §67 hostile content is stripped, not run */
    r = await request(app)
      .post('/api/v1/admin/banners')
      .set(auth(st))
      .send({
        title: 'Eid <script>alert("xss")</script>Sale',
        subtitle: '<img src=x onerror="alert(1)">Save big',
        altText: '<b>Banner</b>',
        placement: 'HOME_HERO',
        imageUrl: 'https://cdn.e.test/hero.png',
        linkType: 'PRODUCT',
        linkProduct: String(product._id),
        status: 'ACTIVE',
        priority: 5,
      });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.title, 'Eid Sale');
    assert.equal(r.body.data.subtitle, 'Save big');
    assert.equal(r.body.data.altText, 'Banner');
    const bannerId = r.body.data.id;
    assert.ok(!JSON.stringify(r.body).includes('<script'));
    assert.ok(!JSON.stringify(r.body).includes('onerror'));
    // A title that is nothing but markup strips to empty and fails the length rule outright.
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/banners')
          .set(auth(st))
          .send({ title: '<script>alert(1)</script>', placement: 'HOME_HERO', imageUrl: 'https://e.test/a.png' })
      ).status,
      400
    );

    /* ------------------------------------------------------------- §60 banner ordering is explicit */
    const second = await request(app)
      .post('/api/v1/admin/banners')
      .set(auth(st))
      .send({ title: 'Second', placement: 'HOME_HERO', imageUrl: 'https://cdn.e.test/2.png', status: 'ACTIVE' });
    r = await request(app)
      .post('/api/v1/admin/banners/reorder')
      .set(auth(st))
      .send({ ids: [second.body.data.id, bannerId] });
    assert.equal(r.status, 200);
    r = await request(app).get('/api/v1/admin/banners?placement=HOME_HERO&sort=priority').set(auth(st));
    assert.deepEqual(
      r.body.data.map((b: any) => b.title),
      ['Second', 'Eid Sale']
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/banners/reorder')
          .set(auth(st))
          .send({ ids: ['507f1f77bcf86cd799439011'] })
      ).status,
      404
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/banners/reorder')
          .set(auth(st))
          .send({ ids: ['nope'] })
      ).status,
      400
    );
    assert.equal((await request(app).post('/api/v1/admin/banners/reorder').set(auth(st)).send({ ids: [] })).status, 400);

    /* -------------------------- §12–13 the homepage is a curated layout, not a free-form builder */
    for (const body of [
      { sections: [{ key: 'raw', type: 'HTML', settings: {} }] },
      { sections: [{ key: 'raw', type: 'HERO', html: '<script>alert(1)</script>' }] },
      { sections: [{ key: 'raw', type: 'HERO', settings: { placement: 'HOME_HERO', script: 'alert(1)' } }] },
      { sections: [{ key: 'Bad Key', type: 'HERO', settings: {} }] },
      {
        sections: [
          { key: 'dupe', type: 'HERO', settings: {} },
          { key: 'dupe', type: 'BANNER', settings: {} },
        ],
      },
      { sections: [{ key: 'rail', type: 'FEATURED_PRODUCTS', settings: { limit: 999 } }] },
      { sections: [{ key: 'rail', type: 'FEATURED_PRODUCTS', settings: { products: ['nope'] } }] },
      { sections: [{ key: 'trust', type: 'TRUST_FEATURES', settings: { features: [{ icon: 'MAGIC', title: 'x' }] } }] },
      { sections: [{ key: 'trust', type: 'TRUST_FEATURES', settings: { features: [] } }] },
      { sections: Array.from({ length: 21 }, (_, i) => ({ key: `s${i}`, type: 'BANNER', settings: {} })) },
    ]) {
      assert.equal((await request(app).put('/api/v1/admin/homepage').set(auth(st)).send(body)).status, 400, JSON.stringify(body).slice(0, 80));
    }
    r = await request(app)
      .put('/api/v1/admin/homepage')
      .set(auth(st))
      .send({
        sections: [
          { key: 'hero', type: 'HERO', position: 0, settings: { placement: 'HOME_HERO', limit: 3 } },
          {
            key: 'picks',
            type: 'FEATURED_PRODUCTS',
            title: 'Our picks <script>alert(1)</script>',
            position: 10,
            settings: { products: [String(product._id)] },
          },
          { key: 'shelf', type: 'FEATURED_CATEGORIES', position: 20, settings: { categories: [String(category._id)] } },
          { key: 'deal', type: 'PROMOTION', position: 30, enabled: false, settings: { promotion: promotionId } },
        ],
      });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.sections.map((s: any) => s.key),
      ['hero', 'picks', 'shelf', 'deal']
    );
    assert.equal(r.body.data.sections[1].title, 'Our picks');
    assert.equal(r.body.data.sections[3].enabled, false);
    // A curated reference must exist before it can be merchandised.
    r = await request(app)
      .put('/api/v1/admin/homepage')
      .set(auth(st))
      .send({ sections: [{ key: 'picks', type: 'FEATURED_PRODUCTS', settings: { products: ['507f1f77bcf86cd799439011'] } }] });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'REFERENCE_NOT_FOUND');

    r = await request(app)
      .post('/api/v1/admin/homepage/reorder')
      .set(auth(st))
      .send({ keys: ['shelf', 'hero'] });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.sections.map((s: any) => s.key),
      ['shelf', 'hero', 'picks', 'deal']
    );
    assert.deepEqual(
      r.body.data.sections.map((s: any) => s.position),
      [0, 10, 20, 30]
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/homepage/reorder')
          .set(auth(st))
          .send({ keys: ['ghost'] })
      ).status,
      404
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/homepage/reorder')
          .set(auth(st))
          .send({ keys: ['hero', 'hero'] })
      ).status,
      404
    );
    r = await request(app).patch('/api/v1/admin/homepage/sections/deal').set(auth(st)).send({ enabled: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.sections.find((s: any) => s.key === 'deal').enabled, true);
    assert.equal((await request(app).patch('/api/v1/admin/homepage/sections/ghost').set(auth(st)).send({ enabled: true })).status, 404);
    assert.equal((await request(app).patch('/api/v1/admin/homepage/sections/deal').set(auth(st)).send({ enabled: true, position: 0 })).status, 400);
    // An empty submission restores the built-in layout rather than blanking the storefront.
    r = await request(app).put('/api/v1/admin/homepage').set(auth(st)).send({ sections: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.sections.map((s: any) => s.key),
      ['hero', 'categories', 'featured', 'new-arrivals', 'promo', 'best-sellers', 'trust']
    );

    /* --------------------------------------------------- §58 meaningful actions are all recorded */
    const actions = await AuditLog.distinct('action');
    for (const action of [
      'COUPON_CREATED',
      'COUPON_UPDATED',
      'COUPON_ENABLED',
      'COUPON_ARCHIVED',
      'PROMOTION_CREATED',
      'PROMOTION_ACTIVATED',
      'PROMOTION_ARCHIVED',
      'BANNER_CREATED',
      'BANNER_REORDERED',
      'HOMEPAGE_UPDATED',
      'HOMEPAGE_REORDERED',
    ])
      assert.ok(actions.includes(action), action);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
