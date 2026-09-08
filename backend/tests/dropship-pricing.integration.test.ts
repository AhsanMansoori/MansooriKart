import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { PricingRule } from '../src/models/pricingRule.js';
import { Product } from '../src/models/product.js';
import { Supplier } from '../src/models/supplier.js';
import { SupplierCatalogItem } from '../src/models/supplierCatalogItem.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('pricing rules turn supplier cost into a suggested selling price deterministically', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Supplier.init(), SupplierCatalogItem.init(), PricingRule.init(), Product.init()]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'price-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Customer', email: 'price-customer@test.local', password: 'Secret123!', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };
    const [supplier, other] = await Supplier.create([
      { name: 'Pricing Supplier', code: 'PR-ONE' },
      { name: 'Second Supplier', code: 'PR-TWO' },
    ]);

    /** A DROPSHIP draft with one active supplier source at a known cost. */
    const seed = async (name: string, cost: number, extra: Record<string, unknown> = {}, from: any = supplier) => {
      const product = await Product.create({
        name,
        slug: name.toLowerCase().replaceAll(' ', '-'),
        sku: `MK-${name.replaceAll(' ', '').toUpperCase().slice(0, 10)}`,
        description: name,
        category: 'Accessories',
        brand: 'Logi',
        image: '/images/placeholder-product.svg',
        price: 0,
        stock: 0,
        status: 'DRAFT',
        fulfillmentType: 'DROPSHIP',
        sourceType: 'SUPPLIER_CSV',
        sellingPriceOverridden: false,
        ...extra,
      });
      await SupplierCatalogItem.create({
        supplier: from._id,
        product: product._id,
        supplierSku: `S-${String(product._id).slice(-6)}`,
        supplierProductName: name,
        supplierCost: cost,
        supplierStock: 10,
        supplierAvailability: 'IN_STOCK',
        supplierStockUpdatedAt: new Date(),
        isActive: true,
      });
      return product;
    };
    const rule = (body: Record<string, unknown>) => request(app).post('/api/v1/admin/pricing-rules').set(auth).send(body);
    const preview = (body: Record<string, unknown>) => request(app).post('/api/v1/admin/pricing/preview').set(auth).send(body);
    const apply = (body: Record<string, unknown>) => request(app).post('/api/v1/admin/pricing/apply').set(auth).send(body);
    const rowFor = (body: any, productId: string) => body.data.rows.find((row: any) => row.productId === String(productId));

    /* ------------------------------------------------------------ §49 RBAC */
    assert.equal((await request(app).get('/api/v1/admin/pricing-rules')).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/pricing-rules').set('Authorization', `Bearer ${customerToken}`)).status, 403);
    assert.equal((await request(app).post('/api/v1/admin/pricing/preview').set('Authorization', `Bearer ${customerToken}`).send({})).status, 403);
    assert.equal((await request(app).post('/api/v1/admin/pricing/apply').send({})).status, 401);

    /* --------------------------------------------- §16, §48 the rule record */
    let response = await rule({ name: 'Percentage rule', markupType: 'PERCENTAGE', markupValue: 25, priority: 5 });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const percentageRule = response.body.data;
    assert.equal(percentageRule.markupType, 'PERCENTAGE');
    assert.equal(percentageRule.markupValue, 25);
    assert.equal(percentageRule.isActive, true);
    assert.equal(percentageRule.roundingRule, 'NONE');
    assert.equal(percentageRule.createdBy, String(admin._id), 'the author is taken from the token, never the body (§48)');
    assert.equal(percentageRule.supplier, null);
    assert.equal(
      (await rule({ name: 'X', markupType: 'PERCENTAGE', markupValue: 10, createdBy: String(customer._id) })).status,
      400,
      '§48: createdBy is server-owned'
    );
    assert.equal((await rule({ name: 'X', markupType: 'PERCENTAGE', markupValue: 10, isActive: false })).status, 400, '§48: activation is not a create field');
    assert.equal((await rule({ name: 'X', markupType: 'MAGIC', markupValue: 10 })).status, 400);
    assert.equal((await rule({ name: 'X', markupType: 'FIXED', markupValue: -5 })).status, 400, 'a negative markup is refused');
    assert.equal(
      (await rule({ name: 'Inverted band', markupType: 'FIXED', markupValue: 10, minCost: 900, maxCost: 100 })).body.error.code,
      'PRICING_RULE_COST_BAND_INVALID'
    );
    assert.equal(
      (await rule({ name: 'Ghost supplier', markupType: 'FIXED', markupValue: 10, supplierId: String(new mongoose.Types.ObjectId()) })).body.error.code,
      'PRICING_RULE_SUPPLIER_NOT_FOUND'
    );

    /* ------------------------------- §17 the worked examples, exactly as stated */
    const percentageProduct = await seed('Percent mouse', 2000);
    response = await preview({ productIds: [String(percentageProduct._id)] });
    assert.equal(response.status, 200);
    let row = rowFor(response.body, percentageProduct._id);
    assert.equal(row.supplierCost, 2000);
    assert.equal(row.newPrice, 2500, 'cost 2000 with +25% is 2500 (§17)');
    assert.equal(row.grossUnitMargin, 500);
    assert.equal(row.grossMarginPercent, 20);
    assert.equal(row.appliedMinimumProfit, false);
    assert.equal(row.appliedRounding, false);
    assert.equal(row.rule.name, 'Percentage rule');
    assert.equal(response.body.data.marginBasis, 'gross merchandise margin', '§21 labels the basis on every payload');

    // §20: a preview is a read. Nothing may have moved.
    assert.equal((await Product.findById(percentageProduct._id).lean()).price, 0, 'a preview writes nothing (§20)');
    assert.equal(response.body.data.summary.updated, 0);

    const fixedRule = (await rule({ name: 'Fixed rule', markupType: 'FIXED', markupValue: 500, priority: 9 })).body.data;
    response = await preview({ productIds: [String(percentageProduct._id)], ruleId: fixedRule.id });
    assert.equal(rowFor(response.body, percentageProduct._id).newPrice, 2500, 'cost 2000 with +500 fixed is 2500 (§17)');

    const floorRule = (await rule({ name: 'Floor rule', markupType: 'PERCENTAGE', markupValue: 7.5, minimumProfit: 300 })).body.data;
    response = await preview({ productIds: [String(percentageProduct._id)], ruleId: floorRule.id });
    row = rowFor(response.body, percentageProduct._id);
    assert.equal(row.newPrice, 2300, 'a 2150 markup on cost 2000 is lifted to the 300 minimum profit (§17)');
    assert.equal(row.grossUnitMargin, 300);
    assert.equal(row.appliedMinimumProfit, true);

    const roundingRule = (await rule({ name: 'Rounding rule', markupType: 'PERCENTAGE', markupValue: 25, roundingRule: 'END_99' })).body.data;
    response = await preview({ productIds: [String(percentageProduct._id)], ruleId: roundingRule.id });
    row = rowFor(response.body, percentageProduct._id);
    assert.equal(row.newPrice, 2499, 'END_99 lowers 2500 to 2499 (§17)');
    assert.equal(row.appliedRounding, true);
    assert.ok(row.grossUnitMargin > 0, 'rounding may never produce a negative margin (§17)');

    // §17: rounding is cosmetic and must not eat a profit floor.
    const bothRule = (await rule({ name: 'Floor and rounding', markupType: 'FIXED', markupValue: 500, minimumProfit: 500, roundingRule: 'END_99' })).body.data;
    row = rowFor((await preview({ productIds: [String(percentageProduct._id)], ruleId: bothRule.id })).body, percentageProduct._id);
    assert.equal(row.newPrice, 2500, 'the ...99 below 2500 would break the 500 floor, so the exact price stands');
    assert.equal(row.grossUnitMargin, 500);

    const zeroRule = (await rule({ name: 'Zero markup', markupType: 'FIXED', markupValue: 0 })).body.data;
    row = rowFor((await preview({ productIds: [String(percentageProduct._id)], ruleId: zeroRule.id })).body, percentageProduct._id);
    assert.equal(row.newPrice, 2000);
    assert.equal(row.grossUnitMargin, 0, 'the worst case is zero margin, never a negative one (§17)');

    /* --------------------------------------- §18 deterministic rule precedence */
    for (const id of [fixedRule.id, floorRule.id, roundingRule.id, bothRule.id, zeroRule.id])
      assert.equal((await request(app).post(`/api/v1/admin/pricing-rules/${id}/disable`).set(auth).send({})).status, 200);
    const scoped = {
      global: percentageRule,
      category: (await rule({ name: 'Category rule', category: 'Accessories', markupType: 'PERCENTAGE', markupValue: 30 })).body.data,
      supplier: (await rule({ name: 'Supplier rule', supplierId: String(supplier._id), markupType: 'PERCENTAGE', markupValue: 40 })).body.data,
      both: (
        await rule({ name: 'Supplier and category rule', supplierId: String(supplier._id), category: 'Accessories', markupType: 'PERCENTAGE', markupValue: 50 })
      ).body.data,
    };
    const selected = async () => rowFor((await preview({ productIds: [String(percentageProduct._id)] })).body, percentageProduct._id).rule.name;
    assert.equal(await selected(), 'Supplier and category rule', 'supplier+category is the narrowest scope and wins (§18)');
    // Repeating the same request must resolve identically; there is no random selection.
    assert.equal(await selected(), 'Supplier and category rule');
    await request(app).post(`/api/v1/admin/pricing-rules/${scoped.both.id}/disable`).set(auth).send({});
    assert.equal(await selected(), 'Supplier rule', 'supplier beats category (§18)');
    await request(app).post(`/api/v1/admin/pricing-rules/${scoped.supplier.id}/disable`).set(auth).send({});
    assert.equal(await selected(), 'Category rule', 'category beats global (§18)');
    await request(app).post(`/api/v1/admin/pricing-rules/${scoped.category.id}/disable`).set(auth).send({});
    assert.equal(await selected(), 'Percentage rule', 'the global rule is the last resort (§18)');

    // Equal specificity is broken by priority, then by age — never arbitrarily.
    const lowPriority = (await rule({ name: 'Low priority', category: 'Accessories', markupType: 'PERCENTAGE', markupValue: 12, priority: 1 })).body.data;
    const highPriority = (await rule({ name: 'High priority', category: 'Accessories', markupType: 'PERCENTAGE', markupValue: 18, priority: 7 })).body.data;
    assert.equal(await selected(), 'High priority', 'within one scope the higher priority wins (§18)');
    await request(app).post(`/api/v1/admin/pricing-rules/${highPriority.id}/disable`).set(auth).send({});
    assert.equal(await selected(), 'Low priority');
    // A cost band is part of the scope, so a banded rule outranks an unbanded sibling.
    const banded = (
      await rule({ name: 'Banded rule', category: 'Accessories', minCost: 1500, maxCost: 2500, markupType: 'PERCENTAGE', markupValue: 15, priority: 1 })
    ).body.data;
    assert.equal(await selected(), 'Banded rule');
    const outOfBand = await seed('Out of band', 9000);
    assert.equal(
      rowFor((await preview({ productIds: [String(outOfBand._id)] })).body, outOfBand._id).rule.name,
      'Low priority',
      'a cost outside the band falls through'
    );
    for (const id of [lowPriority.id, banded.id]) await request(app).post(`/api/v1/admin/pricing-rules/${id}/disable`).set(auth).send({});
    assert.equal((await request(app).post(`/api/v1/admin/pricing-rules/${highPriority.id}/enable`).set(auth).send({})).body.data.isActive, true);
    await request(app).post(`/api/v1/admin/pricing-rules/${highPriority.id}/disable`).set(auth).send({});

    /* ------------------------------- §19, §20 preview, apply, and overrides */
    const curated = await seed('Curated product', 2000, { price: 9999, sellingPriceOverridden: true });
    const noCost = await Product.create({
      name: 'No cost product',
      slug: 'no-cost-product',
      sku: 'MK-NOCOST001',
      description: 'No cost product',
      category: 'Accessories',
      image: '/images/placeholder-product.svg',
      price: 0,
      stock: 0,
      status: 'DRAFT',
      fulfillmentType: 'DROPSHIP',
    });
    const batch = { productIds: [String(percentageProduct._id), String(curated._id), String(noCost._id)] };
    response = await preview(batch);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.summary, { targets: 3, eligible: 1, willChange: 1, preservedOverrides: 1, blocked: 2, updated: 0 });
    assert.deepEqual(
      rowFor(response.body, curated._id).issues.map((issue: any) => issue.code),
      ['PRICE_MANUALLY_OVERRIDDEN'],
      'a hand-set price is reported as preserved, not silently changed (§19)'
    );
    assert.deepEqual(
      rowFor(response.body, noCost._id).issues.map((issue: any) => issue.code),
      ['SUPPLIER_COST_MISSING'],
      'a product with no supplier cost is blocked with a reason, not priced from nothing (§20)'
    );
    assert.equal(rowFor(response.body, noCost._id).newPrice, null);

    response = await apply(batch);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.summary.updated, 1);
    assert.equal(response.body.data.marginBasis, 'gross merchandise margin');
    let priced = await Product.findById(percentageProduct._id).lean();
    assert.equal(priced.price, 2500, 'apply writes the price a preview promised (§20)');
    assert.equal(priced.sellingPriceOverridden, true, 'an applied price is now an admin decision (§19)');
    assert.equal(priced.status, 'DRAFT', 'repricing never publishes (§20)');
    assert.equal((await Product.findById(curated._id).lean()).price, 9999, 'a manual price survives a bulk apply (§19)');
    const bulkAudit = await AuditLog.findOne({ action: 'PRICING_BULK_APPLIED' }).lean();
    assert.equal(bulkAudit.metadata.updated, 1);
    assert.equal(bulkAudit.metadata.targets, 3);
    assert.ok(!JSON.stringify(bulkAudit.metadata).includes('9999'), 'an audit entry records the decision, not a price list (§50)');

    // Re-applying the same batch is a no-op: the applied price is now protected too.
    response = await apply(batch);
    assert.equal(response.body.data.summary.updated, 0);
    assert.equal(response.body.data.summary.preservedOverrides, 2);

    // §19: overriding an override is possible, but only when the admin asks for it.
    response = await apply({ ...batch, includeOverridden: true });
    assert.equal(response.body.data.summary.preservedOverrides, 0);
    assert.equal((await Product.findById(curated._id).lean()).price, 2500, 'an explicit opt-in applies the suggestion (§19)');
    assert.equal((await Product.findById(curated._id).lean()).status, 'DRAFT');

    /* ---------------------------------- §20 target selection is never unbounded */
    assert.equal((await preview({})).body.error.code, 'PRICING_TARGETS_REQUIRED', 'the whole catalog is not a target set');
    assert.equal((await preview({ productIds: [String(curated._id), String(curated._id)] })).body.error.code, 'PRICING_TARGETS_DUPLICATE');
    assert.equal((await preview({ productIds: [] })).status, 400);
    assert.equal((await preview({ productIds: [String(curated._id)], nope: true })).status, 400);
    assert.equal((await preview({ ruleId: 'not-an-id', status: 'DRAFT' })).status, 400);
    assert.equal((await preview({ status: 'DRAFT', ruleId: String(new mongoose.Types.ObjectId()) })).body.error.code, 'PRICING_RULE_NOT_FOUND');
    assert.equal(
      (await preview({ status: 'DRAFT', ruleId: scoped.both.id })).body.error.code,
      'PRICING_RULE_INACTIVE',
      'a disabled rule can never be selected, even by id (§18)'
    );
    // A supplier filter is a legitimate target set and stays inside that supplier.
    response = await preview({ supplierId: String(other._id) });
    assert.equal(response.body.data.summary.targets, 0, 'a supplier with no sourced products has no targets');
    response = await preview({ supplierId: String(supplier._id), includeOverridden: true });
    assert.ok(response.body.data.summary.targets >= 3);
    assert.ok(response.body.data.rows.every((item: any) => item.supplierId === String(supplier._id)));

    /* ----------------------------------------- §41 the rule book, listed safely */
    response = await request(app).get('/api/v1/admin/pricing-rules?page=1&limit=3').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 3);
    assert.ok(response.body.meta.total >= 12);
    assert.ok(response.body.meta.hasNextPage);
    const priorities = response.body.data.map((item: any) => item.priority);
    assert.deepEqual(
      priorities,
      [...priorities].sort((a: number, b: number) => b - a),
      'the rule book lists in resolution order'
    );
    assert.equal((await request(app).get('/api/v1/admin/pricing-rules?limit=900').set(auth)).status, 400);
    assert.equal(
      (await request(app).get('/api/v1/admin/pricing-rules?isActive=false').set(auth)).body.data.every((item: any) => item.isActive === false),
      true
    );
    assert.equal((await request(app).get(`/api/v1/admin/pricing-rules/${percentageRule.id}`).set(auth)).body.data.name, 'Percentage rule');
    assert.equal((await request(app).get(`/api/v1/admin/pricing-rules/${new mongoose.Types.ObjectId()}`).set(auth)).body.error.code, 'PRICING_RULE_NOT_FOUND');

    response = await request(app).patch(`/api/v1/admin/pricing-rules/${percentageRule.id}`).set(auth).send({ markupValue: 35, category: 'Audio' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.markupValue, 35);
    assert.equal(response.body.data.category, 'Audio');
    assert.equal(response.body.data.updatedBy, String(admin._id));
    assert.equal((await request(app).patch(`/api/v1/admin/pricing-rules/${percentageRule.id}`).set(auth).send({ category: null })).body.data.category, null);
    assert.equal((await request(app).patch(`/api/v1/admin/pricing-rules/${percentageRule.id}`).set(auth).send({})).status, 400);
    assert.equal((await request(app).patch(`/api/v1/admin/pricing-rules/${percentageRule.id}`).set(auth).send({ isActive: true })).status, 400, '§48');
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/pricing-rules/${percentageRule.id}`)
          .set(auth)
          .send({ createdBy: String(admin._id) })
      ).status,
      400,
      '§48'
    );
    assert.equal((await request(app).patch(`/api/v1/admin/pricing-rules/${new mongoose.Types.ObjectId()}`).set(auth).send({ markupValue: 1 })).status, 404);

    /* -------------------------------------------------------- §50 audit trail */
    const actions = (await AuditLog.find({ resourceType: 'PricingRule', resourceId: percentageRule.id }).lean()).map((entry: any) => entry.action);
    assert.ok(actions.includes('PRICING_RULE_CREATED'));
    assert.ok(actions.includes('PRICING_RULE_UPDATED'));
    assert.ok(
      (await AuditLog.find({ action: 'PRICING_RULE_DISABLED' }).lean()).length >= 5,
      'retiring a rule is a recorded decision, not a silent flag flip (§50)'
    );
    assert.ok((await AuditLog.find({ action: 'PRICING_RULE_ENABLED' }).lean()).length >= 1);

    /* ------------------- §21, §56 pricing internals stay out of the storefront */
    await Product.updateOne({ _id: percentageProduct._id }, { $set: { status: 'ACTIVE', publishedAt: new Date() } });
    response = await request(app).get(`/api/v1/products/${String(percentageProduct._id)}`);
    assert.equal(response.status, 200);
    const publicBody = JSON.stringify(response.body);
    for (const leak of ['supplierCost', 'costPrice', 'grossUnitMargin', 'grossMarginPercent', 'markupType', 'markupValue', 'sellingPriceOverridden'])
      assert.ok(!publicBody.includes(leak), `${leak} must never reach the storefront (§56)`);
    assert.equal(response.body.data.price, 2500, 'the storefront sees the MansooriKart selling price and nothing else (§56)');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
