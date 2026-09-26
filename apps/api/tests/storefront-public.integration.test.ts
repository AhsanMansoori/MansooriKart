/**
 * The public storefront read surface: configuration, homepage, navigation and content.
 *
 * Every endpoint here is unauthenticated and never writes, so the questions are whether a
 * customer sees what the operator curated, in the operator's order, and nothing else.
 * Eligibility is asserted from the outside: a DRAFT product, an unpublished page, an
 * archived FAQ, a scheduled promotion and a banner outside its window are checked for
 * absence in the HTTP response rather than in a filter function (§43–46, §63, §70–71).
 *
 * The leakage sweep in the first test is the one that matters most. Real supplier, cost,
 * pricing-rule and catalog-import records are created first, so the assertion is that the
 * serializers withhold internal data which genuinely exists — not data that was never
 * written in the first place (§62).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoMemoryServer } from './helpers/mongo.js';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { CONTENT_LIMITS } from '../src/config/storefront.js';
import { Banner } from '../src/models/banner.js';
import { CatalogImportJob } from '../src/models/catalogImport.js';
import { Category } from '../src/models/category.js';
import { CmsPage, Faq } from '../src/models/cmsPage.js';
import { HomepageConfiguration } from '../src/models/homepageConfiguration.js';
import { NavigationMenu } from '../src/models/navigationMenu.js';
import { PricingRule } from '../src/models/pricingRule.js';
import { Product } from '../src/models/product.js';
import { Promotion } from '../src/models/promotion.js';
import { Supplier } from '../src/models/supplier.js';
import { SupplierCatalogItem } from '../src/models/supplierCatalogItem.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const memory = () => MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
/** Every public payload, swept together so a new endpoint cannot escape the leak checks. */
const PUBLIC_PATHS = [
  '/api/v1/store/config',
  '/api/v1/store/home',
  '/api/v1/store/navigation',
  '/api/v1/store/faqs',
  '/api/v1/store/pages',
  '/api/v1/store/pages/shipping-policy',
  '/api/v1/store/promotions',
  '/api/v1/store/banners',
];
/** A published ObjectId. Ids are hex, so any short digit run can occur inside one by chance. */
const HEX_ID = /^[0-9a-f]{24}$/;
/** Every primitive in a payload, flattened, so an internal value can be matched exactly. */
function jsonValues(node: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) for (const item of node) jsonValues(item, found);
  else if (node && typeof node === 'object') for (const item of Object.values(node)) jsonValues(item, found);
  else found.push(node);
  return found;
}
test('the public storefront serves eligible content only and never leaks internal records', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Product.init(), Category.init(), CmsPage.init(), Supplier.init(), SupplierCatalogItem.init(), CatalogImportJob.init()]);
    const admin = await User.create({ name: 'Ops Admin', email: 'ops-secret-admin@mansoorikart.test', password: 'unused', role: 'SUPER_ADMIN' });
    await Category.create({ name: 'Mobile Phones', slug: 'mobile-phones', description: 'Handsets', status: 'ACTIVE', sortOrder: 1 });
    await Category.create({ name: 'Retired Gadgets', slug: 'retired-gadgets', status: 'ARCHIVED' });

    /* ------------ §63 a DRAFT supplier-import product exists and must stay invisible */
    const shared = {
      description: 'A phone for the Pakistan market.',
      category: 'Mobile Phones',
      image: 'https://cdn.mansoorikart.test/p.jpg',
      currency: 'PKR',
    };
    const live = await Product.create({
      ...shared,
      name: 'Galaxy A55',
      slug: 'galaxy-a55',
      sku: 'MK-A55',
      shortDescription: 'Slim 5G handset.',
      brand: 'Samsung',
      price: 129999,
      compareAtPrice: 139999,
      costPrice: 987654,
      stock: 12,
      status: 'ACTIVE',
      featured: true,
      createdBy: admin._id,
    });
    const draft = await Product.create({
      ...shared,
      name: 'Unreleased Handset',
      slug: 'unreleased-handset',
      sku: 'MK-DRAFT',
      price: 5555,
      stock: 4,
      status: 'DRAFT',
      featured: true,
      sourceType: 'SUPPLIER_CSV',
      fulfillmentType: 'DROPSHIP',
      createdBy: admin._id,
    });
    await Product.create({
      ...shared,
      name: 'Discontinued Handset',
      slug: 'discontinued-handset',
      sku: 'MK-ARCH',
      price: 4444,
      stock: 0,
      status: 'ARCHIVED',
      featured: true,
    });
    const supplier = await Supplier.create({ name: 'Karachi Wholesale Traders', code: 'KWT-INTERNAL' });
    await SupplierCatalogItem.create({
      supplier: supplier._id,
      product: draft._id,
      supplierSku: 'SUP-SKU-4237',
      supplierProductName: 'OEM Handset A55',
      supplierCost: 4237,
      supplierStock: 40,
    });
    await PricingRule.create({ name: 'Wholesale Markup Rule', markupType: 'PERCENTAGE', markupValue: 35, createdBy: admin._id });
    await CatalogImportJob.create({
      jobNumber: 'IMP-INTERNAL-0001',
      supplier: supplier._id,
      fileName: 'supplier-feed.csv',
      fileSize: 2048,
      createdBy: admin._id,
    });
    const publishedAt = new Date('2026-02-01T09:00:00.000Z');
    await CmsPage.create({
      title: 'Shipping Policy',
      slug: 'shipping-policy',
      excerpt: 'How we deliver across Pakistan.',
      status: 'PUBLISHED',
      publishedAt,
      blocks: [
        { type: 'HEADING', level: 2, text: 'Delivery times' },
        { type: 'PARAGRAPH', text: 'Orders leave our warehouse within one working day.' },
        { type: 'LIST', style: 'BULLET', items: ['Karachi: 1-2 days', 'Other cities: 2-4 days'] },
      ],
      seo: {
        metaTitle: 'Shipping Policy | MansooriKart',
        metaDescription: 'Delivery times across Pakistan.',
        canonicalUrl: 'https://mansoorikart.test/pages/shipping-policy',
        robots: 'index,follow',
      },
      createdBy: admin._id,
    });
    await CmsPage.create({
      title: 'Unpublished Terms',
      slug: 'unpublished-terms',
      status: 'DRAFT',
      blocks: [{ type: 'PARAGRAPH', text: 'Internal draft.' }],
      createdBy: admin._id,
    });
    await CmsPage.create({ title: 'Old Refunds', slug: 'old-refunds', status: 'ARCHIVED', createdBy: admin._id });
    await Faq.create([
      { question: 'Do you deliver nationwide?', answer: 'Yes, across Pakistan.', category: 'Delivery', position: 10, status: 'ACTIVE', createdBy: admin._id },
      { question: 'Is cash on delivery available?', answer: 'Yes, on every order.', category: 'Payments', position: 0, status: 'ACTIVE' },
      { question: 'Internal draft question', answer: 'Not ready yet.', category: 'Delivery', position: 5, status: 'DRAFT' },
      { question: 'Retired question', answer: 'No longer relevant.', position: 1, status: 'ARCHIVED' },
    ]);

    /* ------------ §43, §70 an unconfigured store serves the default layout and writes nothing */
    let r = await request(app).get('/api/v1/store/home');
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.equal(await HomepageConfiguration.countDocuments(), 0);
    assert.deepEqual(
      r.body.data.sections.map((section: any) => section.key),
      ['hero', 'categories', 'featured', 'new-arrivals', 'promo', 'best-sellers', 'trust']
    );
    assert.ok(new Date(r.body.data.generatedAt).getTime() > 0);
    const section = (key: string) => r.body.data.sections.find((entry: any) => entry.key === key);
    assert.deepEqual(section('hero').banners, []);
    assert.deepEqual(
      section('categories').categories.map((category: any) => category.slug),
      ['mobile-phones']
    );
    /* Only the ACTIVE product appears, in every rail that could have shown the others. */
    for (const key of ['featured', 'new-arrivals', 'best-sellers'])
      assert.deepEqual(
        section(key).products.map((product: any) => product.slug),
        ['galaxy-a55'],
        key
      );
    /* ------------ §44 the product projection is an allowlist, not the catalog document */
    assert.deepEqual(Object.keys(section('featured').products[0]).sort(), [
      'availableStock',
      'brand',
      'category',
      'compareAtPrice',
      'currency',
      'description',
      'featured',
      'id',
      'images',
      'name',
      'price',
      'ratingAverage',
      'ratingCount',
      'shortDescription',
      'sku',
      'slug',
    ]);
    assert.equal(section('featured').products[0].id, String(live._id));
    assert.deepEqual(
      section('trust').features.map((feature: any) => feature.icon),
      ['COD', 'SHIPPING', 'RETURNS', 'SUPPORT']
    );

    /* ------------ §17, §46 FAQs are ordered by position and filtered by status */
    r = await request(app).get('/api/v1/store/faqs');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.map((faq: any) => faq.question),
      ['Is cash on delivery available?', 'Do you deliver nationwide?']
    );
    assert.deepEqual(Object.keys(r.body.data[0]).sort(), ['answer', 'category', 'id', 'question']);
    r = await request(app).get('/api/v1/store/faqs?category=delivery');
    assert.deepEqual(
      r.body.data.map((faq: any) => faq.question),
      ['Do you deliver nationwide?']
    );
    r = await request(app).get('/api/v1/store/faqs?limit=1');
    assert.equal(r.body.data.length, 1);
    /* The category filter is an escaped literal match: regex syntax matches nothing. */
    r = await request(app).get('/api/v1/store/faqs?category=.%2A');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, []);
    /* ------------ §14–16, §63 only PUBLISHED pages are listed or readable */
    r = await request(app).get('/api/v1/store/pages');
    assert.deepEqual(
      r.body.data.map((page: any) => page.slug),
      ['shipping-policy']
    );
    assert.deepEqual(Object.keys(r.body.data[0]).sort(), ['excerpt', 'publishedAt', 'slug', 'title']);
    r = await request(app).get('/api/v1/store/pages/SHIPPING-POLICY');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['blocks', 'excerpt', 'publishedAt', 'seo', 'slug', 'title', 'updatedAt']);
    assert.deepEqual(Object.keys(r.body.data.seo).sort(), ['canonicalUrl', 'metaDescription', 'metaTitle', 'robots']);
    assert.equal(r.body.data.publishedAt, publishedAt.toISOString());
    assert.deepEqual(r.body.data.blocks, [
      { type: 'HEADING', level: 2, text: 'Delivery times' },
      { type: 'PARAGRAPH', text: 'Orders leave our warehouse within one working day.' },
      { type: 'LIST', style: 'BULLET', items: ['Karachi: 1-2 days', 'Other cities: 2-4 days'] },
    ]);
    /* A hidden page answers exactly as an unknown one, so the 404 reveals no inventory. */
    const hiddenPage = await request(app).get('/api/v1/store/pages/unpublished-terms');
    const archivedPage = await request(app).get('/api/v1/store/pages/old-refunds');
    const unknownPage = await request(app).get('/api/v1/store/pages/no-such-page');
    const malformedPage = await request(app).get('/api/v1/store/pages/not_a_slug');
    for (const response of [hiddenPage, archivedPage, unknownPage, malformedPage]) {
      assert.equal(response.status, 404);
      assert.deepEqual(response.body.error, unknownPage.body.error);
      assert.equal(response.body.error.code, 'PAGE_NOT_FOUND');
      assert.ok(!JSON.stringify(response.body).includes('stack'));
    }

    /* ------------ §51, §71 every list is bounded and every unknown parameter is refused */
    for (const path of [
      '/api/v1/store/pages?limit=0',
      '/api/v1/store/pages?limit=101',
      '/api/v1/store/pages?page=2',
      '/api/v1/store/faqs?limit=101',
      '/api/v1/store/faqs?category=',
      '/api/v1/store/faqs?status=DRAFT',
      '/api/v1/store/promotions?limit=101',
      '/api/v1/store/banners?limit=13',
      '/api/v1/store/banners?placement=SIDEBAR',
      '/api/v1/store/banners?category=not-an-id',
      '/api/v1/store/banners?sort[$ne]=1',
    ]) {
      const response = await request(app).get(path);
      assert.equal(response.status, 400, path);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR', path);
    }
    /* ------------ §62 nothing internal reaches any public payload */
    const payloads: Array<[string, string, unknown]> = [];
    for (const path of PUBLIC_PATHS) {
      const response = await request(app).get(path);
      assert.equal(response.status, 200, path);
      payloads.push([path, JSON.stringify(response.body), response.body]);
    }
    /* Values and field names of records that really exist in this database. */
    const forbidden = [
      'supplierCost',
      'supplierSku',
      'supplierStock',
      'supplierSuggestedRetailPrice',
      'Karachi Wholesale Traders',
      'KWT-INTERNAL',
      'SUP-SKU-4237',
      'OEM Handset',
      'Wholesale Markup Rule',
      'markupType',
      'markupValue',
      'IMP-INTERNAL-0001',
      'jobNumber',
      'supplier-feed.csv',
      'costPrice',
      'sourceType',
      'SUPPLIER_CSV',
      'fulfillmentType',
      'DROPSHIP',
      'sellingPriceOverridden',
      'createdBy',
      'updatedBy',
      'publishedBy',
      'ops-secret-admin@mansoorikart.test',
      'lowStockThreshold',
      'orderPrefix',
      'taxNumber',
      'businessEmail',
      'businessPhone',
      'v1-test-secret',
      'JWT_SECRET',
      'MONGO_URI',
      'Unreleased Handset',
      'unreleased-handset',
      'Discontinued Handset',
      'Unpublished Terms',
      'unpublished-terms',
      'old-refunds',
      'Internal draft question',
      'Retired question',
      'Retired Gadgets',
      '_id',
      '__v',
    ];
    /**
     * The internal money values of those same records: `supplierCost` and `costPrice`. These are
     * checked against the parsed payload instead of the raw JSON text, because a short digit run
     * such as `4237` also occurs by chance inside the 24-character hex ids the storefront
     * legitimately publishes, which made a raw substring scan fail at random. Matching parsed
     * values covers a leak as a number, as a string, and as part of a formatted string, and the
     * only shape exempted is a bare ObjectId, which cannot be a money value.
     */
    const forbiddenValues = [4237, 987654];
    for (const [path, body, parsed] of payloads) {
      for (const token of forbidden) assert.ok(!body.includes(token), `${path} exposed ${token}`);
      const values = jsonValues(parsed);
      for (const value of forbiddenValues) {
        const leaked = values.some(entry => entry === value || (typeof entry === 'string' && !HEX_ID.test(entry) && entry.includes(String(value))));
        assert.ok(!leaked, `${path} exposed ${value}`);
      }
      const lower = body.toLowerCase();
      for (const token of [
        'secret',
        'password',
        'apikey',
        'api_key',
        'credential',
        'bearer',
        'jwt',
        'mongodb://',
        'process.env',
        'pricingrule',
        'catalogimport',
        'auditlog',
        'stacktrace',
        'smtp',
      ])
        assert.ok(!lower.includes(token), `${path} exposed ${token}`);
    }
    /* The withheld records are still there — the absence above is suppression, not emptiness. */
    assert.equal(await Product.countDocuments({ status: 'DRAFT', sourceType: 'SUPPLIER_CSV' }), 1);
    assert.equal(await SupplierCatalogItem.countDocuments({ supplierCost: 4237 }), 1);
    assert.equal(await PricingRule.countDocuments(), 1);
    assert.equal(await CatalogImportJob.countDocuments(), 1);
    assert.equal(await CmsPage.countDocuments({ status: { $ne: 'PUBLISHED' } }), 2);
    assert.equal(await HomepageConfiguration.countDocuments(), 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
/**
 * A curated layout, deliberately stored out of order and containing references an operator
 * is allowed to make but a customer must not see. Ordering, enablement and the visibility
 * window are all resolved on the server: none of them is a query parameter (§12–13, §70).
 */
test('a curated homepage honours operator ordering and server-side visibility', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Product.init(), Category.init(), Promotion.init(), Banner.init(), HomepageConfiguration.init()]);
    const now = Date.now();
    const past = new Date(now - 7 * 86_400_000);
    const future = new Date(now + 7 * 86_400_000);
    const category = await Category.create({ name: 'Laptops', slug: 'laptops', status: 'ACTIVE' });
    const shared = { description: 'A laptop for work.', category: 'Laptops', image: 'https://cdn.mansoorikart.test/l.jpg' };
    const first = await Product.create({ ...shared, name: 'Vostro 15', slug: 'vostro-15', sku: 'MK-V15', price: 189999, stock: 3, status: 'ACTIVE' });
    const second = await Product.create({ ...shared, name: 'Latitude 5450', slug: 'latitude-5450', sku: 'MK-L54', price: 289999, stock: 2, status: 'ACTIVE' });
    const hidden = await Product.create({ ...shared, name: 'Prototype 9', slug: 'prototype-9', sku: 'MK-P9', price: 99999, stock: 1, status: 'DRAFT' });
    /**
     * Creation order is not a reliable clock at millisecond resolution, so it is stated.
     * The timestamps plugin treats `createdAt` as immutable and strips it from a Mongoose
     * update, so the backdating goes through the driver directly.
     */
    await Product.collection.updateOne({ _id: first._id }, { $set: { createdAt: new Date(now - 3 * 86_400_000) } });
    await Product.collection.updateOne({ _id: hidden._id }, { $set: { createdAt: new Date(now - 2 * 86_400_000) } });
    await Product.collection.updateOne({ _id: second._id }, { $set: { createdAt: new Date(now - 86_400_000) } });

    const promotion = await Promotion.create({
      name: 'Eid Sale',
      slug: 'eid-sale',
      headline: 'Save on laptops this week',
      badgeText: 'EID',
      couponCode: 'EID10',
      status: 'ACTIVE',
      startAt: past,
      endAt: future,
      priority: 50,
      linkType: 'INTERNAL_PATH',
      linkPath: '/shop',
    });
    await Promotion.create({ name: 'Winter Sale', slug: 'winter-sale', status: 'SCHEDULED', startAt: future, priority: 90 });
    await Promotion.create({ name: 'Summer Sale', slug: 'summer-sale', status: 'ACTIVE', startAt: new Date(now - 30 * 86_400_000), endAt: past, priority: 99 });
    await Promotion.create({ name: 'Unannounced Plan', slug: 'unannounced-plan', status: 'DRAFT', priority: 100 });
    await Promotion.create({ name: 'Retired Campaign', slug: 'retired-campaign', status: 'ARCHIVED', priority: 100 });
    const image = 'https://cdn.mansoorikart.test/banner.jpg';
    await Banner.create({
      title: 'Eid Hero',
      subtitle: 'Ends soon',
      placement: 'HOME_HERO',
      imageUrl: image,
      status: 'ACTIVE',
      startAt: past,
      endAt: future,
      priority: 20,
      linkType: 'PROMOTION',
      linkPromotion: promotion._id,
    });
    /* Points at a DRAFT product on purpose: the link must degrade rather than 404. */
    await Banner.create({
      title: 'Evergreen Hero',
      placement: 'HOME_HERO',
      imageUrl: image,
      status: 'ACTIVE',
      priority: 5,
      linkType: 'PRODUCT',
      linkProduct: hidden._id,
    });
    await Banner.create({ title: 'Future Hero', placement: 'HOME_HERO', imageUrl: image, status: 'ACTIVE', startAt: future, priority: 99 });
    await Banner.create({ title: 'Expired Hero', placement: 'HOME_HERO', imageUrl: image, status: 'ACTIVE', endAt: past, priority: 98 });
    await Banner.create({ title: 'Draft Hero', placement: 'HOME_HERO', imageUrl: image, status: 'DRAFT', priority: 97 });
    await Banner.create({ title: 'Archived Hero', placement: 'HOME_HERO', imageUrl: image, status: 'ARCHIVED', priority: 96 });
    await Banner.create({
      title: 'Promo Strip',
      placement: 'HOME_PROMO',
      imageUrl: image,
      status: 'ACTIVE',
      priority: 10,
      linkType: 'EXTERNAL_URL',
      linkUrl: 'https://partner.mansoorikart.test/deal',
    });
    await Banner.create({
      title: 'Laptop Hero',
      placement: 'CATEGORY_HERO',
      category: category._id,
      imageUrl: image,
      status: 'ACTIVE',
      linkType: 'CATEGORY',
      linkCategory: category._id,
    });

    await HomepageConfiguration.create({
      key: 'HOME',
      sections: [
        { key: 'arrivals', type: 'NEW_ARRIVALS', title: 'Fresh in', position: 30, settings: { limit: 1 } },
        { key: 'top-hero', type: 'HERO', position: 5, settings: { placement: 'HOME_HERO', limit: 2 } },
        { key: 'off-air', type: 'FEATURED_PRODUCTS', title: 'Hidden rail', enabled: false, position: 10, settings: { products: [first._id] } },
        { key: 'curated', type: 'FEATURED_PRODUCTS', title: 'Editor picks', position: 20, settings: { products: [hidden._id, second._id, first._id] } },
        { key: 'campaign', type: 'PROMOTION', position: 40, settings: { promotion: promotion._id } },
        { key: 'strip', type: 'BANNER', position: 50, settings: { placement: 'HOME_PROMO', limit: 2 } },
        { key: 'shop-cats', type: 'FEATURED_CATEGORIES', title: 'Departments', position: 60, settings: { categories: [category._id] } },
        {
          key: 'promises',
          type: 'TRUST_FEATURES',
          position: 70,
          settings: {
            features: [
              { icon: 'COD', title: 'Cash on delivery' },
              { icon: 'RETURNS', title: 'Easy returns', subtitle: 'Seven days' },
            ],
          },
        },
      ],
    });

    /* ------------ §12, §70 stored order is irrelevant; `position` and `enabled` decide */
    let r = await request(app).get('/api/v1/store/home');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.sections.map((entry: any) => entry.key),
      ['top-hero', 'curated', 'arrivals', 'campaign', 'strip', 'shop-cats', 'promises']
    );
    const [hero, curated, arrivals, campaign, strip, cats, promises] = r.body.data.sections;
    /* ------------ §10, §70 banners outside their window, or not ACTIVE, are simply absent */
    assert.deepEqual(
      hero.banners.map((banner: any) => banner.title),
      ['Eid Hero', 'Evergreen Hero']
    );
    assert.deepEqual(Object.keys(hero.banners[0]).sort(), [
      'altText',
      'ctaLabel',
      'id',
      'imageUrl',
      'link',
      'mobileImageUrl',
      'placement',
      'subtitle',
      'title',
    ]);
    assert.equal(hero.banners[0].altText, 'Eid Hero');
    assert.deepEqual(hero.banners[0].link, { type: 'PROMOTION', slug: 'eid-sale' });
    /* §11 an unpublishable target degrades to NONE instead of leaking that it exists. */
    assert.deepEqual(hero.banners[1].link, { type: 'NONE' });

    /* ------------ §13, §63 curated order is preserved and the DRAFT reference drops out */
    assert.deepEqual(
      curated.products.map((product: any) => product.slug),
      ['latitude-5450', 'vostro-15']
    );
    assert.equal(curated.title, 'Editor picks');
    assert.equal(arrivals.products.length, 1);
    assert.equal(arrivals.products[0].slug, 'latitude-5450');

    /* ------------ §8 the promotion payload publishes no scheduling internals */
    assert.deepEqual(Object.keys(campaign.promotion).sort(), [
      'badgeText',
      'couponCode',
      'description',
      'endsAt',
      'headline',
      'id',
      'imageUrl',
      'link',
      'name',
      'slug',
    ]);
    assert.equal(campaign.promotion.slug, 'eid-sale');
    assert.equal(campaign.promotion.couponCode, 'EID10');
    assert.equal(campaign.promotion.endsAt, future.toISOString());
    assert.deepEqual(campaign.promotion.link, { type: 'INTERNAL_PATH', path: '/shop' });
    assert.deepEqual(
      strip.banners.map((banner: any) => banner.title),
      ['Promo Strip']
    );
    assert.deepEqual(strip.banners[0].link, { type: 'EXTERNAL_URL', url: 'https://partner.mansoorikart.test/deal' });
    assert.deepEqual(
      cats.categories.map((entry: any) => entry.slug),
      ['laptops']
    );
    assert.deepEqual(promises.features, [
      { icon: 'COD', title: 'Cash on delivery', subtitle: null },
      { icon: 'RETURNS', title: 'Easy returns', subtitle: 'Seven days' },
    ]);
    const home = JSON.stringify(r.body);
    for (const token of [
      'prototype-9',
      'Prototype 9',
      'Hidden rail',
      'Future Hero',
      'Expired Hero',
      'Draft Hero',
      'Archived Hero',
      'Winter Sale',
      'Summer Sale',
      'Unannounced Plan',
      'Retired Campaign',
      'priority',
      'startAt',
      'status',
    ])
      assert.ok(!home.includes(token), token);
    /* ------------ §8, §11 the standalone promotion and banner feeds apply the same window */
    r = await request(app).get('/api/v1/store/promotions');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.data.map((entry: any) => entry.slug),
      ['eid-sale']
    );
    r = await request(app).get('/api/v1/store/banners');
    assert.deepEqual(
      r.body.data.map((banner: any) => banner.title),
      ['Eid Hero', 'Evergreen Hero']
    );
    r = await request(app).get('/api/v1/store/banners?placement=HOME_PROMO');
    assert.deepEqual(
      r.body.data.map((banner: any) => banner.title),
      ['Promo Strip']
    );
    r = await request(app).get(`/api/v1/store/banners?placement=CATEGORY_HERO&category=${category._id}`);
    assert.deepEqual(
      r.body.data.map((banner: any) => banner.title),
      ['Laptop Hero']
    );
    assert.deepEqual(r.body.data[0].link, { type: 'CATEGORY', categoryId: String(category._id), slug: 'laptops' });
    r = await request(app).get(`/api/v1/store/banners?placement=CATEGORY_HERO&category=${new mongoose.Types.ObjectId()}`);
    assert.deepEqual(r.body.data, []);

    /* ------------ §45, §71 the payload is bounded by the central limits, not by the caller */
    await Promotion.insertMany(
      Array.from({ length: 25 }, (_, index) => ({ name: `Bulk Promo ${index}`, slug: `bulk-promo-${index}`, status: 'ACTIVE', priority: index }))
    );
    r = await request(app).get('/api/v1/store/promotions?limit=100');
    assert.equal(r.body.data.length, CONTENT_LIMITS.maxPublicPromotions);
    await Banner.insertMany(
      Array.from({ length: 20 }, (_, index) => ({ title: `Bulk Banner ${index}`, placement: 'HOME_HERO', imageUrl: image, status: 'ACTIVE', priority: index }))
    );
    r = await request(app).get('/api/v1/store/banners?limit=12');
    assert.equal(r.body.data.length, CONTENT_LIMITS.maxPublicBanners);
    r = await request(app).get('/api/v1/store/home');
    assert.equal(r.body.data.sections[0].banners.length, 2);
    /* Reading the storefront never writes: still exactly one layout, and no new one. */
    assert.equal(await HomepageConfiguration.countDocuments(), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
/**
 * Navigation is the one place where a hidden record would be easiest to leak: a menu entry
 * names its destination. Entries whose target is not publicly available are dropped, so the
 * menu never advertises a DRAFT product, an archived category or an unpublished page (§36–37).
 */
test('public navigation publishes only reachable destinations, in operator order', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Product.init(), Category.init(), CmsPage.init(), NavigationMenu.init()]);
    const category = await Category.create({ name: 'Audio', slug: 'audio', status: 'ACTIVE' });
    const retired = await Category.create({ name: 'Fax Machines', slug: 'fax-machines', status: 'ARCHIVED' });
    const shared = { description: 'Audio gear.', category: 'Audio', image: 'https://cdn.mansoorikart.test/a.jpg' };
    const live = await Product.create({ ...shared, name: 'Studio Buds', slug: 'studio-buds', sku: 'MK-SB', price: 24999, stock: 10, status: 'ACTIVE' });
    const draft = await Product.create({ ...shared, name: 'Unlaunched Buds', slug: 'unlaunched-buds', sku: 'MK-UB', price: 19999, stock: 5, status: 'DRAFT' });
    const published = await CmsPage.create({ title: 'Returns Policy', slug: 'returns-policy', status: 'PUBLISHED', publishedAt: new Date() });
    const unpublished = await CmsPage.create({ title: 'Draft Privacy Policy', slug: 'draft-privacy-policy', status: 'DRAFT' });

    await NavigationMenu.create({
      menu: 'HEADER',
      items: [
        {
          label: 'Deals',
          type: 'INTERNAL_PATH',
          path: '/deals',
          position: 20,
          children: [
            { label: 'Audio deals', type: 'CATEGORY', category: category._id, position: 20 },
            { label: 'Buds', type: 'PRODUCT', product: live._id, position: 10 },
            { label: 'Coming soon', type: 'PRODUCT', product: draft._id, position: 5 },
            { label: 'Old faxes', type: 'CATEGORY', category: retired._id, position: 1 },
          ],
        },
        { label: 'Returns', type: 'CMS_PAGE', page: published._id, position: 10 },
        { label: 'Privacy', type: 'CMS_PAGE', page: unpublished._id, position: 15 },
        { label: 'Prototype', type: 'PRODUCT', product: draft._id, position: 30 },
        { label: 'Hidden', type: 'INTERNAL_PATH', path: '/hidden-staff-page', enabled: false, position: 1 },
        { label: 'Blog', type: 'EXTERNAL_URL', url: 'https://blog.mansoorikart.test/news', position: 40 },
      ],
    });
    /* ------------ §36 both menus are always present; a menu that does not exist is empty */
    let r = await request(app).get('/api/v1/store/navigation');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['footer', 'header']);
    assert.deepEqual(r.body.data.footer, []);
    assert.equal(await NavigationMenu.countDocuments(), 1);

    /* ------------ §37 unreachable entries are dropped, survivors keep operator order */
    assert.deepEqual(
      r.body.data.header.map((item: any) => item.label),
      ['Returns', 'Deals', 'Blog']
    );
    assert.deepEqual(r.body.data.header[0], { label: 'Returns', type: 'CMS_PAGE', slug: 'returns-policy', children: [] });
    assert.deepEqual(r.body.data.header[1], {
      label: 'Deals',
      type: 'INTERNAL_PATH',
      path: '/deals',
      children: [
        { label: 'Buds', type: 'PRODUCT', productId: String(live._id), slug: 'studio-buds' },
        { label: 'Audio deals', type: 'CATEGORY', categoryId: String(category._id), slug: 'audio' },
      ],
    });
    assert.deepEqual(r.body.data.header[2], { label: 'Blog', type: 'EXTERNAL_URL', url: 'https://blog.mansoorikart.test/news', children: [] });
    const body = JSON.stringify(r.body);
    for (const token of [
      'draft-privacy-policy',
      'Draft Privacy Policy',
      'Privacy',
      'unlaunched-buds',
      'Unlaunched Buds',
      'Prototype',
      'Coming soon',
      'fax-machines',
      'Old faxes',
      'hidden-staff-page',
      'position',
      'enabled',
      '_id',
      'createdBy',
    ])
      assert.ok(!body.includes(token), token);

    await NavigationMenu.create({
      menu: 'FOOTER',
      items: [
        { label: 'Shop', type: 'INTERNAL_PATH', path: '/shop', position: 10 },
        { label: 'Shipping', type: 'CMS_PAGE', page: published._id, position: 0 },
      ],
    });
    r = await request(app).get('/api/v1/store/navigation');
    assert.deepEqual(
      r.body.data.footer.map((item: any) => item.label),
      ['Shipping', 'Shop']
    );
    assert.deepEqual(
      r.body.data.header.map((item: any) => item.label),
      ['Returns', 'Deals', 'Blog']
    );
    /* Archiving the page removes it from the menu with no menu edit at all. */
    await CmsPage.updateOne({ _id: published._id }, { $set: { status: 'ARCHIVED' } });
    r = await request(app).get('/api/v1/store/navigation');
    assert.deepEqual(
      r.body.data.header.map((item: any) => item.label),
      ['Deals', 'Blog']
    );
    assert.deepEqual(
      r.body.data.footer.map((item: any) => item.label),
      ['Shop']
    );
    assert.equal(await NavigationMenu.countDocuments(), 2);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
