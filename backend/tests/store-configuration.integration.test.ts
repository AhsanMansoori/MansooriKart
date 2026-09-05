/**
 * Store configuration: one singleton authority, typed sections, and the checkout it governs.
 *
 * Two halves. The first proves the configuration document is a single record with safe
 * Pakistan defaults, that every section is a typed allowlist rather than a key/value bag,
 * that no credential can be written into it, and that maintenance mode closes the
 * storefront without closing health checks or Super-Admin access (§18–25, §33–34, §38, §69).
 *
 * The second proves the settings actually govern checkout — and only future checkouts.
 * Shipping, tax and cash-on-delivery are read from this one authority at checkout time, so
 * an admin change takes effect on the next order with no restart; every order already
 * placed keeps the totals and the invoice it was priced with (§26–32, §65–66, §73).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MAINTENANCE_DEFAULT_MESSAGE } from '../src/config/storefront.js';
import { Address } from '../src/models/address.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Cart } from '../src/models/cart.js';
import { CmsPage } from '../src/models/cmsPage.js';
import { Coupon } from '../src/models/coupon.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { StoreConfiguration } from '../src/models/storeConfiguration.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const memory = () => MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
/** Every settings surface, so the authorization matrix cannot silently miss one. */
const SECTIONS = ['store', 'contact', 'social', 'seo', 'shipping', 'tax', 'invoice', 'email', 'maintenance'] as const;
/** Storefront content endpoints, all of which maintenance mode must close. */
const STOREFRONT = [
  '/api/v1/store/home',
  '/api/v1/store/navigation',
  '/api/v1/store/faqs',
  '/api/v1/store/pages',
  '/api/v1/store/pages/shipping-policy',
  '/api/v1/store/promotions',
  '/api/v1/store/banners',
];

