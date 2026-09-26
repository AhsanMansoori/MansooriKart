import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { CSV_LIMITS, PLACEHOLDER_IMAGE_URL, SUPPLIER_STOCK_STALE_AFTER_HOURS } from '../src/config/dropshipping.js';
import { AuditLog } from '../src/models/auditLog.js';
import { CatalogImportJob } from '../src/models/catalogImport.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Product } from '../src/models/product.js';
import { Supplier } from '../src/models/supplier.js';
import { SupplierCatalogItem } from '../src/models/supplierCatalogItem.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

/** The supplier's own column names, chosen so the heuristic suggestion maps all nine. */
const HEADERS = 'sku,title,details,cost,qty,category,brand,photo,rrp';
const MAPPING = [
  { column: 'sku', target: 'supplierSku' },
  { column: 'title', target: 'name' },
  { column: 'details', target: 'description' },
  { column: 'cost', target: 'supplierCost' },
  { column: 'qty', target: 'supplierStock' },
  { column: 'category', target: 'category' },
  { column: 'brand', target: 'brand' },
  { column: 'photo', target: 'imageUrl' },
  { column: 'rrp', target: 'supplierSuggestedRetailPrice' },
];

test('supplier CSV import creates DRAFT products only, is bounded, deterministic and repeatable', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Supplier.init(), SupplierCatalogItem.init(), CatalogImportJob.init(), Product.init()]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'csv-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Customer', email: 'csv-customer@test.local', password: 'Secret123!', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };
    const [supplier, archived] = await Supplier.create([
      { name: 'Karachi Dropship', code: 'CSV-KD' },
      { name: 'Retired Supplier', code: 'CSV-RS', status: 'ARCHIVED' },
    ]);
    /** Uploads a raw CSV body the way the route expects it: `text/csv`, no multipart. */
    const upload = (body: string, query = `supplierId=${String(supplier._id)}&fileName=feed.csv`, bearer = token, type = 'text/csv') =>
      request(app).post(`/api/v1/admin/catalog-imports?${query}`).set('Authorization', `Bearer ${bearer}`).set('Content-Type', type).send(body);
    /** Upload → map → import in one step, for the many cases that only care about the outcome. */
    const runFeed = async (body: string, mapping: Record<string, unknown> = {}) => {
      const uploaded = await upload(body);
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
      const jobId = uploaded.body.data.job.id;
      const mapped = await request(app)
        .post(`/api/v1/admin/catalog-imports/${jobId}/mapping`)
        .set(auth)
        .send({ entries: MAPPING, ...mapping });
      assert.equal(mapped.status, 200, JSON.stringify(mapped.body));
      const imported = await request(app).post(`/api/v1/admin/catalog-imports/${jobId}/import`).set(auth).send({});
      assert.equal(imported.status, 200, JSON.stringify(imported.body));
      return { jobId, job: imported.body.data.job, replayed: imported.body.data.replayed };
    };
    const rowsOf = async (jobId: string, query = '') =>
      (await request(app).get(`/api/v1/admin/catalog-imports/${jobId}/rows?limit=200${query}`).set(auth)).body.data;
    const codesOf = (row: any) => (row.errors ?? []).map((entry: any) => entry.code);

    /* ------------------------------------------------------------ §49 RBAC */
    for (const path of ['/catalog-imports', '/catalog-imports/mapping-targets']) {
      assert.equal((await request(app).get(`/api/v1/admin${path}`)).status, 401, `${path} must reject anonymous access`);
      assert.equal(
        (await request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${customerToken}`)).status,
        403,
        `${path} must reject a customer`
      );
    }
    assert.equal((await upload(`${HEADERS}\nA-1,Widget,d,100,5,Cat,Br,,`, undefined, customerToken)).status, 403);
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/admin/catalog-imports?supplierId=${String(supplier._id)}&fileName=x.csv`)
          .set('Content-Type', 'text/csv')
          .send('a,b\n1,2')
      ).status,
      401
    );

    /* -------------------------------------------- §10 mapping vocabulary */
    let response = await request(app).get('/api/v1/admin/catalog-imports/mapping-targets').set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.required, ['supplierSku', 'name', 'supplierCost']);
    assert.deepEqual(response.body.data.overwritable, ['name', 'description', 'category', 'brand', 'images']);
    for (const target of ['supplierSku', 'name', 'supplierCost', 'supplierStock', 'imageUrl', 'imageUrls', 'barcode', 'supplierSuggestedRetailPrice'])
      assert.ok(response.body.data.targets.includes(target), `${target} must be an offered mapping target`);
    assert.equal(response.body.data.limits.maxRows, CSV_LIMITS.maxRows);
    assert.equal(response.body.data.limits.maxFileBytes, CSV_LIMITS.maxFileBytes);
    /* ------------------------------------- §8, §47 upload-time rejections */
    const rejected: [string, string, string][] = [
      ['a wrong content type', '', 'CSV_CONTENT_TYPE_UNSUPPORTED'],
      ['an empty file', '', 'CSV_EMPTY'],
      ['a header with no data rows', HEADERS, 'CSV_NO_DATA_ROWS'],
      ['a duplicate column header', 'sku,cost,SKU\nA-1,10,A-1', 'CSV_HEADER_DUPLICATE'],
      ['a blank column header', 'sku,,cost\nA-1,x,10', 'CSV_HEADER_BLANK'],
      ['an unterminated quote', 'sku,cost\n"A-1,10', 'CSV_QUOTE_UNTERMINATED'],
      ['a malformed quoted value', 'sku,cost\nA-"1",10', 'CSV_QUOTE_INVALID'],
      ['binary content', `sku,cost\nA${String.fromCharCode(0)}-1,10`, 'CSV_NOT_TEXT'],
      [
        `more than ${CSV_LIMITS.maxColumns} columns`,
        `${Array.from({ length: 61 }, (_, index) => `c${index}`).join(',')}\n${Array.from({ length: 61 }, () => 'v').join(',')}`,
        'CSV_TOO_MANY_COLUMNS',
      ],
      ['an oversized cell', `sku,cost\n${'x'.repeat(CSV_LIMITS.maxFieldLength + 1)},10`, 'CSV_FIELD_TOO_LONG'],
      ['an oversized header', `${'h'.repeat(CSV_LIMITS.maxHeaderLength + 1)},cost\nA-1,10`, 'CSV_HEADER_TOO_LONG'],
      [
        `more than ${CSV_LIMITS.maxRows} rows`,
        `${HEADERS}\n${Array.from({ length: CSV_LIMITS.maxRows + 1 }, (_, index) => `R-${index},N,d,10,1,Cat,Br,,`).join('\n')}`,
        'CSV_TOO_MANY_ROWS',
      ],
    ];
    for (const [label, body, code] of rejected) {
      const attempt = code === 'CSV_CONTENT_TYPE_UNSUPPORTED' ? await upload('sku,cost\nA-1,10', undefined, token, 'text/html') : await upload(body);
      assert.equal(attempt.body.error?.code, code, `${label} must be refused as ${code}`);
      assert.ok(attempt.status >= 400 && attempt.status < 500, `${label} must be a client error`);
      assert.ok(!JSON.stringify(attempt.body).includes('CsvFormatError'), 'no parser internal may reach a client');
    }
    // §48: the supplier a job belongs to is a query parameter; server-owned job fields are not settable.
    assert.equal((await upload(`${HEADERS}\nA-1,W,d,10,1,Cat,Br,,`, 'fileName=feed.csv')).status, 400, 'a supplier is required');
    assert.equal(
      (await upload(`${HEADERS}\nA-1,W,d,10,1,Cat,Br,,`, `supplierId=${String(supplier._id)}&fileName=feed.csv&status=READY`)).status,
      400,
      'an import job status may never be supplied by a client'
    );
    assert.equal((await upload(`${HEADERS}\nA-1,W,d,10,1,Cat,Br,,`, `supplierId=${new mongoose.Types.ObjectId()}&fileName=feed.csv`)).status, 404);
    assert.equal(
      (await upload(`${HEADERS}\nA-1,W,d,10,1,Cat,Br,,`, `supplierId=${String(archived._id)}&fileName=feed.csv`)).body.error.code,
      'SUPPLIER_INACTIVE'
    );
    assert.equal(await CatalogImportJob.countDocuments(), 0, 'a refused upload must not leave a job behind');

    /* ------------------------------------- §10, §11 upload then mapping */
    const feed = [
      HEADERS,
      'ABC-882819,Supplier Wireless Mouse,A quiet mouse,2000,50,Accessories,Logi,https://cdn.supplier.test/mouse.png,3500',
      'ABC-991002,Supplier Keyboard,A loud keyboard,4200,3,Accessories,Logi,https://cdn.supplier.test/kb.png,7000',
      'ABC-773311,Supplier Headset,Cans,7500,0,Audio,Sonic,https://cdn.supplier.test/hs.png,',
    ].join('\n');
    response = await upload(feed);
    assert.equal(response.status, 201);
    const firstJob = response.body.data.job;
    assert.equal(firstJob.status, 'UPLOADED');
    assert.equal(firstJob.fileName, 'feed.csv');
    assert.equal(firstJob.counters.totalRows, 3);
    assert.ok(/^CSV-\d{8}-[0-9A-F]{6}$/.test(firstJob.jobNumber) || firstJob.jobNumber.length > 4, 'a job carries a server-generated number');
    assert.deepEqual(response.body.data.headers, HEADERS.split(','));
    assert.equal(response.body.data.suggestedMapping.length, 9, 'every supplier column in this feed is recognised');
    assert.equal(response.body.data.templateMapping, null, 'this supplier has no saved template yet');
    const mapping = (entries: unknown, extra: Record<string, unknown> = {}) =>
      request(app)
        .post(`/api/v1/admin/catalog-imports/${firstJob.id}/mapping`)
        .set(auth)
        .send({ entries, ...extra });
    assert.equal((await mapping([{ column: 'nope', target: 'supplierSku' }])).body.error.code, 'MAPPING_COLUMN_UNKNOWN');
    assert.equal(
      (
        await mapping([
          { column: 'sku', target: 'supplierSku' },
          { column: 'sku', target: 'name' },
        ])
      ).body.error.code,
      'MAPPING_COLUMN_DUPLICATE'
    );
    assert.equal(
      (
        await mapping([
          { column: 'sku', target: 'supplierSku' },
          { column: 'title', target: 'supplierSku' },
        ])
      ).body.error.code,
      'MAPPING_TARGET_DUPLICATE'
    );
    assert.equal((await mapping([{ column: 'sku', target: 'supplierSku' }])).body.error.code, 'MAPPING_REQUIRED_MISSING');
    assert.equal((await mapping([{ column: 'cost', target: 'sellingPrice' }])).status, 400, 'the selling price is not an importable target (§15)');
    assert.equal((await mapping(MAPPING, { status: 'READY' })).status, 400, 'a client may not set the job status (§48)');
    assert.equal((await mapping(MAPPING, { totalRows: 99 })).status, 400, 'a client may not set job counters (§48)');

    response = await mapping(MAPPING, { saveAsTemplate: true, templateName: 'Karachi feed' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'READY');
    assert.ok(response.body.data.mapping.confirmedAt, 'a confirmed mapping is stamped');
    assert.equal(response.body.data.mapping.confirmedBy, String(admin._id));
    assert.equal(response.body.data.mapping.entries.length, 9, 'the mapping is stored with the job (§10)');
    assert.deepEqual(
      response.body.data.mapping.allowFieldOverwrite,
      { name: false, description: false, category: false, brand: false, images: false },
      'curated fields are preserved unless overwrite is opted into (§14)'
    );
    assert.equal(response.body.data.fulfillmentType, 'DROPSHIP');

    /* --------------------------------------------- §12 preview writes nothing */
    response = await request(app).get(`/api/v1/admin/catalog-imports/${firstJob.id}/preview`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(await Product.countDocuments(), 0, 'a preview must not create products');
    assert.equal(await SupplierCatalogItem.countDocuments(), 0, 'a preview must not create sourcing records');
    assert.equal(response.body.data.rows.length, 3);
    assert.equal(response.body.data.hasMoreRows, false);
    const [mouse, keyboard, headset] = response.body.data.rows;
    assert.deepEqual(
      [mouse.action, mouse.result, mouse.supplierCost, mouse.supplierStock, mouse.supplierAvailability],
      ['CREATE', 'VALID', 2000, 50, 'IN_STOCK']
    );
    assert.equal(keyboard.supplierAvailability, 'LOW_STOCK');
    assert.equal(headset.supplierAvailability, 'OUT_OF_STOCK');
    assert.equal(mouse.suggestedPrice, null, 'no pricing rule exists yet, so there is no suggestion');
    assert.equal(mouse.priceWillBeApplied, false);
    assert.equal(mouse.currentProduct, null);
    assert.ok(!('hash' in mouse) && !('sourceRowHash' in mouse), 'internal change-detection digests are never projected (§48)');
    /* -------------------------------- §13 import creates DRAFT products only */
    response = await request(app).post(`/api/v1/admin/catalog-imports/${firstJob.id}/import`).set(auth).send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.data.replayed, false);
    assert.equal(response.body.data.job.status, 'COMPLETED');
    assert.deepEqual(response.body.data.job.counters, {
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
      createdRows: 3,
      updatedRows: 0,
      skippedRows: 0,
      failedRows: 0,
    });
    assert.ok(response.body.data.job.startedAt && response.body.data.job.completedAt, 'a finished job is stamped at both ends');

    const created = await Product.find({}).sort({ createdAt: 1 }).lean();
    assert.equal(created.length, 3);
    for (const product of created) {
      assert.equal(product.status, 'DRAFT', 'a CSV import must never publish (§13)');
      assert.equal(product.fulfillmentType, 'DROPSHIP');
      assert.equal(product.sourceType, 'SUPPLIER_CSV');
      assert.equal(product.stock, 0, 'supplier stock is never written into owned stock (§24)');
      assert.equal(product.price, 0, 'no pricing was requested, so no selling price was invented (§15)');
      assert.equal(product.sellingPriceOverridden, false);
      assert.ok(/^MK-[0-9A-F]{10}$/.test(String(product.sku)), `${product.sku} must be a server-controlled MansooriKart SKU (§5)`);
      assert.ok(!String(product.sku).includes('ABC-'), 'a supplier SKU is never the MansooriKart identity (§5)');
      assert.equal(product.publishedAt ?? null, null);
    }
    // §24, §29: a supplier feed is advisory data, never owned inventory.
    assert.equal(await InventoryBalance.countDocuments(), 0, 'no InventoryBalance may represent supplier stock');
    assert.equal(await InventoryMovement.countDocuments(), 0, 'a supplier feed is not an InventoryMovement (§28)');

    const sources = await SupplierCatalogItem.find({}).sort({ supplierCost: 1 }).lean();
    assert.equal(sources.length, 3);
    const mouseSource = sources.find((item: any) => item.supplierSku === 'ABC-882819');
    assert.equal(mouseSource.supplierCost, 2000);
    assert.equal(mouseSource.supplierStock, 50);
    assert.equal(mouseSource.supplierAvailability, 'IN_STOCK');
    assert.ok(mouseSource.supplierStockUpdatedAt, 'the age of a supplier stock figure is always recorded (§25)');
    assert.ok(mouseSource.sourceRowHash, 'a change-detection digest is stored internally');
    assert.equal(String(mouseSource.supplier), String(supplier._id));

    /* ------------------------------------- §23 a DRAFT is not publicly visible */
    const draftId = String(created[0]._id);
    assert.equal((await request(app).get('/api/v1/products')).body.data.length, 0, 'the storefront must not list DRAFT products');
    assert.equal((await request(app).get(`/api/v1/products/${draftId}`)).status, 404, 'a DRAFT product is not publicly readable');
    assert.equal((await request(app).get(`/api/v1/products?search=Supplier Wireless`)).body.data.length, 0);
    /* -------------------------------------------------- §50 bounded audit trail */
    const auditActions = async (resourceId: string) => (await AuditLog.find({ resourceId }).lean()).map((entry: any) => entry.action).sort();
    assert.deepEqual(await auditActions(firstJob.id), ['CATALOG_IMPORT_COMPLETED', 'CATALOG_IMPORT_MAPPED', 'CATALOG_IMPORT_UPLOADED']);
    const auditText = JSON.stringify(await AuditLog.find({}).lean());
    assert.ok(!auditText.includes('A quiet mouse'), 'audit entries must not carry CSV row bodies (§50)');
    assert.ok(!auditText.includes(HEADERS), 'audit entries must not carry the CSV file (§50)');
    const uploadedAudit = await AuditLog.findOne({ action: 'CATALOG_IMPORT_UPLOADED' }).lean();
    assert.equal(uploadedAudit.metadata.totalRows, 3);
    assert.equal(String(uploadedAudit.actor), String(admin._id));

    /* ------------------------------------ §44, §45 retry and concurrent import */
    response = await request(app).post(`/api/v1/admin/catalog-imports/${firstJob.id}/import`).set(auth).send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.data.replayed, true, 'a retried import replays its result instead of importing again');
    assert.equal(await Product.countDocuments(), 3, 'a retry must never double-create products');
    assert.equal(await SupplierCatalogItem.countDocuments(), 3);

    const raceFeed = [HEADERS, 'RACE-1,Race one,d,1000,4,Accessories,Logi,,', 'RACE-2,Race two,d,1200,4,Accessories,Logi,,'].join('\n');
    response = await upload(raceFeed);
    const raceJobId = response.body.data.job.id;
    await request(app).post(`/api/v1/admin/catalog-imports/${raceJobId}/mapping`).set(auth).send({ entries: MAPPING });
    const [raceA, raceB] = await Promise.all([
      request(app).post(`/api/v1/admin/catalog-imports/${raceJobId}/import`).set(auth).send({}),
      request(app).post(`/api/v1/admin/catalog-imports/${raceJobId}/import`).set(auth).send({}),
    ]);
    const outcomes = [raceA, raceB].map(reply => (reply.status === 200 ? (reply.body.data.replayed ? 'REPLAYED' : 'IMPORTED') : reply.body.error.code));
    assert.equal(outcomes.filter(outcome => outcome === 'IMPORTED').length, 1, `exactly one attempt may import: ${outcomes.join(',')}`);
    assert.ok(
      outcomes.every(outcome => ['IMPORTED', 'REPLAYED', 'IMPORT_IN_PROGRESS'].includes(outcome)),
      `a losing attempt is refused or replayed, never a second import: ${outcomes.join(',')}`
    );
    assert.equal(await Product.countDocuments({ name: { $in: ['Race one', 'Race two'] } }), 2, 'two concurrent imports have one logical effect (§45)');
    assert.equal(await SupplierCatalogItem.countDocuments({ supplierSku: { $in: ['RACE-1', 'RACE-2'] } }), 2);

    /* ------------------------------------------ §7, §47, §54 invalid row matrix */
    const badFeed = [
      HEADERS,
      ',No supplier sku,d,100,1,Cat,Br,,',
      'BAD-2,,d,100,1,Cat,Br,,',
      'BAD-3,No cost,d,,1,Cat,Br,,',
      'BAD-4,Bad cost,d,not-a-number,1,Cat,Br,,',
      'BAD-5,Negative cost,d,-50,1,Cat,Br,,',
      'BAD-6,Huge cost,d,999999999999,1,Cat,Br,,',
      'BAD-7,Negative stock,d,100,-5,Cat,Br,,',
      'BAD-8,Bad stock,d,100,many,Cat,Br,,',
      'BAD-9,Too few cells,d,100',
      'BAD-10,Good row,d,100,1,Cat,Br,,',
    ].join('\n');
    const bad = await runFeed(badFeed);
    assert.equal(bad.job.status, 'PARTIAL', 'a run with failed rows is never reported COMPLETED (§54)');
    assert.equal(bad.job.counters.totalRows, 10);
    assert.equal(bad.job.counters.invalidRows, 9);
    assert.equal(bad.job.counters.createdRows, 1);
    assert.equal(bad.job.counters.validRows, 1);
    const badRows = await rowsOf(bad.jobId);
    const badCodes = new Set(badRows.flatMap(codesOf));
    for (const code of [
      'SUPPLIER_SKU_REQUIRED',
      'NAME_REQUIRED',
      'COST_REQUIRED',
      'COST_INVALID',
      'COST_NEGATIVE',
      'COST_TOO_LARGE',
      'STOCK_NEGATIVE',
      'STOCK_INVALID',
      'ROW_CELL_COUNT',
    ])
      assert.ok(badCodes.has(code), `the row report must name ${code} (§7, §47)`);
    // §7: diagnostics answer which row and which supplier SKU, in stable codes.
    const cellCountRow = badRows.find((row: any) => codesOf(row).includes('ROW_CELL_COUNT'));
    assert.equal(cellCountRow.rowNumber, 10);
    assert.equal(cellCountRow.supplierSku, 'BAD-9');
    assert.equal(cellCountRow.result, 'INVALID');
    assert.equal(cellCountRow.action, 'FAIL');
    assert.ok(!JSON.stringify(badRows).includes('CsvFormatError'), 'no parser internals leak into row diagnostics (§7)');
    assert.equal((await rowsOf(bad.jobId, '&result=CREATED')).length, 1);
    assert.equal((await rowsOf(bad.jobId, '&result=INVALID')).length, 9);
    assert.ok(bad.job.errorSummary.length >= 5, 'the job carries a bounded error summary');
    assert.ok(bad.job.errorSummary.every((entry: any) => typeof entry.count === 'number' && entry.code));
    assert.equal(await Product.countDocuments({ name: 'Good row' }), 1, 'a valid row still lands beside failing rows');
    assert.equal(await Product.countDocuments({ name: 'Bad cost' }), 0, 'an invalid row creates nothing');

    const hopeless = await runFeed([HEADERS, 'H-1,,d,,1,Cat,Br,,', 'H-2,,d,,1,Cat,Br,,'].join('\n'));
    assert.equal(hopeless.job.status, 'FAILED', 'a run where nothing landed is FAILED, not PARTIAL (§54)');
    assert.equal(hopeless.job.counters.createdRows, 0);

    /* ------------------------------- §46 duplicate supplier SKU within one file */
    const dupe = await runFeed([HEADERS, 'DUP-1,First spelling,d,500,1,Cat,Br,,', 'DUP-1,Second spelling,d,900,2,Cat,Br,,'].join('\n'));
    assert.equal(dupe.job.status, 'FAILED');
    const dupeRows = await rowsOf(dupe.jobId);
    assert.equal(dupeRows.length, 2);
    for (const row of dupeRows) {
      assert.ok(codesOf(row).includes('SUPPLIER_SKU_DUPLICATE'), 'both occurrences are flagged rather than one silently winning (§46)');
      assert.equal(row.result, 'INVALID');
    }
    assert.equal(await Product.countDocuments({ name: { $in: ['First spelling', 'Second spelling'] } }), 0);
    assert.equal(await SupplierCatalogItem.countDocuments({ supplierSku: 'DUP-1' }), 0);
    /* --------------- §14, §19, §26, §27, §28 repeated imports of the same SKU */
    const mouseProductId = String((await SupplierCatalogItem.findOne({ supplierSku: 'ABC-882819' }).lean()).product);
    response = await request(app).patch(`/api/v1/admin/products/${mouseProductId}`).set(auth).send({ name: 'Curated mouse name', price: 3500 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal((await Product.findById(mouseProductId).lean()).sellingPriceOverridden, true, 'a hand-set price is marked as an override (§19)');

    const feedV2 = [HEADERS, 'ABC-882819,Supplier renamed mouse,New supplier blurb,2400,0,Accessories,Logi,https://cdn.supplier.test/mouse.png,3500'].join(
      '\n'
    );
    const repeat = await runFeed(feedV2);
    assert.equal(repeat.job.status, 'COMPLETED');
    assert.equal(repeat.job.counters.updatedRows, 1);
    assert.equal(repeat.job.counters.createdRows, 0, 'the same supplier SKU must never create a second product (§26)');
    assert.equal(await SupplierCatalogItem.countDocuments({ supplierSku: 'ABC-882819' }), 1);
    assert.equal(await Product.countDocuments({ _id: mouseProductId }), 1);

    const [repeatRow] = await rowsOf(repeat.jobId);
    assert.equal(repeatRow.result, 'UPDATED');
    assert.deepEqual(repeatRow.changes.cost, { oldCost: 2000, newCost: 2400, difference: 400, percentChange: 20 }, '§27 reports the cost movement');
    assert.deepEqual(repeatRow.changes.stock, { oldStock: 50, newStock: 0 }, '§28 reports the stock movement');
    assert.deepEqual(repeatRow.changes.availability, { oldAvailability: 'IN_STOCK', newAvailability: 'OUT_OF_STOCK' });
    assert.equal(repeatRow.changes.sellingPricePreserved, true);
    assert.equal(await InventoryMovement.countDocuments(), 0, 'a supplier stock change is not an InventoryMovement (§28)');

    let mouseProduct = await Product.findById(mouseProductId).lean();
    assert.equal(mouseProduct.name, 'Curated mouse name', 'a feed must not overwrite a curated title (§14)');
    assert.equal(mouseProduct.price, 3500, 'a manual selling price survives a cost import (§19)');
    assert.equal(mouseProduct.status, 'DRAFT', 'an update never publishes (§13)');
    assert.equal(mouseProduct.costPrice, 2400, 'the supplier cost mirror follows the feed');
    const refreshed = await SupplierCatalogItem.findOne({ supplierSku: 'ABC-882819' }).lean();
    assert.equal(refreshed.supplierCost, 2400);
    assert.equal(refreshed.supplierAvailability, 'OUT_OF_STOCK');
    assert.ok(String(refreshed.lastImportJob) === repeat.jobId, 'the sourcing row names the import that last touched it');
    const costAudit = await AuditLog.findOne({ action: 'CATALOG_IMPORT_COST_CHANGES', resourceId: repeat.jobId }).lean();
    assert.equal(costAudit.metadata.count, 1, 'a cost move beyond the threshold is audited once for the job (§50)');
    assert.equal(costAudit.metadata.thresholdPercent, 10);

    // §26: re-uploading the identical file is a no-op, not a cascade of pointless writes.
    const unchanged = await runFeed(feedV2);
    assert.equal(unchanged.job.status, 'COMPLETED');
    assert.equal(unchanged.job.counters.skippedRows, 1);
    assert.equal(unchanged.job.counters.updatedRows, 0);
    assert.equal((await rowsOf(unchanged.jobId))[0].changes.unchanged, true);

    // §14: an explicit opt-in is the only way a feed may rewrite a curated field.
    const feedV3 = [HEADERS, 'ABC-882819,Supplier owns this title,Blurb three,2450,7,Accessories,Logi,https://cdn.supplier.test/mouse.png,3500'].join('\n');
    await runFeed(feedV3, { allowFieldOverwrite: { name: true } });
    mouseProduct = await Product.findById(mouseProductId).lean();
    assert.equal(mouseProduct.name, 'Supplier owns this title');
    assert.equal(mouseProduct.price, 3500, 'even an opted-in overwrite never moves the selling price (§15, §19)');
    /* ------------------------- §21, §25, §42 supplier-source visibility */
    const listSources = (query = '') => request(app).get(`/api/v1/admin/supplier-sources?${query}`).set(auth);
    assert.equal((await request(app).get('/api/v1/admin/supplier-sources')).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/supplier-sources').set('Authorization', `Bearer ${customerToken}`)).status, 403);
    response = await listSources(`supplierId=${String(supplier._id)}&limit=100`);
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.staleAfterHours, SUPPLIER_STOCK_STALE_AFTER_HOURS);
    assert.ok(!JSON.stringify(response.body).includes('sourceRowHash'), 'an internal digest is never projected (§48)');
    const mouseView = response.body.data.find((item: any) => item.supplierSku === 'ABC-882819');
    assert.equal(mouseView.supplierCost, 2450);
    assert.equal(mouseView.supplierStock, 7);
    assert.equal(mouseView.isSupplierStockStale, false, 'a freshly imported figure is not stale (§25)');
    assert.equal(mouseView.staleAfterHours, SUPPLIER_STOCK_STALE_AFTER_HOURS);
    assert.equal(mouseView.product.sellingPrice, 3500);
    assert.equal(mouseView.product.sellingPriceOverridden, true);
    assert.equal(mouseView.product.fulfillmentType, 'DROPSHIP');
    assert.equal(mouseView.margin.grossUnitMargin, 1050, '§21 shows supplier cost, selling price and margin together');
    assert.equal(mouseView.margin.grossMarginPercent, 30);
    assert.equal(mouseView.margin.basis, 'gross merchandise margin', 'margin is labelled, never presented as business profit (§21)');
    assert.equal((await listSources('stale=true&limit=100')).body.data.length, 0, 'nothing is stale immediately after an import');

    // §25: the age of a supplier figure is a first-class fact, so backdating one feed
    // timestamp past the central threshold must flip both the flag and the filter.
    await SupplierCatalogItem.updateOne(
      { supplierSku: 'ABC-882819' },
      { $set: { supplierStockUpdatedAt: new Date(Date.now() - (SUPPLIER_STOCK_STALE_AFTER_HOURS + 2) * 60 * 60 * 1000) } }
    );
    const staleList = (await listSources('stale=true&limit=100')).body.data;
    assert.equal(staleList.length, 1);
    assert.equal(staleList[0].supplierSku, 'ABC-882819');
    assert.equal(staleList[0].isSupplierStockStale, true);
    assert.ok((await listSources('stale=false&limit=100')).body.data.every((item: any) => item.isSupplierStockStale === false));
    assert.equal((await listSources('availability=OUT_OF_STOCK&limit=100')).body.data.length, 1, 'only the headset feed reported zero stock');
    assert.equal((await listSources('supplierSku=ABC-882819')).body.data.length, 1);
    assert.equal((await listSources('sortBy=sourceRowHash')).status, 400, 'sorting is an allowlist, never an arbitrary field (§48)');

    /* §42: the source checkout would pick, stated where an operator can see it. */
    response = await request(app).get(`/api/v1/admin/products/${mouseProductId}/supplier-sources`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.total, 1);
    assert.equal(response.body.data.preferredSourceId, String(refreshed._id), 'one active source is trivially the preferred one');
    assert.equal(response.body.data.staleAfterHours, SUPPLIER_STOCK_STALE_AFTER_HOURS);
    assert.equal((await request(app).get(`/api/v1/admin/products/${new mongoose.Types.ObjectId()}/supplier-sources`).set(auth)).status, 404);
    assert.equal(
      (
        await request(app)
          .get(`/api/v1/admin/supplier-sources/${String(refreshed._id)}`)
          .set(auth)
      ).body.data.supplierSku,
      'ABC-882819'
    );
    assert.equal((await request(app).get(`/api/v1/admin/supplier-sources/${new mongoose.Types.ObjectId()}`).set(auth)).status, 404);
    /* ------------------------------------------------- §55 image URL safety */
    const imageFeed = [
      HEADERS,
      'IMG-1,Metadata image,d,100,1,Cat,Br,http://169.254.169.254/latest/meta-data/,',
      'IMG-2,Script image,d,100,1,Cat,Br,javascript:alert(1),',
      'IMG-3,Loopback image,d,100,1,Cat,Br,http://localhost:5000/internal.png,',
      'IMG-4,Good image,d,100,1,Cat,Br,https://cdn.supplier.test/ok.png,',
    ].join('\n');
    const images = await runFeed(imageFeed);
    assert.equal(images.job.status, 'COMPLETED', 'an unusable image warns, it does not fail the row');
    assert.equal(images.job.counters.createdRows, 4);
    const imageRows = await rowsOf(images.jobId);
    const warningsOf = (row: any) => (row.warnings ?? []).map((entry: any) => entry.code);
    for (const row of imageRows.slice(0, 3)) {
      assert.ok(warningsOf(row).includes('IMAGE_URL_INVALID'), `${row.supplierSku}: an unsafe image URL must be rejected (§55)`);
      assert.ok(warningsOf(row).includes('IMAGE_MISSING'));
      assert.equal(row.result, 'CREATED');
    }
    assert.ok(!warningsOf(imageRows[3]).includes('IMAGE_URL_INVALID'), 'an ordinary https image is accepted');
    const imageProducts = await Product.find({ name: { $in: ['Metadata image', 'Script image', 'Loopback image', 'Good image'] } }).lean();
    assert.equal(imageProducts.length, 4);
    for (const product of imageProducts.filter((item: any) => item.name !== 'Good image')) {
      assert.equal(product.image, PLACEHOLDER_IMAGE_URL, 'a rejected URL becomes a local placeholder, never a remote fetch (§55)');
      assert.equal((product.images ?? []).length, 0);
    }
    assert.equal(imageProducts.find((item: any) => item.name === 'Good image').image, 'https://cdn.supplier.test/ok.png');
    const sourceUrls = (await SupplierCatalogItem.find({ supplierSku: { $in: ['IMG-1', 'IMG-2', 'IMG-3'] } }).lean()).flatMap(
      (item: any) => item.sourceImageUrls
    );
    assert.equal(sourceUrls.length, 0, 'an unsafe URL is not even retained on the sourcing record');

    /* ------------------------------------ cancellation and lifecycle guards */
    const abandoned = await upload(`${HEADERS}\nCAN-1,Cancelled row,d,100,1,Cat,Br,,`);
    const abandonedId = abandoned.body.data.job.id;
    assert.equal((await request(app).post(`/api/v1/admin/catalog-imports/${abandonedId}/import`).set(auth).send({})).body.error.code, 'IMPORT_JOB_NOT_READY');
    response = await request(app).post(`/api/v1/admin/catalog-imports/${abandonedId}/cancel`).set(auth).send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'CANCELLED');
    assert.equal(
      (await request(app).post(`/api/v1/admin/catalog-imports/${abandonedId}/cancel`).set(auth).send({})).body.error.code,
      'IMPORT_JOB_NOT_CANCELLABLE'
    );
    assert.equal(
      (await request(app).post(`/api/v1/admin/catalog-imports/${abandonedId}/mapping`).set(auth).send({ entries: MAPPING })).body.error.code,
      'IMPORT_JOB_NOT_MAPPABLE'
    );
    assert.equal((await request(app).post(`/api/v1/admin/catalog-imports/${abandonedId}/import`).set(auth).send({})).body.error.code, 'IMPORT_JOB_NOT_READY');
    assert.equal(await Product.countDocuments({ name: 'Cancelled row' }), 0, 'a cancelled job imports nothing');
    // A finished import may never be disowned by cancelling it after the fact.
    assert.equal(
      (await request(app).post(`/api/v1/admin/catalog-imports/${firstJob.id}/cancel`).set(auth).send({})).body.error.code,
      'IMPORT_JOB_NOT_CANCELLABLE'
    );
    const unknownJob = new mongoose.Types.ObjectId();
    assert.equal((await request(app).get(`/api/v1/admin/catalog-imports/${unknownJob}`).set(auth)).body.error.code, 'IMPORT_JOB_NOT_FOUND');
    assert.equal((await request(app).get('/api/v1/admin/catalog-imports/not-an-id').set(auth)).status, 400);
    /* ------------------------------------- §52 bounded history and row paging */
    const history = await request(app).get('/api/v1/admin/catalog-imports?page=1&limit=5').set(auth);
    assert.equal(history.status, 200);
    assert.equal(history.body.data.length, 5, 'import history is paginated, never returned whole (§52)');
    assert.equal(history.body.meta.total, 10);
    assert.equal(history.body.meta.totalPages, 2);
    assert.equal(history.body.meta.hasNextPage, true);
    assert.equal(history.body.meta.hasPreviousPage, false);
    assert.equal(
      (await request(app).get('/api/v1/admin/catalog-imports?limit=500').set(auth)).status,
      400,
      'a client may not raise the page size past the cap'
    );
    assert.equal(
      (
        await request(app)
          .get(`/api/v1/admin/catalog-imports?status=PARTIAL&supplierId=${String(supplier._id)}`)
          .set(auth)
      ).body.data.length,
      1,
      'the history is filterable by outcome (§43)'
    );
    assert.equal((await request(app).get('/api/v1/admin/catalog-imports?status=NOPE').set(auth)).status, 400);
    const pagedRows = await request(app).get(`/api/v1/admin/catalog-imports/${bad.jobId}/rows?page=2&limit=4`).set(auth);
    assert.equal(pagedRows.body.data.length, 4);
    assert.equal(pagedRows.body.meta.total, 10);
    assert.equal(pagedRows.body.data[0].rowNumber, 6, 'row diagnostics page in stable row order');
    assert.equal((await request(app).get(`/api/v1/admin/catalog-imports/${bad.jobId}/rows?limit=999`).set(auth)).status, 400);
    const stale = await CatalogImportJob.create({
      jobNumber: 'IMP-STALE-1',
      supplier: supplier._id,
      fileName: 'interrupted.csv',
      fileSize: 12,
      status: 'IMPORTING',
      startedAt: new Date(Date.now() - 61 * 60 * 1000),
      createdBy: admin._id,
    });
    response = await request(app).post(`/api/v1/admin/catalog-imports/${stale._id}/import`).set(auth).send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.data.replayed, true);
    assert.equal(response.body.data.job.status, 'FAILED');
    assert.equal(response.body.data.job.errorSummary[0].code, 'IMPORT_INTERRUPTED');
    assert.equal(await AuditLog.countDocuments({ resourceId: String(stale._id), action: 'CATALOG_IMPORT_STALE_RECOVERED' }), 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
