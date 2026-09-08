import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Category } from '../src/models/category.js';
import { CmsPage, Faq } from '../src/models/cmsPage.js';
import { NavigationMenu } from '../src/models/navigationMenu.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';

/**
 * CMS pages, FAQs and navigation.
 *
 * The two invariants under test are structural. A page body is a list of typed blocks, so
 * there is no field in the API that accepts HTML or a script; and a menu entry is dropped
 * from the public payload when its target is not publicly available, so wiring navigation
 * to a draft page cannot leak it (§14–17, §35–37, §67–68).
 */
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('CMS pages, FAQs and navigation are structured, sanitised and publish-gated', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([CmsPage.init(), Faq.init(), NavigationMenu.init(), Product.init(), Category.init()]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'admin@cms.test', password: 'x', role: 'SUPER_ADMIN' },
      { name: 'Buyer', email: 'buyer@cms.test', password: 'x', role: 'CUSTOMER' },
    ]);
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const [category, live, draftProduct] = await Promise.all([
      Category.create({ name: 'Audio', slug: 'audio', status: 'ACTIVE' }),
      Product.create({
        name: 'Live product',
        description: 'x',
        price: 500,
        category: 'Audio',
        image: 'https://e.test/p',
        stock: 5,
        status: 'ACTIVE',
        sku: 'CMS-1',
      }),
      Product.create({
        name: 'Hidden import',
        description: 'x',
        price: 500,
        category: 'Audio',
        image: 'https://e.test/p',
        stock: 5,
        status: 'DRAFT',
        sku: 'CMS-2',
      }),
    ]);

    /* ------------------------------------------------------------------- §57 authorization gates */
    for (const path of ['/api/v1/admin/pages', '/api/v1/admin/faqs', '/api/v1/admin/navigation']) {
      assert.equal((await request(app).get(path)).status, 401);
      assert.equal((await request(app).get(path).set(auth(ct))).status, 403);
      assert.equal((await request(app).get(path).set(auth(st))).status, 200);
    }

    /* ------------------------------------------- §15–16 a page body is typed blocks, never markup */
    for (const body of [
      { title: 'Raw', content: '<p>hello</p>' },
      { title: 'Raw', html: '<script>alert(1)</script>' },
      { title: 'Raw', blocks: [{ type: 'RAW', text: 'x' }] },
      { title: 'Raw', blocks: [{ type: 'PARAGRAPH', text: 'x', script: 'alert(1)' }] },
      { title: 'Raw', blocks: [{ type: 'HEADING', level: 1, text: 'x' }] },
      { title: 'Raw', blocks: [{ type: 'HEADING', level: 5, text: 'x' }] },
      { title: 'Raw', blocks: [{ type: 'LIST', style: 'BULLET', items: [] }] },
      { title: 'Raw', blocks: [{ type: 'LIST', style: 'CHECKBOX', items: ['a'] }] },
      { title: 'Raw', blocks: [{ type: 'IMAGE', url: 'javascript:alert(1)', alt: 'x' }] },
      { title: 'Raw', blocks: [{ type: 'IMAGE', url: 'data:image/svg+xml,<svg onload=alert(1)>', alt: 'x' }] },
      { title: 'Raw', blocks: Array.from({ length: 121 }, () => ({ type: 'DIVIDER' })) },
      { title: 'Raw', seo: { robots: 'noindex,noarchive' } },
      { title: 'Raw', seo: { canonicalUrl: 'javascript:alert(1)' } },
      { title: 'Raw', seo: { metaTitle: 'x', unknown: 'y' } },
      { title: 'Raw', slug: 'Not A Slug' },
      { title: 'Raw', slug: 'x'.repeat(121) },
      { title: 'Raw', status: 'LIVE' },
      { title: '<script>alert(1)</script>' },
      { title: 'Raw', _id: '507f1f77bcf86cd799439011' },
      { title: 'Raw', createdBy: String(admin._id) },
      { title: 'Raw', publishedAt: '2020-01-01T00:00:00.000Z' },
      { slug: 'no-title' },
    ]) {
      assert.equal((await request(app).post('/api/v1/admin/pages').set(auth(st)).send(body)).status, 400, JSON.stringify(body).slice(0, 90));
    }
    assert.equal(await CmsPage.countDocuments(), 0);

    /* ------------------------------------------------- §14 slug derivation and slug uniqueness */
    let r = await request(app)
      .post('/api/v1/admin/pages')
      .set(auth(st))
      .send({
        title: 'Shipping Policy',
        excerpt: 'How MansooriKart delivers.',
        blocks: [
          { type: 'HEADING', text: 'Delivery' },
          { type: 'PARAGRAPH', text: 'Orders ship within two working days.' },
          { type: 'LIST', style: 'NUMBER', items: ['Karachi: 2 days', 'Other cities: 4 days'] },
          { type: 'QUOTE', text: 'We deliver nationwide.' },
          { type: 'IMAGE', url: 'https://cdn.mansoorikart.test/ship.png', alt: 'Delivery van' },
          { type: 'DIVIDER' },
        ],
      });
    assert.equal(r.status, 201);
    const shippingPage = r.body.data.id;
    assert.equal(r.body.data.slug, 'shipping-policy');
    assert.equal(r.body.data.status, 'DRAFT');
    assert.equal(r.body.data.publishedAt, null);
    assert.equal(r.body.data.blocks.length, 6);
    assert.equal(r.body.data.blocks[0].level, 2);
    // The same title again collides on the unique slug index rather than creating a twin.
    assert.equal((await request(app).post('/api/v1/admin/pages').set(auth(st)).send({ title: 'Shipping Policy' })).body.error.code, 'PAGE_SLUG_EXISTS');
    // A title with no sluggable characters is refused, not stored with an empty slug.
    assert.equal((await request(app).post('/api/v1/admin/pages').set(auth(st)).send({ title: '!!!' })).body.error.code, 'PAGE_INVALID');

    /* ---------------------------------- §14 publishedAt is stamped once and then never rewritten */
    r = await request(app).post(`/api/v1/admin/pages/${shippingPage}/publish`).set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, 'PUBLISHED');
    const firstPublishedAt = r.body.data.publishedAt;
    assert.ok(firstPublishedAt);
    // Re-publishing is idempotent, an edit does not restate the date, and archiving keeps it.
    assert.equal((await request(app).post(`/api/v1/admin/pages/${shippingPage}/publish`).set(auth(st))).body.data.publishedAt, firstPublishedAt);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/pages/${shippingPage}`).set(auth(st)).send({ excerpt: 'Updated copy.' })).body.data.publishedAt,
      firstPublishedAt
    );
    r = await request(app).post(`/api/v1/admin/pages/${shippingPage}/archive`).set(auth(st));
    assert.equal(r.body.data.status, 'ARCHIVED');
    assert.equal(r.body.data.publishedAt, firstPublishedAt);
    r = await request(app).post(`/api/v1/admin/pages/${shippingPage}/publish`).set(auth(st));
    assert.equal(r.body.data.status, 'PUBLISHED');
    assert.equal(r.body.data.publishedAt, firstPublishedAt);
    assert.equal(await AuditLog.countDocuments({ action: 'CMS_PAGE_PUBLISHED' }), 2);
    // A patch that changes nothing writes no audit entry (§59).
    await request(app).patch(`/api/v1/admin/pages/${shippingPage}`).set(auth(st)).send({ excerpt: 'Updated copy.' });
    assert.equal(await AuditLog.countDocuments({ action: 'CMS_PAGE_UPDATED' }), 1);
    // §16 a page carries the store's current text: there is no version field to write to.
    assert.equal((await request(app).patch(`/api/v1/admin/pages/${shippingPage}`).set(auth(st)).send({ version: 2 })).status, 400);

    /* ------------------------------ §35 the five policy documents are ordinary CMS pages, not
       five bespoke models, and they are reached through the one public page endpoint. */
    const policies: Record<string, string> = {};
    for (const title of ['Returns Policy', 'Refund Policy', 'Privacy Policy', 'Terms and Conditions']) {
      r = await request(app)
        .post('/api/v1/admin/pages')
        .set(auth(st))
        .send({ title, excerpt: `${title} summary.`, blocks: [{ type: 'PARAGRAPH', text: `${title} text.` }] });
      assert.equal(r.status, 201);
      policies[r.body.data.slug] = r.body.data.id;
      assert.equal((await request(app).post(`/api/v1/admin/pages/${r.body.data.id}/publish`).set(auth(st))).status, 200);
    }
    assert.equal(await CmsPage.countDocuments({ status: 'PUBLISHED' }), 5);
    r = await request(app).get('/api/v1/store/pages');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.map((page: any) => page.slug).sort(), [
      'privacy-policy',
      'refund-policy',
      'returns-policy',
      'shipping-policy',
      'terms-and-conditions',
    ]);
    assert.ok(r.body.data.every((page: any) => Object.keys(page).join(',') === 'slug,title,excerpt,publishedAt'));

    /* ----------------------- §15–16 a public page body carries no field a client could execute */
    r = await request(app).get('/api/v1/store/pages/shipping-policy');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data), ['slug', 'title', 'excerpt', 'blocks', 'seo', 'publishedAt', 'updatedAt']);
    assert.deepEqual(Object.keys(r.body.data.seo), ['metaTitle', 'metaDescription', 'canonicalUrl', 'robots']);
    assert.equal(r.body.data.seo.robots, 'index,follow');
    const blockKeys = new Set(['type', 'level', 'text', 'items', 'style', 'url', 'alt']);
    for (const block of r.body.data.blocks) for (const key of Object.keys(block)) assert.ok(blockKeys.has(key), key);

    /* ------------------- §63 a DRAFT page is indistinguishable from a slug that does not exist */
    r = await request(app)
      .post('/api/v1/admin/pages')
      .set(auth(st))
      .send({ title: 'Unreleased Notice', blocks: [{ type: 'PARAGRAPH', text: 'Internal draft copy.' }] });
    assert.equal(r.status, 201);
    const draftPage = r.body.data.id;
    const draftResponse = await request(app).get('/api/v1/store/pages/unreleased-notice');
    const unknownResponse = await request(app).get('/api/v1/store/pages/no-such-page');
    assert.equal(draftResponse.status, 404);
    assert.equal(unknownResponse.status, 404);
    assert.equal(draftResponse.body.error.code, 'PAGE_NOT_FOUND');
    assert.deepEqual(draftResponse.body.error, unknownResponse.body.error);
    assert.ok(!JSON.stringify(draftResponse.body).includes('Internal draft'));
    // A malformed slug is rejected before it reaches Mongo, with the same 404 body.
    assert.equal((await request(app).get('/api/v1/store/pages/Not_A_Slug')).status, 404);

    /* ------------------------- §67 markup in a page title, excerpt, block or SEO field does not
       survive validation: text is stripped on the way in, so there is nothing to sanitise later. */
    r = await request(app)
      .post('/api/v1/admin/pages')
      .set(auth(st))
      .send({
        title: 'Contact <script>alert("xss")</script>Us',
        excerpt: '<img src=x onerror="alert(1)">Reach our team',
        blocks: [
          { type: 'HEADING', level: 3, text: '<b>Support</b> hours' },
          { type: 'PARAGRAPH', text: 'Call us <iframe src="javascript:alert(1)"></iframe>any day' },
          { type: 'LIST', items: ['<script>bad()</script>Karachi office'] },
        ],
        seo: {
          metaTitle: '<h1>Contact</h1>',
          metaDescription: 'Bracket &lt;test&gt; safe',
          canonicalUrl: 'https://mansoorikart.test/contact',
          robots: 'noindex,follow',
        },
      });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.slug, 'contact-us');
    assert.equal(r.body.data.title, 'Contact Us');
    assert.equal(r.body.data.excerpt, 'Reach our team');
    assert.equal(r.body.data.blocks[0].level, 3);
    assert.equal(r.body.data.blocks[0].text, 'Support hours');
    assert.equal(r.body.data.blocks[1].text, 'Call us any day');
    assert.equal(r.body.data.blocks[2].items[0], 'Karachi office');
    assert.equal(r.body.data.blocks[2].style, 'BULLET');
    assert.equal(r.body.data.seo.metaTitle, 'Contact');
    assert.equal(r.body.data.seo.metaDescription, 'Bracket test safe');
    assert.ok(!JSON.stringify(r.body).includes('<'));
    assert.ok(!JSON.stringify(r.body).includes('onerror'));

    /* --------------------- §55–56 allowlisted admin filters, sorts and bounded pagination, and
       §54 a malformed identifier is a clean 404 rather than a CastError or a stack trace. */
    r = await request(app).get('/api/v1/admin/pages?status=PUBLISHED&sort=slug&page=1&limit=2').set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 2);
    assert.deepEqual(
      r.body.data.map((page: any) => page.slug),
      ['privacy-policy', 'refund-policy']
    );
    assert.equal(r.body.meta.total, 5);
    assert.equal(r.body.meta.totalPages, 3);
    assert.equal(r.body.meta.hasNextPage, true);
    assert.equal(r.body.meta.hasPreviousPage, false);
    // Search is an escaped substring match, so regex syntax matches literally or not at all.
    assert.deepEqual((await request(app).get('/api/v1/admin/pages?search=Policy.*').set(auth(st))).body.data, []);
    assert.equal((await request(app).get('/api/v1/admin/pages?sort=price').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/pages?limit=500').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/pages?page=0').set(auth(st))).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/pages?status[$ne]=DRAFT').set(auth(st))).status, 400);
    for (const path of ['/api/v1/admin/pages/nope', '/api/v1/admin/faqs/nope']) {
      const response = await request(app).get(path).set(auth(st));
      assert.equal(response.status, 404);
      assert.ok(!JSON.stringify(response.body).includes('Cast'));
      assert.ok(!JSON.stringify(response.body).includes('stack'));
    }
    assert.equal((await request(app).patch('/api/v1/admin/pages/nope').set(auth(st)).send({ title: 'x' })).status, 404);
    assert.equal((await request(app).delete('/api/v1/admin/faqs/nope').set(auth(st))).status, 404);

    /* ----------------------------------------------------------------------- §17 the FAQ domain */
    for (const body of [
      { question: 'Q', answer: '<script>alert(1)</script>' },
      { question: 'Q', answer: 'A', status: 'PUBLISHED' },
      { question: 'Q', answer: 'A', position: -1 },
      { question: 'Q', answer: 'A', createdBy: String(admin._id) },
      { question: 'Q' },
      { answer: 'A' },
      { question: 'x'.repeat(301), answer: 'A' },
    ]) {
      assert.equal((await request(app).post('/api/v1/admin/faqs').set(auth(st)).send(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal(await Faq.countDocuments(), 0);

    const faqIds: string[] = [];
    for (const [question, answerText, faqCategory] of [
      ['Do you deliver nationwide?', 'Yes, to every major city in Pakistan.', 'Shipping'],
      ['How do I return an item?', 'Start a return within 7 days of delivery.', 'Returns'],
      ['Is cash on delivery available?', 'Yes, COD is available across Pakistan.', 'Payments'],
    ] as const) {
      r = await request(app).post('/api/v1/admin/faqs').set(auth(st)).send({ question, answer: answerText, category: faqCategory, status: 'ACTIVE' });
      assert.equal(r.status, 201);
      faqIds.push(r.body.data.id);
    }
    // Reorder is one bulkWrite, so the list never holds two entries at the same position.
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/faqs/reorder')
          .set(auth(st))
          .send({ ids: [faqIds[2], faqIds[0], faqIds[1]] })
      ).status,
      200
    );
    assert.deepEqual(
      (await Faq.find().sort({ position: 1 }).select('category position').lean()).map((faq: any) => [faq.category, faq.position]),
      [
        ['Payments', 0],
        ['Shipping', 1],
        ['Returns', 2],
      ]
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/faqs/reorder')
          .set(auth(st))
          .send({ ids: [faqIds[0], '507f1f77bcf86cd799439011'] })
      ).status,
      404
    );
    assert.equal((await request(app).post('/api/v1/admin/faqs/reorder').set(auth(st)).send({ ids: [] })).status, 400);
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/faqs/reorder')
          .set(auth(st))
          .send({ ids: ['nope'] })
      ).status,
      400
    );
    // A patch that changes nothing writes no audit entry (§59).
    const revised = 'Start a return within 7 days of delivery, unused and in its original packaging.';
    assert.equal((await request(app).patch(`/api/v1/admin/faqs/${faqIds[1]}`).set(auth(st)).send({ answer: revised })).status, 200);
    assert.equal((await request(app).patch(`/api/v1/admin/faqs/${faqIds[1]}`).set(auth(st)).send({ answer: revised })).status, 200);
    assert.equal(await AuditLog.countDocuments({ action: 'FAQ_UPDATED' }), 1);

    /* ------------------------------- §17 only ACTIVE entries are public, in operator order, and
       an archived FAQ leaves the storefront without being deleted. */
    assert.equal(
      (await request(app).post('/api/v1/admin/faqs').set(auth(st)).send({ question: 'Internal note?', answer: 'Draft answer.', category: 'Internal' })).status,
      201
    );
    assert.deepEqual((await request(app).delete(`/api/v1/admin/faqs/${faqIds[1]}`).set(auth(st))).body.data, { id: faqIds[1], archived: true });
    assert.equal(await Faq.countDocuments(), 4);
    r = await request(app).get('/api/v1/store/faqs');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.map((faq: any) => faq.category),
      ['Payments', 'Shipping']
    );
    assert.deepEqual(Object.keys(r.body.data[0]), ['id', 'question', 'answer', 'category']);
    assert.deepEqual(
      (await request(app).get('/api/v1/store/faqs?category=payments')).body.data.map((faq: any) => faq.category),
      ['Payments']
    );
    assert.deepEqual((await request(app).get('/api/v1/store/faqs?category=Shipping.*')).body.data, []);
    assert.equal((await request(app).get('/api/v1/store/faqs?limit=0')).status, 400);
    assert.equal((await request(app).get('/api/v1/store/faqs?status=DRAFT')).status, 400);
    assert.ok(!JSON.stringify(r.body).includes('Draft answer'));

    /* ---------------------------------------------------------- §36–37 controlled navigation */
    assert.equal((await request(app).get('/api/v1/admin/navigation/SIDEBAR').set(auth(st))).body.error.code, 'MENU_NOT_FOUND');
    assert.equal((await request(app).put('/api/v1/admin/navigation/SIDEBAR').set(auth(st)).send({ items: [] })).status, 404);
    r = await request(app).get('/api/v1/admin/navigation').set(auth(st));
    assert.deepEqual(
      r.body.data.map((menu: any) => menu.menu),
      ['HEADER', 'FOOTER']
    );
    // Each menu is a singleton: concurrent first reads must not produce a second document (§19).
    await Promise.all([request(app).get('/api/v1/admin/navigation').set(auth(st)), request(app).get('/api/v1/admin/navigation').set(auth(st))]);
    assert.equal(await NavigationMenu.countDocuments(), 2);

    for (const items of [
      [{ label: 'Shop', type: 'INTERNAL_PATH' }],
      [{ label: 'Shop', type: 'CATEGORY' }],
      [{ label: 'Shop', type: 'PRODUCT' }],
      [{ label: 'Shop', type: 'CMS_PAGE' }],
      [{ label: 'Shop', type: 'EXTERNAL_URL' }],
      [{ label: 'Shop', type: 'MEGA_MENU', path: '/shop' }],
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: '//evil.test' }],
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: 'shop' }],
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: '/shop/../admin' }],
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: '/shop?q=<script>' }],
      [{ label: 'Shop', type: 'EXTERNAL_URL', url: 'javascript:alert(1)' }],
      [{ label: 'Shop', type: 'EXTERNAL_URL', url: 'data:text/html,<script>alert(1)</script>' }],
      [{ label: 'Shop', type: 'EXTERNAL_URL', url: 'file:///etc/passwd' }],
      [{ label: 'Shop', type: 'EXTERNAL_URL', url: 'https://' }],
      [{ label: '<script>alert(1)</script>', type: 'INTERNAL_PATH', path: '/shop' }],
      [{ label: 'Shop', type: 'CATEGORY', category: 'not-an-id' }],
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: '/shop', target: '_blank' }],
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: '/shop', position: -1 }],
      // Depth stops at one level: a child schema has no `children` key at all (§37).
      [{ label: 'Shop', type: 'INTERNAL_PATH', path: '/shop', children: [{ label: 'Deep', type: 'INTERNAL_PATH', path: '/deep', children: [] }] }],
      Array.from({ length: 31 }, (_, index) => ({ label: `Item ${index}`, type: 'INTERNAL_PATH', path: `/i${index}` })),
    ]) {
      assert.equal((await request(app).put('/api/v1/admin/navigation/HEADER').set(auth(st)).send({ items })).status, 400, JSON.stringify(items).slice(0, 80));
    }
    // Existence is checked at write time; a reference that can never resolve is a 400.
    assert.equal(
      (
        await request(app)
          .put('/api/v1/admin/navigation/HEADER')
          .set(auth(st))
          .send({ items: [{ label: 'Gone', type: 'CATEGORY', category: '507f1f77bcf86cd799439011' }] })
      ).body.error.code,
      'REFERENCE_NOT_FOUND'
    );
    assert.deepEqual((await NavigationMenu.findOne({ menu: 'HEADER' }).lean()).items, []);

    r = await request(app)
      .put('/api/v1/admin/navigation/HEADER')
      .set(auth(st))
      .send({
        items: [
          {
            label: 'Shop',
            type: 'INTERNAL_PATH',
            path: '/shop',
            position: 0,
            children: [
              { label: 'Audio', type: 'CATEGORY', category: String(category._id), position: 1 },
              { label: 'Live pick', type: 'PRODUCT', product: String(live._id), position: 0 },
            ],
          },
          { label: 'Coming soon', type: 'PRODUCT', product: String(draftProduct._id), position: 10 },
          { label: 'Unreleased', type: 'CMS_PAGE', page: draftPage, position: 20 },
          { label: 'Shipping', type: 'CMS_PAGE', page: shippingPage, position: 30 },
          { label: 'Hidden entry', type: 'INTERNAL_PATH', path: '/secret', position: 40, enabled: false },
          { label: 'Blog', type: 'EXTERNAL_URL', url: 'https://blog.mansoorikart.test', position: 50 },
        ],
      });
    assert.equal(r.status, 200);
    // The admin view keeps every entry, including the ones the storefront is about to drop, so
    // an operator can see and repair them.
    assert.deepEqual(
      r.body.data.items.map((item: any) => item.label),
      ['Shop', 'Coming soon', 'Unreleased', 'Shipping', 'Hidden entry', 'Blog']
    );
    assert.deepEqual(
      r.body.data.items[0].children.map((child: any) => child.label),
      ['Live pick', 'Audio']
    );
    assert.equal(
      (
        await request(app)
          .put('/api/v1/admin/navigation/FOOTER')
          .set(auth(st))
          .send({ items: [{ label: 'Returns', type: 'CMS_PAGE', page: policies['returns-policy'], position: 0 }] })
      ).status,
      200
    );

    /* ------------------------- §37 the public menu drops every entry a customer must not see */
    r = await request(app).get('/api/v1/store/navigation');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data), ['header', 'footer']);
    assert.deepEqual(
      r.body.data.header.map((item: any) => item.label),
      ['Shop', 'Shipping', 'Blog']
    );
    assert.deepEqual(
      r.body.data.header[0].children.map((child: any) => child.label),
      ['Live pick', 'Audio']
    );
    assert.equal(r.body.data.header[0].children[1].slug, 'audio');
    assert.equal(r.body.data.header[1].slug, 'shipping-policy');
    assert.equal(r.body.data.header[2].url, 'https://blog.mansoorikart.test/');
    assert.deepEqual(
      r.body.data.footer.map((item: any) => [item.label, item.slug]),
      [['Returns', 'returns-policy']]
    );
    for (const forbidden of ['Coming soon', 'Unreleased', 'Hidden entry', '/secret', String(draftProduct._id), draftPage, 'position', 'enabled', 'updatedBy'])
      assert.ok(!JSON.stringify(r.body).includes(forbidden), forbidden);

    /* -------------------------------------------- §58 every content decision is audited exactly
       once, and nothing in the API can edit or remove a trail entry. */
    for (const action of [
      'CMS_PAGE_CREATED',
      'CMS_PAGE_UPDATED',
      'CMS_PAGE_PUBLISHED',
      'CMS_PAGE_ARCHIVED',
      'FAQ_CREATED',
      'FAQ_UPDATED',
      'FAQ_REORDERED',
      'FAQ_ARCHIVED',
      'NAVIGATION_UPDATED',
    ])
      assert.ok((await AuditLog.countDocuments({ action })) > 0, action);
    assert.equal(await AuditLog.countDocuments({ action: 'NAVIGATION_UPDATED' }), 2);
    assert.equal(await AuditLog.countDocuments({ resourceType: 'CmsPage', action: 'CMS_PAGE_CREATED' }), 7);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