test('store configuration is one typed authority with safe defaults and no credential surface', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([StoreConfiguration.init(), User.init(), CmsPage.init()]);
    const admin = await User.create({
      name: 'Settings Admin',
      email: 'admin@settings.test',
      password: await bcrypt.hash('Sup3r-Admin-Passphrase', 10),
      role: 'SUPER_ADMIN',
    });
    const customer = await User.create({ name: 'Shopper', email: 'shopper@settings.test', password: 'unused', role: 'CUSTOMER' });
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);

    /* ------------ §57, §69 every settings surface is Super-Admin only */
    const anonymousRead = await request(app).get('/api/v1/admin/settings');
    assert.equal(anonymousRead.status, 401);
    assert.equal(anonymousRead.body.error.code, 'AUTH_UNAUTHORIZED');
    const customerRead = await request(app).get('/api/v1/admin/settings').set(auth(ct));
    assert.equal(customerRead.status, 403);
    assert.equal(customerRead.body.error.code, 'AUTH_FORBIDDEN');
    for (const section of SECTIONS) {
      const path = `/api/v1/admin/settings/${section}`;
      const anonymous = await request(app).patch(path).send({ storeName: 'Hijacked' });
      assert.equal(anonymous.status, 401, section);
      assert.equal(anonymous.body.error.code, 'AUTH_UNAUTHORIZED', section);
      const asCustomer = await request(app).patch(path).set(auth(ct)).send({ storeName: 'Hijacked' });
      assert.equal(asCustomer.status, 403, section);
      assert.equal(asCustomer.body.error.code, 'AUTH_FORBIDDEN', section);
    }
    // A refused request never reaches the singleton, so nothing has been created yet.
    assert.equal(await StoreConfiguration.countDocuments(), 0);

    /* ------------ §19 the singleton initialises exactly once under concurrent first reads */
    const raced = await Promise.all([
      request(app).get('/api/v1/admin/settings').set(auth(st)),
      request(app).get('/api/v1/store/config'),
      request(app).get('/api/v1/admin/settings').set(auth(st)),
      request(app).get('/api/v1/store/config'),
    ]);
    for (const response of raced) assert.equal(response.status, 200);
    assert.equal(await StoreConfiguration.countDocuments(), 1);
    assert.equal(await StoreConfiguration.countDocuments({ key: 'STORE' }), 1);

    /* ------------ §18, §20, §29 defaults are Pakistan-shaped and tax starts off */
    let r = await request(app).get('/api/v1/admin/settings').set(auth(st));
    assert.equal(r.body.data.storeName, 'MansooriKart');
    assert.equal(r.body.data.defaultCurrency, 'PKR');
    assert.equal(r.body.data.currencyDisplay, 'SYMBOL');
    assert.equal(r.body.data.timezone, 'Asia/Karachi');
    assert.equal(r.body.data.defaultLocale, 'en-PK');
    assert.equal(r.body.data.orderPrefix, 'MK');
    assert.equal(r.body.data.lowStockThreshold, 5);
    assert.equal(r.body.data.maintenanceMode, false);
    assert.equal(r.body.data.contact.country, 'Pakistan');
    assert.deepEqual(r.body.data.socialLinks, []);
    assert.equal(r.body.data.seo.robots, 'index,follow');
    assert.equal(r.body.data.shipping.enabled, true);
    assert.equal(r.body.data.shipping.standardFee, 250);
    assert.equal(r.body.data.shipping.freeShippingEnabled, true);
    assert.equal(r.body.data.shipping.freeShippingThreshold, 5000);
    assert.equal(r.body.data.shipping.codEnabled, true);
    assert.equal(r.body.data.tax.enabled, false);
    assert.equal(r.body.data.tax.defaultRate, 0);
    assert.equal(r.body.data.tax.pricesIncludeTax, false);
    assert.equal(r.body.data.tax.displayTaxSeparately, true);
    assert.equal(r.body.data.tax.label, 'Tax');
    assert.equal(r.body.data.email.fromName, 'MansooriKart');
    assert.equal(r.body.data.email.orderConfirmationEnabled, true);
    assert.equal(r.body.data.updatedBy, null);

    /* ------------ §43–44 the public projection is an explicit, fixed key list */
    r = await request(app).get('/api/v1/store/config');
    assert.deepEqual(Object.keys(r.body.data), [
      'storeName',
      'legalName',
      'tagline',
      'logoUrl',
      'faviconUrl',
      'currency',
      'timezone',
      'locale',
      'contact',
      'socialLinks',
      'seo',
      'shipping',
      'tax',
      'maintenance',
    ]);
    assert.deepEqual(r.body.data.currency, { code: 'PKR', display: 'SYMBOL' });
    assert.equal(r.body.data.timezone, 'Asia/Karachi');
    assert.equal(r.body.data.locale, 'en-PK');
    assert.deepEqual(r.body.data.maintenance, { enabled: false, message: MAINTENANCE_DEFAULT_MESSAGE });
    assert.deepEqual(Object.keys(r.body.data.tax), ['enabled', 'label', 'displayTaxSeparately', 'pricesIncludeTax']);
    assert.deepEqual(Object.keys(r.body.data.shipping), [
      'enabled',
      'standardFee',
      'freeShippingEnabled',
      'freeShippingThreshold',
      'codEnabled',
      'deliveryEstimate',
    ]);

    /* ------------ §21, §51 contact settings are typed, and nothing else is accepted */
    for (const body of [
      { supportEmail: 'not-an-email' },
      { supportEmail: 'ops@mansoorikart.test\r\nBcc: attacker@evil.test' },
      { supportPhone: 'call me maybe' },
      { whatsapp: '+92 300 1234567; rm -rf /' },
      { businessEmail: 'also-not-an-email' },
      { postalCode: '!!' },
      { postalCode: '<script>' },
      { country: 'x'.repeat(300) },
      { supportHours: 'x'.repeat(700) },
      { supportEmail: 'ops@mansoorikart.test', unknownField: 'x' },
      { contact: { supportEmail: 'ops@mansoorikart.test' } },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/contact').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
    // Markup-only free text sanitises to nothing, which is not a value: no write, no audit.
    r = await request(app).patch('/api/v1/admin/settings/contact').set(auth(st)).send({ city: '<script>alert(1)</script>' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.contact.city, undefined);
    assert.equal(await AuditLog.countDocuments(), 0);

    r = await request(app).patch('/api/v1/admin/settings/contact').set(auth(st)).send({
      supportEmail: 'Support@MansooriKart.test',
      supportPhone: '+92 21 111 222 333',
      businessEmail: 'accounts@mansoorikart.test',
      businessPhone: '+92 21 999 888 777',
      whatsapp: '+92 300 1234567',
      addressLine1: 'Plot 12, <b>Shahrah-e-Faisal</b>',
      city: 'Karachi',
      stateProvince: 'Sindh',
      postalCode: '75400',
      supportHours: 'Mon-Sat, 9am-8pm PKT',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.contact.supportEmail, 'support@mansoorikart.test');
    assert.equal(r.body.data.contact.addressLine1, 'Plot 12, Shahrah-e-Faisal');
    assert.equal(r.body.data.updatedBy, String(admin._id));
    const contactAudit: any = await AuditLog.findOne({ action: 'SETTINGS_UPDATED' }).lean();
    assert.equal(contactAudit.resourceType, 'StoreConfiguration');
    assert.equal(contactAudit.resourceId, 'STORE');
    assert.equal(contactAudit.metadata.section, 'contact');
    assert.ok(contactAudit.metadata.fields.includes('supportEmail'));
    assert.ok(contactAudit.requestId);
    // §59 re-submitting the same values changes nothing, so it is not a second decision.
    assert.equal(
      (await request(app).patch('/api/v1/admin/settings/contact').set(auth(st)).send({ supportEmail: 'support@mansoorikart.test', city: 'Karachi' })).status,
      200
    );
    assert.equal(await AuditLog.countDocuments({ action: 'SETTINGS_UPDATED' }), 1);

    /* ------------ §44 the storefront sees support contacts, never back-office ones */
    r = await request(app).get('/api/v1/store/config');
    assert.equal(r.body.data.contact.supportEmail, 'support@mansoorikart.test');
    assert.equal(r.body.data.contact.city, 'Karachi');
    for (const key of ['businessEmail', 'businessPhone']) assert.ok(!(key in r.body.data.contact), key);
    for (const key of ['invoice', 'email', 'lowStockThreshold', 'orderPrefix', 'updatedBy', 'createdAt', 'updatedAt', 'key', '_id', 'id'])
      assert.ok(!(key in r.body.data), key);
    for (const value of ['accounts@mansoorikart.test', '+92 21 999 888 777']) assert.ok(!JSON.stringify(r.body).includes(value), value);

    /* ------------ §22–23, §68 social links are channel-keyed and scheme-checked */
    for (const body of [
      { links: [{ channel: 'FACEBOOK', url: 'javascript:alert(1)' }] },
      { links: [{ channel: 'FACEBOOK', url: 'data:text/html,<script>alert(1)</script>' }] },
      { links: [{ channel: 'FACEBOOK', url: 'file:///etc/passwd' }] },
      { links: [{ channel: 'FACEBOOK', url: 'vbscript:msgbox(1)' }] },
      { links: [{ channel: 'FACEBOOK', url: '//evil.test/mansoorikart' }] },
      { links: [{ channel: 'FACEBOOK', url: 'facebook.test/mansoorikart' }] },
      { links: [{ channel: 'FACEBOOK', url: 'https://' }] },
      { links: [{ channel: 'MYSPACE', url: 'https://myspace.test/mansoorikart' }] },
      {
        links: [
          { channel: 'FACEBOOK', url: 'https://facebook.test/a' },
          { channel: 'FACEBOOK', url: 'https://facebook.test/b' },
        ],
      },
      { links: [{ channel: 'FACEBOOK', url: 'https://facebook.test/a', extra: 1 }] },
      { links: Array.from({ length: 7 }, (_, index) => ({ channel: 'FACEBOOK', url: `https://facebook.test/${index}` })) },
      { socialLinks: [{ channel: 'FACEBOOK', url: 'https://facebook.test/a' }] },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/social').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
    r = await request(app)
      .patch('/api/v1/admin/settings/social')
      .set(auth(st))
      .send({
        links: [
          { channel: 'FACEBOOK', url: 'https://facebook.test/mansoorikart' },
          { channel: 'INSTAGRAM', url: 'HTTPS://Instagram.test/MansooriKart' },
          { channel: 'TIKTOK', url: 'https://tiktok.test/@mansoorikart', enabled: false },
        ],
      });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.socialLinks.length, 3);
    // The host is normalised, the path is left alone, and the scheme is guaranteed.
    assert.equal(r.body.data.socialLinks[1].url, 'https://instagram.test/MansooriKart');
    // §44 a channel an operator has switched off is simply not published.
    r = await request(app).get('/api/v1/store/config');
    assert.deepEqual(r.body.data.socialLinks, [
      { channel: 'FACEBOOK', url: 'https://facebook.test/mansoorikart' },
      { channel: 'INSTAGRAM', url: 'https://instagram.test/MansooriKart' },
    ]);

    /* ------------ §24–25, §67–68 SEO metadata is enum-controlled and single-line */
    for (const body of [
      { robots: 'noindex, nofollow' },
      { robots: 'index,follow\nX-Injected: 1' },
      { robots: 'ALL' },
      { canonicalUrl: 'javascript:alert(1)' },
      { canonicalUrl: '/relative/path' },
      { canonicalUrl: 'ftp://mansoorikart.test' },
      { socialImageUrl: 'data:image/svg+xml,<svg onload=alert(1)>' },
      { twitterHandle: 'not a handle!' },
      { twitterHandle: '@sixteencharacter' },
      { metaKeywords: Array.from({ length: 31 }, (_, index) => `keyword-${index}`) },
      { metaKeywords: 'electronics' },
      { metaTitle: 'x'.repeat(500) },
      { openGraphTitle: 'MansooriKart', unknownField: 1 },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/seo').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
    r = await request(app)
      .patch('/api/v1/admin/settings/seo')
      .set(auth(st))
      .send({
        metaTitle: 'MansooriKart — <b>Online</b> Shopping in Pakistan',
        metaDescription: 'Shop electronics &lt;safely&gt; across Pakistan.',
        metaKeywords: ['electronics', 'karachi'],
        canonicalUrl: 'https://mansoorikart.test',
        robots: 'index,follow',
        socialImageUrl: 'https://cdn.mansoorikart.test/og.png',
        openGraphTitle: 'MansooriKart',
        twitterHandle: '@mansoorikart',
      });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.seo.metaTitle, 'MansooriKart — Online Shopping in Pakistan');
    assert.equal(r.body.data.seo.metaDescription, 'Shop electronics safely across Pakistan.');
    assert.equal(r.body.data.seo.canonicalUrl, 'https://mansoorikart.test/');
    // Markup-only metadata sanitises to nothing, so it is not a value and is not stored.
    r = await request(app).patch('/api/v1/admin/settings/seo').set(auth(st)).send({ metaTitle: '<script>alert(1)</script>' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.seo.metaTitle, 'MansooriKart — Online Shopping in Pakistan');
    r = await request(app).get('/api/v1/store/config');
    assert.deepEqual(Object.keys(r.body.data.seo), [
      'metaTitle',
      'metaDescription',
      'metaKeywords',
      'canonicalUrl',
      'robots',
      'socialImageUrl',
      'openGraph',
      'twitterHandle',
    ]);
    assert.deepEqual(r.body.data.seo.openGraph, {
      title: 'MansooriKart',
      description: 'Shop electronics safely across Pakistan.',
      image: 'https://cdn.mansoorikart.test/og.png',
    });
    assert.equal(r.body.data.seo.robots, 'index,follow');
    // §25 a CR or LF cannot survive into a rendered tag or a response header.
    r = await request(app).patch('/api/v1/admin/settings/seo').set(auth(st)).send({ metaTitle: 'MansooriKart\r\nX-Evil: injected' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.seo.metaTitle, 'MansooriKart X-Evil: injected');
    assert.equal(r.headers['x-evil'], undefined);
    r = await request(app).get('/api/v1/store/config');
    assert.ok(!/[\r\n]/.test(r.body.data.seo.metaTitle));
    assert.equal(r.headers['x-evil'], undefined);
    await request(app).patch('/api/v1/admin/settings/seo').set(auth(st)).send({ metaTitle: 'MansooriKart — Online Shopping in Pakistan' });

    /* ------------ §29–30 the tax section is a foundation, not a jurisdiction engine */
    for (const body of [
      { defaultRate: -1 },
      { defaultRate: 101 },
      { enabled: 'yes' },
      { label: '<script>alert(1)</script>' },
      { taxNumber: 'NTN 123/456' },
      { taxNumber: 'ab' },
      { rate: 17 },
      { jurisdiction: 'Sindh' },
      { rules: [{ province: 'Sindh', rate: 15 }] },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/tax').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }

    /* ------------ §31–32 the invoice section is presentation, never figures */
    for (const body of [
      { showLogo: 'yes' },
      { footerNote: 'x'.repeat(5_000) },
      { total: 0 },
      { subtotal: 0 },
      { invoiceNumber: 'INV-OVERRIDE' },
      { taxNumber: '123456' },
      { template: '<html><script>alert(1)</script></html>' },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/invoice').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }

    /* ------------ §33 no credential can be written into the database through settings */
    for (const body of [
      { smtpHost: 'smtp.mansoorikart.test' },
      { smtpPort: 587 },
      { smtpUser: 'postmaster@mansoorikart.test' },
      { smtpPassword: 'not-a-real-password' },
      { password: 'not-a-real-password' },
      { apiKey: 'not-a-real-key' },
      { providerApiKey: 'not-a-real-key' },
      { transport: { host: 'smtp.mansoorikart.test', auth: { user: 'a', pass: 'b' } } },
      { credentials: { user: 'a', pass: 'b' } },
      { fromName: 'MansooriKart', smtpPassword: 'not-a-real-password' },
      { template: '{{#each order.items}}{{this}}{{/each}}' },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/email').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }
    // §34 behaviour flags and plain-text branding are accepted; there is no template field.
    r = await request(app).patch('/api/v1/admin/settings/email').set(auth(st)).send({
      fromName: 'MansooriKart Orders',
      replyTo: 'Orders@MansooriKart.test',
      supportEmail: 'support@mansoorikart.test',
      brandingHeadline: 'Thanks for shopping with <b>MansooriKart</b>',
      brandingFooter: 'You are receiving this because you placed an order.',
      orderConfirmationEnabled: true,
      shippingUpdateEnabled: false,
      deliveryEmailEnabled: true,
      includeInvoiceLink: false,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.email.replyTo, 'orders@mansoorikart.test');
    assert.equal(r.body.data.email.brandingHeadline, 'Thanks for shopping with MansooriKart');
    assert.equal(r.body.data.email.shippingUpdateEnabled, false);
    // The stored document itself carries no credential-shaped key or value anywhere.
    const persisted = JSON.stringify(await StoreConfiguration.findOne({ key: 'STORE' }).lean()).toLowerCase();
    for (const forbidden of ['smtp', 'password', 'apikey', 'api_key', 'secret', 'privatekey', 'credential', 'mongodb://', 'jwt', 'bearer'])
      assert.ok(!persisted.includes(forbidden), forbidden);

    /* ------------ §52, §69 internal and system fields cannot be mass-assigned */
    for (const body of [
      { _id: String(admin._id) },
      { __v: 5 },
      { key: 'OTHER' },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { updatedAt: '2020-01-01T00:00:00.000Z' },
      { updatedBy: String(customer._id) },
      { maintenanceMode: true },
      { shipping: { standardFee: 0 } },
      { tax: { enabled: true } },
      { socialLinks: [] },
      { defaultCurrency: 'PKR', unknownField: 1 },
      { defaultCurrency: 'PKRR' },
      { orderPrefix: 'mk-2026' },
      { lowStockThreshold: -1 },
      { lowStockThreshold: 10_001 },
      { timezone: 'Mars/Olympus' },
      { defaultLocale: 'fr-FR' },
      { currencyDisplay: 'EMOJI' },
      { logoUrl: 'javascript:alert(1)' },
      { storeName: '<script>alert(1)</script>' },
    ]) {
      const rejected = await request(app).patch('/api/v1/admin/settings/store').set(auth(st)).send(body);
      assert.equal(rejected.status, 400, JSON.stringify(body));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    }

    /* ------------ §18, §20 the currency relabels and the timezone is display-only */
    const page = await CmsPage.create({
      title: 'Shipping Policy',
      slug: 'shipping-policy',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-01-05T10:00:00.000Z'),
      blocks: [{ type: 'PARAGRAPH', text: 'We deliver across Pakistan.' }],
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    const before: any = await StoreConfiguration.findOne({ key: 'STORE' }).lean();
    r = await request(app).patch('/api/v1/admin/settings/store').set(auth(st)).send({
      storeName: 'MansooriKart PK',
      defaultCurrency: 'usd',
      currencyDisplay: 'CODE',
      timezone: 'Asia/Dubai',
      legalName: 'MansooriKart (Private) Limited',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.storeName, 'MansooriKart PK');
    assert.equal(r.body.data.defaultCurrency, 'USD');
    assert.equal(r.body.data.timezone, 'Asia/Dubai');
    const after: any = await StoreConfiguration.findOne({ key: 'STORE' }).lean();
    // Relabelling the currency moves no stored amount: there is no conversion layer.
    assert.deepEqual(after.shipping, before.shipping);
    assert.deepEqual(after.tax, before.tax);
    assert.equal(new Date(after.createdAt).toISOString(), new Date(before.createdAt).toISOString());
    // A record written before the change keeps the instant it was written at.
    const reread: any = await CmsPage.findById(page._id).lean();
    assert.equal(new Date(reread.createdAt).toISOString(), new Date((page as any).createdAt).toISOString());
    assert.equal(new Date(reread.publishedAt).toISOString(), '2026-01-05T10:00:00.000Z');
    r = await request(app).get('/api/v1/store/config');
    assert.deepEqual(r.body.data.currency, { code: 'USD', display: 'CODE' });
    await request(app)
      .patch('/api/v1/admin/settings/store')
      .set(auth(st))
      .send({ storeName: 'MansooriKart', defaultCurrency: 'PKR', currencyDisplay: 'SYMBOL', timezone: 'Asia/Karachi' });
    assert.equal((await request(app).get('/api/v1/store/config')).body.data.currency.code, 'PKR');

    /* ------------ §38 maintenance mode closes storefront content and nothing else */
    r = await request(app)
      .patch('/api/v1/admin/settings/maintenance')
      .set(auth(st))
      .send({ maintenanceMode: true, maintenanceMessage: 'We are restocking. Back at 6pm PKT.' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.maintenanceMode, true);
    assert.equal(await AuditLog.countDocuments({ action: 'MAINTENANCE_MODE_ENABLED' }), 1);
    for (const path of STOREFRONT) {
      const closed = await request(app).get(path);
      assert.equal(closed.status, 503, path);
      assert.equal(closed.body.error.code, 'STORE_MAINTENANCE', path);
      assert.equal(closed.body.error.message, 'We are restocking. Back at 6pm PKT.', path);
      // The notice is the whole body: no diagnostics, no stack, no internals.
      assert.deepEqual(Object.keys(closed.body.error).sort(), ['code', 'message']);
      assert.ok(!JSON.stringify(closed.body).toLowerCase().includes('stack'), path);
    }
    // The shell still renders, so a customer sees a branded notice rather than a dead site.
    r = await request(app).get('/api/v1/store/config');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.maintenance, { enabled: true, message: 'We are restocking. Back at 6pm PKT.' });
    // §38–39 health checks stay open, so a load balancer keeps seeing the truth.
    assert.deepEqual((await request(app).get('/health')).body, { status: 'ok' });
    assert.equal((await request(app).get('/api/v1/health')).body.data.status, 'ok');
    // §38 Super-Admin authentication and administration keep working during maintenance.
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@settings.test', password: 'Sup3r-Admin-Passphrase' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.data.user.role, 'SUPER_ADMIN');
    assert.equal((await request(app).get('/api/v1/admin/settings').set(auth(login.body.data.token))).status, 200);
    r = await request(app).get('/api/v1/admin/system/health').set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.store.maintenanceMode, true);

    r = await request(app).patch('/api/v1/admin/settings/maintenance').set(auth(st)).send({ maintenanceMode: false });
    assert.equal(r.status, 200);
    assert.equal(await AuditLog.countDocuments({ action: 'MAINTENANCE_MODE_DISABLED' }), 1);
    // §59 re-issuing the same state is not a second decision.
    assert.equal((await request(app).patch('/api/v1/admin/settings/maintenance').set(auth(st)).send({ maintenanceMode: false })).status, 200);
    assert.equal(await AuditLog.countDocuments({ action: 'MAINTENANCE_MODE_DISABLED' }), 1);
    for (const path of STOREFRONT) assert.equal((await request(app).get(path)).status, 200, path);

    /* ------------ §58–59 every settings decision is attributed, and only decisions are */
    const settingsAudits: any[] = await AuditLog.find({ action: 'SETTINGS_UPDATED' }).lean();
    assert.deepEqual([...new Set(settingsAudits.map(entry => entry.metadata.section))].sort(), ['contact', 'email', 'seo', 'social', 'store']);
    for (const entry of await AuditLog.find().lean()) {
      assert.equal(String((entry as any).actor), String(admin._id));
      assert.equal((entry as any).resourceType, 'StoreConfiguration');
      assert.equal((entry as any).resourceId, 'STORE');
      assert.ok(Array.isArray((entry as any).metadata.fields));
    }
    assert.equal(await StoreConfiguration.countDocuments(), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test('shipping, tax and cash-on-delivery settings govern checkout without rewriting history', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([StoreConfiguration.init(), User.init(), Product.init(), Order.init(), Coupon.init()]);
    const admin = await User.create({ name: 'Ops', email: 'ops@checkout-config.test', password: 'unused', role: 'SUPER_ADMIN' });
    const buyer = await User.create({ name: 'Buyer', email: 'buyer@checkout-config.test', password: 'unused', role: 'CUSTOMER' });
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const ct = jwt.sign({ sub: String(buyer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const karachi = await Address.create({
      user: buyer._id,
      fullName: 'Buyer',
      phone: '+92 300 1234567',
      addressLine1: 'Plot 1',
      city: 'Karachi',
      country: 'PK',
    });
    const lahore = await Address.create({
      user: buyer._id,
      fullName: 'Buyer',
      phone: '+92 300 1234567',
      addressLine1: 'Plot 2',
      city: 'Lahore',
      country: 'PK',
    });
    const product = async (name: string, price: number) =>
      Product.create({
        name,
        description: `${name} description`,
        price,
        category: 'audio',
        image: 'https://cdn.mansoorikart.test/p.png',
        stock: 60,
        status: 'ACTIVE',
      });
    const cheap = await product('Wireless Earbuds', 1_000);
    const mid = await product('Bluetooth Speaker', 4_999);
    const dear = await product('Gaming Console', 5_000);
    /** One checkout against a freshly seeded cart, so each case is independent. */
    const buy = async (item: any, quantity: number, address: any, key: string, extra: Record<string, unknown> = {}) => {
      await Cart.deleteMany({ user: buyer._id });
      await Cart.create({ user: buyer._id, items: [{ product: item._id, quantity }] });
      return request(app)
        .post('/api/v1/checkout')
        .set(auth(ct))
        .set('Idempotency-Key', key)
        .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY', ...extra });
    };
    const settings = (section: string, body: Record<string, unknown>) => request(app).patch(`/api/v1/admin/settings/${section}`).set(auth(st)).send(body);

    /* ------------ §26–27, §29 an unconfigured store charges exactly what it charged before */
    let r = await buy(cheap, 1, karachi, 'cfg-historical-order');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const historical = r.body.data;
    assert.equal(historical.subtotal, 1_000);
    assert.equal(historical.discount, 0);
    assert.equal(historical.shipping, 250);
    assert.equal(historical.tax, 0);
    assert.equal(historical.total, 1_250);
    assert.equal(historical.currency, 'PKR');
    assert.equal(historical.paymentMethod, 'CASH_ON_DELIVERY');

    /* ------------ §63 the free-shipping threshold is a boundary, tested on both sides */
    r = await buy(mid, 1, karachi, 'cfg-below-threshold');
    assert.equal(r.body.data.shipping, 250);
    assert.equal(r.body.data.total, 5_249);
    r = await buy(dear, 1, karachi, 'cfg-at-threshold');
    assert.equal(r.body.data.shipping, 0);
    assert.equal(r.body.data.total, 5_000);

    /* ------------ §28, §30 a client cannot supply shipping, tax or any total */
    const ordersBeforeInjection = await Order.countDocuments();
    for (const extra of [
      { shipping: 0 },
      { tax: 0 },
      { total: 1 },
      { subtotal: 1 },
      { discount: 500 },
      { shippingFee: 0 },
      { freeShipping: true },
      { taxRate: 0 },
    ]) {
      const rejected = await buy(cheap, 1, karachi, 'cfg-injection-attempt', extra);
      assert.equal(rejected.status, 400, JSON.stringify(extra));
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', JSON.stringify(extra));
    }
    assert.equal(await Order.countDocuments(), ordersBeforeInjection);

    /* ------------ §27 an admin change takes effect on the next order, with no restart */
    assert.equal(
      (
        await settings('shipping', {
          standardFee: 400,
          freeShippingThreshold: 10_000,
          cityOverrides: [{ city: 'Lahore', fee: 700 }],
          deliveryEstimate: '2-4 working days',
        })
      ).status,
      200
    );
    assert.equal((await request(app).get('/api/v1/store/config')).body.data.shipping.standardFee, 400);
    r = await buy(dear, 1, karachi, 'cfg-new-standard-fee');
    assert.equal(r.body.data.shipping, 400);
    assert.equal(r.body.data.total, 5_400);
    // A city override applies where the threshold has not been met…
    r = await buy(cheap, 1, lahore, 'cfg-city-override');
    assert.equal(r.body.data.shipping, 700);
    assert.equal(r.body.data.total, 1_700);
    // …and free shipping still wins over it once the order is large enough.
    r = await buy(dear, 2, lahore, 'cfg-threshold-beats-override');
    assert.equal(r.body.data.subtotal, 10_000);
    assert.equal(r.body.data.shipping, 0);
    assert.equal(r.body.data.total, 10_000);
    assert.equal(r.body.data.tax, 0);

    /* ------------ §29–30 tax is off until an admin turns it on, then server-computed */
    assert.equal((await settings('tax', { enabled: true, defaultRate: 10, label: 'GST' })).status, 200);
    r = await buy(cheap, 1, karachi, 'cfg-tax-enabled');
    assert.equal(r.body.data.subtotal, 1_000);
    assert.equal(r.body.data.shipping, 400);
    // Ten per cent of the discounted subtotal; delivery is not taxed.
    assert.equal(r.body.data.tax, 100);
    assert.equal(r.body.data.total, 1_500);
    const taxedOrderId = r.body.data._id;
    // Tax follows the discount, so a coupon reduces the taxable base rather than the tax rate.
    await Coupon.create({ code: 'CFGTEN', type: 'PERCENTAGE', value: 10 });
    r = await buy(cheap, 1, karachi, 'cfg-tax-after-discount', { couponCode: 'cfgten' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.discount, 100);
    assert.equal(r.body.data.tax, 90);
    assert.equal(r.body.data.total, 1_390);
    assert.equal(r.body.data.coupon.actualDiscount, 100);
    // Tax-inclusive pricing adds no line, because the price already contains it.
    assert.equal((await settings('tax', { pricesIncludeTax: true })).status, 200);
    r = await buy(cheap, 1, karachi, 'cfg-tax-inclusive');
    assert.equal(r.body.data.tax, 0);
    assert.equal(r.body.data.total, 1_400);
    assert.equal((await settings('tax', { pricesIncludeTax: false })).status, 200);

    /* ------------ §31–32, §65 a configuration change never restates a historical order */
    const stored: any = await Order.findById(historical._id).lean();
    assert.equal(stored.shipping, 250);
    assert.equal(stored.tax, 0);
    assert.equal(stored.total, 1_250);
    r = await request(app).get(`/api/v1/orders/${historical._id}/invoice`).set(auth(ct));
    assert.equal(r.status, 200);
    const invoice = r.body.data;
    assert.equal(invoice.subtotal, 1_000);
    assert.equal(invoice.shipping, 250);
    assert.equal(invoice.tax, 0);
    assert.equal(invoice.total, 1_250);
    assert.equal(
      (await settings('invoice', { footerNote: 'Thank you for shopping with MansooriKart.', showTaxNumber: true, contactLine: 'support@mansoorikart.test' }))
        .status,
      200
    );
    assert.equal((await settings('tax', { taxNumber: 'NTN-1234567' })).status, 200);
    r = await request(app).get(`/api/v1/orders/${historical._id}/invoice`).set(auth(ct));
    // Byte for byte the same invoice: every figure comes from the order's own snapshot.
    assert.deepEqual(r.body.data, invoice);
    const pdf = await request(app).get(`/api/v1/orders/${historical._id}/invoice.pdf`).set(auth(ct));
    assert.equal(pdf.status, 200);
    assert.match(String(pdf.headers['content-type']), /pdf/);
    // The customer-facing order is unchanged too, so a reprint and a re-read agree.
    r = await request(app).get(`/api/v1/orders/${historical._id}`).set(auth(ct));
    assert.equal(r.body.data.shipping, 250);
    assert.equal(r.body.data.tax, 0);
    assert.equal(r.body.data.total, 1_250);

    /* ------------ §66 Finance and Reports read recorded amounts, not the current rate */
    await Order.updateOne({ _id: taxedOrderId }, { $set: { orderStatus: 'DELIVERED', paymentStatus: 'PAID' } });
    assert.equal((await settings('tax', { enabled: false, defaultRate: 0 })).status, 200);
    r = await request(app).get('/api/v1/admin/reports/tax').set(auth(st));
    assert.equal(r.status, 200);
    assert.equal(r.body.data.salesTax.realizedOrders, 1);
    assert.equal(r.body.data.salesTax.collectedOnSales, 100);
    assert.equal(r.body.data.salesTax.realizedRevenue, 1_500);
    assert.equal(r.body.data.basis, 'RECORDED_TAX_AMOUNTS_ONLY');
    // And with tax switched off again, the next order records zero — the pre-Phase-H default.
    r = await buy(cheap, 1, karachi, 'cfg-tax-disabled-again');
    assert.equal(r.body.data.tax, 0);
    assert.equal(r.body.data.total, 1_400);

    /* ------------ §73 cash on delivery keeps working, and closing it fails safely */
    assert.equal((await settings('shipping', { codEnabled: false })).status, 200);
    const ordersBeforeClosure = await Order.countDocuments();
    const stockBeforeClosure = (await Product.findById(cheap._id).lean())!.stock;
    r = await buy(cheap, 1, karachi, 'cfg-cod-closed');
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'PAYMENT_METHOD_UNAVAILABLE');
    // Nothing was reserved, nothing was charged, and the cart is still there to retry with.
    assert.equal(await Order.countDocuments(), ordersBeforeClosure);
    assert.equal((await Product.findById(cheap._id).lean())!.stock, stockBeforeClosure);
    assert.equal((await Cart.findOne({ user: buyer._id }).lean())!.items.length, 1);
    assert.equal((await request(app).get('/api/v1/store/config')).body.data.shipping.codEnabled, false);
    assert.equal((await settings('shipping', { codEnabled: true })).status, 200);
    r = await request(app)
      .post('/api/v1/checkout')
      .set(auth(ct))
      .set('Idempotency-Key', 'cfg-cod-reopened')
      .send({ addressId: String(karachi._id), paymentMethod: 'CASH_ON_DELIVERY' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.total, 1_400);

    /* ------------ §26 disabling delivery charges waives the fee rather than blocking checkout */
    assert.equal((await settings('shipping', { enabled: false })).status, 200);
    r = await buy(cheap, 1, karachi, 'cfg-shipping-disabled');
    assert.equal(r.body.data.shipping, 0);
    assert.equal(r.body.data.total, 1_000);
    /* ------------ §59 a settings patch that changes nothing writes no audit entry */
    const auditsBefore = await AuditLog.countDocuments();
    assert.equal((await settings('shipping', { enabled: false })).status, 200);
    assert.equal(await AuditLog.countDocuments(), auditsBefore);
    assert.equal(await StoreConfiguration.countDocuments(), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
