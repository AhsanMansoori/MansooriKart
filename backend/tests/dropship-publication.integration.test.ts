import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DEFAULT_IMPORT_CATEGORY, PLACEHOLDER_IMAGE_URL } from '../src/config/dropshipping.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Category } from '../src/models/category.js';
import { Product } from '../src/models/product.js';
import { Supplier } from '../src/models/supplier.js';
import { SupplierCatalogItem } from '../src/models/supplierCatalogItem.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('publication is the only door to the storefront and it never leaks supplier economics', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Supplier.init(), SupplierCatalogItem.init(), Product.init(), Category.init()]);
    const [admin, shopper] = await User.create([
      { name: 'Admin', email: 'pub-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Shopper', email: 'pub-shopper@test.local', password: 'Secret123!', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const shopperToken = jwt.sign({ sub: String(shopper._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };
    const asShopper = { Authorization: `Bearer ${shopperToken}` };
    const supplier = await Supplier.create({ name: 'Publication Supplier', code: 'PUB-1' });
    await Category.create([
      { name: 'Accessories', slug: 'accessories', status: 'ACTIVE' },
      { name: 'Retired', slug: 'retired', status: 'ARCHIVED' },
    ]);

    /** A ready-to-publish dropship draft, plus the active supplier source that backs it. */
    const draft = async (name: string, overrides: Record<string, unknown> = {}, sourced = true) => {
      const slug = name.toLowerCase().replaceAll(' ', '-');
      const product = await Product.create({
        name,
        slug,
        sku: `MK-${slug.replaceAll('-', '').toUpperCase().slice(0, 12)}`,
        description: `${name} description`,
        category: 'Accessories',
        brand: 'Logi',
        image: '/images/mouse.png',
        price: 2500,
        stock: 0,
        status: 'DRAFT',
        fulfillmentType: 'DROPSHIP',
        sourceType: 'SUPPLIER_CSV',
        costPrice: 2000,
        ...overrides,
      });
      if (sourced)
        await SupplierCatalogItem.create({
          supplier: supplier._id,
          product: product._id,
          supplierSku: `SS-${String(product._id).slice(-6)}`,
          supplierProductName: name,
          supplierCost: 2000,
          supplierStock: 12,
          supplierAvailability: 'IN_STOCK',
          supplierStockUpdatedAt: new Date(),
          isActive: true,
        });
      return product;
    };
    const publish = (ids: string[]) => request(app).post('/api/v1/admin/products/publish').set(auth).send({ productIds: ids });
    const publishPreview = (ids: string[]) => request(app).post('/api/v1/admin/products/publish-preview').set(auth).send({ productIds: ids });
    const publishOne = (id: string) => request(app).post(`/api/v1/admin/products/${id}/publish`).set(auth).send({});
    const archive = (ids: string[]) => request(app).post('/api/v1/admin/products/archive').set(auth).send({ productIds: ids });
    const candidate = (body: any, id: any) => body.data.candidates.find((item: any) => item.id === String(id));
    const codes = (item: any) => (item.issues ?? []).map((entry: any) => entry.code).sort();

    /* ------------------------------------------------------------ §49 RBAC */
    for (const path of ['/api/v1/admin/products/publish', '/api/v1/admin/products/publish-preview', '/api/v1/admin/products/archive']) {
      assert.equal(
        (
          await request(app)
            .post(path)
            .send({ productIds: [String(new mongoose.Types.ObjectId())] })
        ).status,
        401
      );
      assert.equal(
        (
          await request(app)
            .post(path)
            .set(asShopper)
            .send({ productIds: [String(new mongoose.Types.ObjectId())] })
        ).status,
        403
      );
    }

    /* ------------------------------- §22 the gate: every reason, in one pass */
    // Inserted below the schema so the gate's defensive checks are exercised on the kind of
    // half-filled record legacy data and hand-edits can leave behind, not only on a fresh
    // import (which always lands with a placeholder image and a name-derived description).
    const incompleteId = new mongoose.Types.ObjectId();
    await Product.collection.insertOne({
      _id: incompleteId,
      name: 'Incomplete draft',
      slug: 'incomplete-draft',
      sku: 'MK-INCOMPLETE',
      description: '',
      category: DEFAULT_IMPORT_CATEGORY,
      image: '',
      price: 0,
      stock: 0,
      status: 'DRAFT',
      fulfillmentType: 'DROPSHIP',
      sourceType: 'SUPPLIER_CSV',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    const incomplete = { _id: incompleteId };
    let response = await publishPreview([String(incomplete._id)]);
    assert.equal(response.status, 200);
    assert.deepEqual(
      codes(candidate(response.body, incomplete._id)),
      ['CATEGORY_REQUIRED', 'DESCRIPTION_REQUIRED', 'IMAGE_REQUIRED', 'PRICE_REQUIRED', 'SUPPLIER_SOURCE_REQUIRED'].sort(),
      'a draft reports every launch blocker at once, not one per attempt (§22)'
    );
    assert.equal(candidate(response.body, incomplete._id).publishable, false);
    assert.equal(response.body.data.summary.publishable, 0);
    // §22: an invalid product is never published, and the refusal names the reasons.
    response = await publishOne(String(incomplete._id));
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'PRODUCT_NOT_PUBLISHABLE');
    assert.ok(response.body.error.message.includes('PRICE_REQUIRED'));
    assert.equal((await Product.findById(incomplete._id).lean()).status, 'DRAFT', 'a refused publish leaves the draft alone');
    assert.equal((await Product.findById(incomplete._id).lean()).publishedAt ?? null, null);

    // A dropship product whose only supplier source was deactivated has nobody to ship it.
    const unsourced = await draft('Unsourced draft');
    await SupplierCatalogItem.updateOne({ product: unsourced._id }, { $set: { isActive: false } });
    assert.deepEqual(codes(candidate((await publishPreview([String(unsourced._id)])).body, unsourced._id)), ['SUPPLIER_SOURCE_REQUIRED']);
    // The same product as OWN_STOCK needs no supplier at all, so the check is type-aware.
    await Product.updateOne({ _id: unsourced._id }, { $set: { fulfillmentType: 'OWN_STOCK' } });
    assert.equal(
      candidate((await publishPreview([String(unsourced._id)])).body, unsourced._id).publishable,
      true,
      'owned stock never requires a supplier source (§22)'
    );

    const archivedCategory = await draft('Archived category draft', { category: 'Retired' });
    assert.deepEqual(codes(candidate((await publishPreview([String(archivedCategory._id)])).body, archivedCategory._id)), ['CATEGORY_ARCHIVED']);
    const badType = await draft('Bad type draft');
    await Product.collection.updateOne({ _id: badType._id }, { $set: { fulfillmentType: 'TELEPORT' } });
    assert.deepEqual(codes(candidate((await publishPreview([String(badType._id)])).body, badType._id)), ['FULFILLMENT_TYPE_INVALID']);
    response = await publishPreview([String(new mongoose.Types.ObjectId())]);
    assert.deepEqual(codes(response.body.data.candidates[0]), ['PRODUCT_NOT_FOUND']);
    assert.equal((await publishOne(String(new mongoose.Types.ObjectId()))).status, 404);

    // §52: a bulk request is bounded and refuses a list that repeats an id.
    assert.equal((await publish([])).status, 400);
    assert.equal((await publish([String(incomplete._id), String(incomplete._id)])).body.error.code, 'PRODUCT_IDS_DUPLICATE');
    assert.equal((await publish(Array.from({ length: 201 }, () => String(new mongoose.Types.ObjectId())))).body.error.code, 'PRODUCT_IDS_TOO_MANY');
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/products/publish')
          .set(auth)
          .send({ productIds: ['nope'] })
      ).status,
      400
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/products/publish')
          .set(auth)
          .send({ productIds: [String(incomplete._id)], force: true })
      ).status,
      400
    );

    /* ---------------------------------- §22 publish one, then publish selected */
    const solo = await draft('Solo product');
    response = await publishOne(String(solo._id));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ACTIVE');
    let stored = await Product.findById(solo._id).lean();
    assert.equal(stored.status, 'ACTIVE');
    assert.ok(stored.publishedAt instanceof Date, 'publication stamps when it happened');
    assert.equal(String(stored.publishedBy), String(admin._id), '§48: the publisher comes from the token');
    assert.equal(codes(candidate((await publishPreview([String(solo._id)])).body, solo._id)).includes('PRODUCT_ALREADY_ACTIVE'), true);

    const [alpha, beta] = await Promise.all([draft('Bulk alpha'), draft('Bulk beta')]);
    response = await publish([String(alpha._id), String(beta._id), String(incomplete._id)]);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.summary, { requested: 3, publishedCount: 2, rejectedCount: 1 });
    assert.deepEqual(
      response.body.data.published.map((item: any) => item.id).sort(),
      [String(alpha._id), String(beta._id)].sort(),
      'one bad draft in a batch does not block the good ones (§22)'
    );
    assert.equal(response.body.data.rejected[0].id, String(incomplete._id));
    assert.equal((await Product.findById(incomplete._id).lean()).status, 'DRAFT');
    assert.equal(await Product.countDocuments({ _id: { $in: [alpha._id, beta._id] }, status: 'ACTIVE' }), 2);

    /* -------------------------------------------- §23 what the public may see */
    const publicList = async (query = '') => (await request(app).get(`/api/v1/products${query}`)).body;
    let list = await publicList('?limit=100');
    const publicIds = list.data.map((item: any) => item.id);
    assert.ok(publicIds.includes(String(alpha._id)), 'an ACTIVE product is on the storefront (§23)');
    assert.ok(!publicIds.includes(String(incomplete._id)), 'a DRAFT is never on the storefront (§23)');
    assert.ok(!publicIds.includes(String(archivedCategory._id)));
    assert.equal((await request(app).get(`/api/v1/products/${String(incomplete._id)}`)).status, 404, 'a DRAFT is not addressable publicly (§23)');
    assert.equal((await request(app).get(`/api/v1/products/${String(alpha._id)}`)).status, 200);

    // §23 is enforced in the backend, not by hiding in the UI: a draft cannot be bought.
    response = await request(app)
      .post('/api/v1/cart/items')
      .set(asShopper)
      .send({ productId: String(incomplete._id), quantity: 1 });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'PRODUCT_NOT_FOUND');
    response = await request(app)
      .post('/api/v1/cart/items')
      .set(asShopper)
      .send({ productId: String(alpha._id), quantity: 1 });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    // §30, §56: the cart is a customer surface, and for a dropship product `costPrice` is
    // the supplier's cost, so the line's product goes through the public serializer.
    const cartBody = JSON.stringify(response.body);
    for (const leak of ['costPrice', 'fulfillmentType', 'sourceType', 'sellingPriceOverridden', 'publishedBy', '2000'])
      assert.ok(!cartBody.includes(leak), `${leak} must never reach the cart payload (§56)`);
    assert.equal(response.body.data.items[0].product.price, 2500);
    assert.equal(String(response.body.data.items[0].product._id), String(alpha._id), 'the cart contract keeps the product id');
    assert.equal(response.body.data.subtotal, 2500);
    assert.ok(!JSON.stringify((await request(app).get('/api/v1/cart').set(asShopper)).body).includes('costPrice'));
    // The wishlist is the same kind of surface and is projected the same way.
    response = await request(app)
      .post('/api/v1/wishlist/items')
      .set(asShopper)
      .send({ productId: String(alpha._id) });
    assert.ok(response.status === 200 || response.status === 201, JSON.stringify(response.body));
    const wishlistBody = JSON.stringify(response.body);
    for (const leak of ['costPrice', 'fulfillmentType', 'sourceType', 'sellingPriceOverridden'])
      assert.ok(!wishlistBody.includes(leak), `${leak} must never reach the wishlist payload (§56)`);
    assert.equal(String(response.body.data.products[0]._id), String(alpha._id));

    /* --------------------------------- §22, §23 archiving withdraws from sale */
    response = await archive([String(beta._id)]);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.summary, { requested: 1, archivedCount: 1, missingCount: 0 });
    stored = await Product.findById(beta._id).lean();
    assert.equal(stored.status, 'ARCHIVED');
    assert.equal(stored.featured, false, 'an archived product cannot linger on a home-page rail');
    assert.equal((await request(app).get(`/api/v1/products/${String(beta._id)}`)).status, 404, 'ARCHIVED is not publicly addressable (§23)');
    assert.equal(
      (
        await request(app)
          .post('/api/v1/cart/items')
          .set(asShopper)
          .send({ productId: String(beta._id), quantity: 1 })
      ).status,
      404,
      'ARCHIVED is not publicly purchasable (§23)'
    );
    assert.ok(
      await SupplierCatalogItem.exists({ product: beta._id, isActive: true }),
      'archiving withdraws the product, not the sourcing relationship, so a later import updates rather than duplicates (§26)'
    );
    // An incomplete product is exactly the kind you want to be able to pull, so archiving validates nothing.
    assert.equal((await archive([String(incomplete._id)])).body.data.archived[0], String(incomplete._id));
    response = await archive([String(new mongoose.Types.ObjectId()), String(alpha._id)]);
    assert.deepEqual(response.body.data.summary, { requested: 2, archivedCount: 1, missingCount: 1 });
    // An archived product can be brought back, but only through the same gate.
    assert.equal((await publishOne(String(alpha._id))).body.data.status, 'ACTIVE');

    /* --------------------- §22 the admin write endpoints share the same gate */
    const direct = {
      name: 'Direct active product',
      slug: 'direct-active-product',
      sku: 'MK-DIRECT0001',
      description: 'Written straight to ACTIVE',
      category: 'Accessories',
      image: 'https://cdn.example.com/direct.png',
      price: 0,
      stock: 4,
      status: 'ACTIVE',
    };
    response = await request(app).post('/api/v1/admin/products').set(auth).send(direct);
    assert.equal(response.status, 400, 'creating straight into ACTIVE is publishing and passes the same checks (§22)');
    assert.equal(response.body.error.code, 'PRODUCT_NOT_PUBLISHABLE');
    assert.ok(response.body.error.message.includes('PRICE_REQUIRED'));
    assert.equal(await Product.countDocuments({ sku: 'MK-DIRECT0001' }), 0);
    response = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ ...direct, price: 1200 });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.status, 'ACTIVE');
    const dropshipDirect = await draft('Patch to active', { price: 0 });
    response = await request(app)
      .patch(`/api/v1/admin/products/${String(dropshipDirect._id)}`)
      .set(auth)
      .send({ status: 'ACTIVE' });
    assert.equal(response.status, 400, 'patching a draft to ACTIVE is publishing too (§22)');
    assert.equal((await Product.findById(dropshipDirect._id).lean()).status, 'DRAFT');
    response = await request(app)
      .patch(`/api/v1/admin/products/${String(dropshipDirect._id)}`)
      .set(auth)
      .send({ status: 'ACTIVE', price: 3300 });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ACTIVE');
    assert.equal(response.body.data.sellingPriceOverridden, true, 'a hand-typed price is an admin decision (§19)');
    assert.ok((await Product.findById(dropshipDirect._id).lean()).publishedAt instanceof Date);

    /* -------------------------------------------------------- §50 audit trail */
    const actions = (await AuditLog.find({ resourceType: 'Product' }).lean()).map((entry: any) => entry.action);
    assert.ok(actions.includes('PRODUCT_PUBLISHED'), 'a manual publish is audited (§50)');
    assert.ok(actions.includes('PRODUCT_BULK_PUBLISHED'), 'a bulk publish is audited (§50)');
    assert.ok(actions.includes('PRODUCT_ARCHIVED'));
    const bulkEntry = await AuditLog.findOne({ action: 'PRODUCT_BULK_PUBLISHED' }).lean();
    assert.deepEqual(bulkEntry.metadata.productIds.sort(), [String(alpha._id), String(beta._id)].sort());
    assert.equal(bulkEntry.metadata.rejectedCount, 1);
    assert.equal(String(bulkEntry.actor), String(admin._id));
    assert.ok(!(await AuditLog.findOne({ action: 'PRODUCT_NOT_PUBLISHABLE' }).lean()), 'a refused publish is not recorded as a publication');

    /* ------------------- §56 the storefront sees a price, never an economics sheet */
    const live = await Product.findById(alpha._id).lean();
    assert.equal(live.costPrice, 2000, 'the cost is stored...');
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/products/${String(alpha._id)}`)
          .set(auth)
          .send({ compareAtPrice: 2999 })
      ).status,
      200
    );
    response = await request(app).get(`/api/v1/products/${String(alpha._id)}`);
    assert.equal(response.status, 200);
    const detail = JSON.stringify(response.body);
    for (const leak of [
      'costPrice',
      'supplierCost',
      'supplier',
      'supplierSku',
      'supplierSuggestedRetailPrice',
      'grossUnitMargin',
      'grossMarginPercent',
      'sellingPriceOverridden',
      'fulfillmentType',
      'sourceType',
      'sourceRowHash',
      'publishedBy',
      '2000',
    ])
      assert.ok(!detail.includes(leak), `${leak} must never reach a public product payload (§56)`);
    assert.equal(response.body.data.price, 2500, '...and the storefront receives only the MansooriKart selling price (§56)');
    assert.equal(response.body.data.currency, 'PKR');
    assert.ok(response.body.data.compareAtPrice === 2999, 'the public compare price is allowed (§56)');
    const listBody = JSON.stringify(await publicList('?limit=100'));
    for (const leak of ['costPrice', 'supplierCost', 'fulfillmentType', 'sourceType', 'sellingPriceOverridden'])
      assert.ok(!listBody.includes(leak), `${leak} must never reach a public product list (§56)`);
    // The same product for an admin does carry the internals — this is an allowlist, not a delete list.
    const adminView = (
      await request(app)
        .get(`/api/v1/admin/products/${String(alpha._id)}`)
        .set(auth)
    ).body.data;
    assert.equal(adminView.costPrice, 2000);
    assert.equal(adminView.fulfillmentType, 'DROPSHIP');
    assert.equal(adminView.sourceType, 'SUPPLIER_CSV');
    assert.equal(adminView.status, 'ACTIVE');
    assert.ok('publishedAt' in adminView);

    // §49: nothing about publication or sourcing is reachable without a super-admin token.
    assert.equal((await request(app).get(`/api/v1/admin/products/${String(alpha._id)}`)).status, 401);
    assert.equal(
      (
        await request(app)
          .get(`/api/v1/admin/products/${String(alpha._id)}`)
          .set(asShopper)
      ).status,
      403
    );
    assert.equal((await request(app).get('/api/v1/admin/supplier-sources').set(asShopper)).status, 403);
    assert.equal((await request(app).get('/api/v1/admin/catalog-imports').set(asShopper)).status, 403);
    assert.ok(!JSON.stringify(await publicList('?limit=100')).includes('catalog-import'));
    assert.equal(PLACEHOLDER_IMAGE_URL, '/images/placeholder-product.svg');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
