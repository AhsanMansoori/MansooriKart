/**
 * System operations: the health probes, and the read-only view of the audit trail.
 *
 * Health is asserted from two sides. The liveness probes are checked before a database
 * exists and again while the storefront is closed for maintenance, because a monitor that
 * goes dark during an outage is worse than no monitor. The Super Admin report is then
 * checked key by key: every field is a status, a count or a narrowed label, and the
 * environment name is proven to be narrowed rather than echoed back (§38–40, §72).
 *
 * The audit trail is the existing authority — this suite reads it and proves there is
 * nothing else that can be done with it. Immutability is structural: POST, PUT, PATCH and
 * DELETE against the trail are 404s because no such route was ever written, and the record
 * survives the attempt unchanged. Redaction is asserted against a deliberately hostile
 * entry — the shape a future writer might record by mistake — and the stored document is
 * then re-read to show the secret is still there and merely withheld. That is the
 * difference between suppression and emptiness (§41–42, §72).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { StoreConfiguration } from '../src/models/storeConfiguration.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const memory = () => MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
/** The whole envelope of the Super Admin health report. Nothing else may appear in it. */
const HEALTH_KEYS = ['api', 'checks', 'database', 'databaseState', 'environment', 'status', 'store', 'timestamp', 'uptimeSeconds', 'version'];
/** The whole shape of one published audit entry, and of its resolved actor. */
const ENTRY_KEYS = ['action', 'actor', 'createdAt', 'id', 'metadata', 'requestId', 'resourceId', 'resourceType'];
const ACTOR_KEYS = ['email', 'id', 'name', 'role'];
/**
 * Substrings that must not appear in an operational payload, matched case-insensitively.
 *
 * This list is applied to health responses and to audit payloads whose metadata is
 * ordinary. It is deliberately *not* applied to the redaction test: there, a key named
 * `smtpPassword` is expected back with its name intact and its value replaced, which is
 * how an operator can tell that something was withheld rather than never recorded.
 */
const NEVER = [
  'secret',
  'password',
  'apikey',
  'api_key',
  'credential',
  'bearer',
  'jwt',
  'mongodb://',
  'mongo_uri',
  'process.env',
  'stack',
  'node_modules',
  'at object.',
  'd:\\',
];

/**
 * Reports a fake driver state for the duration of one call.
 *
 * `readyState` is a getter on the connection prototype, so an own property shadows it and
 * `delete` restores it. Collection buffering was latched off when the connection opened, so
 * queries still execute under the stub — which is what makes the degraded branch reachable
 * while the Super Admin reading it can still be authenticated against a live database.
 */
async function withReadyState<T>(state: number, run: () => Promise<T>): Promise<T> {
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => state, configurable: true });
  try {
    return await run();
  } finally {
    delete (mongoose.connection as any).readyState;
  }
}

test('health probes answer without a database and publish nothing about the deployment', { concurrency: false }, async () => {
  /* ------------ §39 liveness answers before there is a database to answer about */
  assert.equal(mongoose.connection.readyState, 0);
  const cold = await request(app).get('/health');
  assert.equal(cold.status, 200);
  assert.deepEqual(cold.body, { status: 'ok' });
  const coldV1 = await request(app).get('/api/v1/health');
  assert.equal(coldV1.status, 200);
  assert.deepEqual(coldV1.body, { success: true, data: { status: 'ok' } });

  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([User.init(), StoreConfiguration.init()]);
    const admin = await User.create({
      name: 'Ops Admin',
      email: 'ops@system.test',
      password: await bcrypt.hash('Sup3r-Admin-Passphrase', 10),
      role: 'SUPER_ADMIN',
    });
    const customer = await User.create({ name: 'Shopper', email: 'shopper@system.test', password: 'unused', role: 'CUSTOMER' });
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);

    /* ------------ §57 the operational report is Super Admin only */
    const anonymous = await request(app).get('/api/v1/admin/system/health');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.code, 'AUTH_UNAUTHORIZED');
    const asCustomer = await request(app).get('/api/v1/admin/system/health').set(auth(ct));
    assert.equal(asCustomer.status, 403);
    assert.equal(asCustomer.body.error.code, 'AUTH_FORBIDDEN');
    // A refused request never reached the handler, so the singleton is still uncreated.
    assert.equal(await StoreConfiguration.countDocuments(), 0);

    /* ------------ §40 the connected report is statuses, counts and labels, and nothing else */
    const healthy = await request(app).get('/api/v1/admin/system/health').set(auth(st));
    assert.equal(healthy.status, 200);
    assert.deepEqual(Object.keys(healthy.body.data).sort(), HEALTH_KEYS);
    assert.equal(healthy.body.data.status, 'ok');
    assert.equal(healthy.body.data.api, 'ok');
    assert.equal(healthy.body.data.database, 'connected');
    assert.equal(healthy.body.data.databaseState, 'connected');
    assert.ok(Number.isInteger(healthy.body.data.uptimeSeconds) && healthy.body.data.uptimeSeconds >= 0);
    assert.ok(['development', 'test', 'production'].includes(healthy.body.data.environment));
    assert.equal(healthy.body.data.version, process.env.APP_VERSION || 'unknown');
    assert.ok(!Number.isNaN(Date.parse(healthy.body.data.timestamp)));
    assert.deepEqual(healthy.body.data.store, { configured: true, maintenanceMode: false });
    assert.deepEqual(healthy.body.data.checks, [
      { name: 'api', status: 'ok' },
      { name: 'database', status: 'ok' },
      { name: 'storeConfiguration', status: 'ok' },
    ]);
    // Reading health initialises the one configuration document, and only ever one.
    assert.equal(await StoreConfiguration.countDocuments(), 1);

    /* ------------ §40 the environment label is narrowed to a known value, never echoed */
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'staging-mongodb://leaked:credential@cluster.example/db';
    let narrowed;
    try {
      narrowed = await request(app).get('/api/v1/admin/system/health').set(auth(st));
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
    assert.equal(narrowed.status, 200);
    assert.equal(narrowed.body.data.environment, 'development');
    assert.ok(!JSON.stringify(narrowed.body).includes('leaked'));
    assert.ok(!JSON.stringify(narrowed.body).includes('cluster.example'));

    /* ------------ §38 maintenance closes the storefront, not the monitors or the console */
    const enable = await request(app).patch('/api/v1/admin/settings/maintenance').set(auth(st)).send({ maintenanceMode: true });
    assert.equal(enable.status, 200);
    const closed = await request(app).get('/api/v1/store/home');
    assert.equal(closed.status, 503);
    assert.equal(closed.body.error.code, 'STORE_MAINTENANCE');
    const duringMaintenance = await request(app).get('/api/v1/admin/system/health').set(auth(st));
    assert.equal(duringMaintenance.status, 200);
    assert.deepEqual(duringMaintenance.body.data.store, { configured: true, maintenanceMode: true });
    const probe = await request(app).get('/health');
    assert.equal(probe.status, 200);
    assert.deepEqual(probe.body, { status: 'ok' });
    const probeV1 = await request(app).get('/api/v1/health');
    assert.equal(probeV1.status, 200);
    assert.deepEqual(probeV1.body, { success: true, data: { status: 'ok' } });

    /* ------------ §72 a driver that is not connected degrades the report, it does not break it */
    const degraded = await withReadyState(2, async () => await request(app).get('/api/v1/admin/system/health').set(auth(st)));
    assert.equal(degraded.status, 200);
    assert.deepEqual(Object.keys(degraded.body.data).sort(), HEALTH_KEYS);
    assert.equal(degraded.body.data.status, 'degraded');
    assert.equal(degraded.body.data.api, 'ok');
    assert.equal(degraded.body.data.database, 'disconnected');
    assert.equal(degraded.body.data.databaseState, 'connecting');
    // With no database the configuration cannot be read, so it is reported as unknown
    // rather than guessed at — and maintenance mode is not asserted either way.
    assert.deepEqual(degraded.body.data.store, { configured: false, maintenanceMode: false });
    assert.deepEqual(degraded.body.data.checks, [
      { name: 'api', status: 'ok' },
      { name: 'database', status: 'fail' },
      { name: 'storeConfiguration', status: 'unknown' },
    ]);
    // A state the driver never reports is labelled, not read off the end of the array.
    const unknownState = await withReadyState(99, async () => await request(app).get('/api/v1/admin/system/health').set(auth(st)));
    assert.equal(unknownState.body.data.databaseState, 'unknown');
    assert.equal(unknownState.body.data.status, 'degraded');
    assert.equal(mongoose.connection.readyState, 1);

    /* ------------ §39 no health payload names a variable, a URI, a key or a stack frame */
    const payloads: [string, string][] = [
      ['/health cold', JSON.stringify(cold.body)],
      ['/api/v1/health cold', JSON.stringify(coldV1.body)],
      ['/health', JSON.stringify(probe.body)],
      ['/api/v1/health', JSON.stringify(probeV1.body)],
      ['admin healthy', JSON.stringify(healthy.body)],
      ['admin narrowed', JSON.stringify(narrowed.body)],
      ['admin maintenance', JSON.stringify(duringMaintenance.body)],
      ['admin degraded', JSON.stringify(degraded.body)],
      ['admin unknown state', JSON.stringify(unknownState.body)],
      ['admin 401', JSON.stringify(anonymous.body)],
      ['admin 403', JSON.stringify(asCustomer.body)],
    ];
    for (const [label, body] of payloads) {
      const lower = body.toLowerCase();
      for (const token of NEVER) assert.ok(!lower.includes(token), `${label} exposed ${token}`);
      assert.ok(!body.includes(mongo.getUri()), `${label} exposed the connection string`);
      assert.ok(!body.includes(process.env.JWT_SECRET!), `${label} exposed the signing secret`);
      assert.ok(!body.includes(String(admin._id)), `${label} exposed an internal identifier`);
      assert.ok(!body.includes('ops@system.test'), `${label} exposed an administrator address`);
    }
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

test('the audit trail reads through bounded allowlisted filters and cannot be written', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([User.init(), AuditLog.init(), StoreConfiguration.init()]);
    const admin = await User.create({
      name: 'Trail Admin',
      email: 'trail@system.test',
      password: await bcrypt.hash('Sup3r-Admin-Passphrase', 10),
      role: 'SUPER_ADMIN',
    });
    const deputy = await User.create({ name: 'Deputy Admin', email: 'deputy@system.test', password: 'unused', role: 'SUPER_ADMIN' });
    const customer = await User.create({ name: 'Shopper', email: 'shopper@system.test', password: 'unused', role: 'CUSTOMER' });
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const dt = jwt.sign({ sub: String(deputy._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const ct = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);

    /* ------------ §41, §59 the trail is fed by real admin writes, and not by no-ops */
    const storeWrite = await request(app).patch('/api/v1/admin/settings/store').set(auth(st)).send({ orderPrefix: 'MKT' });
    assert.equal(storeWrite.status, 200);
    const shippingWrite = await request(app).patch('/api/v1/admin/settings/shipping').set(auth(dt)).send({ standardFee: 300 });
    assert.equal(shippingWrite.status, 200);
    const resubmitted = await request(app).patch('/api/v1/admin/settings/shipping').set(auth(dt)).send({ standardFee: 300 });
    assert.equal(resubmitted.status, 200);
    assert.equal(await AuditLog.countDocuments({ action: 'SETTINGS_UPDATED' }), 2);

    /**
     * Seeded history, with the clock stated rather than inferred: consecutive inserts can
     * share a millisecond, and every ordering and date-range assertion below depends on
     * knowing exactly when each entry was written. The timestamps plugin treats `createdAt`
     * as immutable and strips it from a Mongoose update, so the backdating goes through the
     * driver directly. The two real entries above keep their own time, which makes them the
     * newest in the trail.
     */
    const at = (month: number, day: number) => new Date(Date.UTC(2026, month, day, 9, 30, 0));
    const seed = async (entry: Record<string, unknown>, createdAt: Date) => {
      const record = await AuditLog.create(entry);
      await AuditLog.collection.updateOne({ _id: record._id }, { $set: { createdAt } });
      return record;
    };
    const SEEDS = [
      { action: 'BANNER_CREATED', resourceType: 'Banner', resourceId: 'banner-eid', actor: admin._id, day: 1 },
      { action: 'BANNER_UPDATED', resourceType: 'Banner', resourceId: 'banner-eid', actor: admin._id, day: 2 },
      { action: 'PROMOTION_BANNER_LINKED', resourceType: 'Promotion', resourceId: 'promo-eid', actor: deputy._id, day: 3 },
      { action: 'PROMOTION_CREATED', resourceType: 'Promotion', resourceId: 'promo-eid', actor: deputy._id, day: 4 },
      { action: 'HOMEPAGE_REORDERED', resourceType: 'HomepageConfiguration', resourceId: 'HOME', actor: admin._id, day: 5 },
      { action: 'CMS_PAGE_PUBLISHED', resourceType: 'CmsPage', resourceId: 'page-returns', actor: deputy._id, day: 6 },
      { action: 'COUPON_DISABLED', resourceType: 'Coupon', resourceId: 'coupon-eid20', actor: admin._id, day: 7 },
    ];

    const seeded = [];
    for (const spec of SEEDS)
      seeded.push(
        await seed(
          { actor: spec.actor, action: spec.action, resourceType: spec.resourceType, resourceId: spec.resourceId, metadata: { fields: ['title'] } },
          at(1, spec.day)
        )
      );
    // An actor whose user record is gone must resolve to null, not to a broken object.
    const orphaned = await seed(
      { actor: new mongoose.Types.ObjectId(), action: 'SUPPLIER_SOURCE_DISABLED', resourceType: 'SupplierSource', resourceId: 'src-kwt' },
      at(1, 8)
    );
    // Far enough back to fall outside every bounded window asked for below.
    await seed({ actor: admin._id, action: 'ORDER_REFUNDED', resourceType: 'Order', resourceId: 'MK-000001' }, new Date(Date.UTC(2025, 0, 5, 9, 30, 0)));
    // Twenty ordinary entries, so the default page size is exercised by a second page.
    for (let index = 0; index < 20; index += 1)
      await seed({ actor: admin._id, action: 'PRODUCT_UPDATED', resourceType: 'Product', resourceId: `sku-${index}` }, at(0, index + 1));
    const ALL_ACTIONS = ['SETTINGS_UPDATED', ...SEEDS.map(spec => spec.action), 'SUPPLIER_SOURCE_DISABLED', 'ORDER_REFUNDED', 'PRODUCT_UPDATED'];
    const ALL_RESOURCES = ['StoreConfiguration', ...SEEDS.map(spec => spec.resourceType), 'SupplierSource', 'Order', 'Product'];
    const TOTAL = 2 + SEEDS.length + 1 + 1 + 20;
    assert.equal(await AuditLog.countDocuments(), TOTAL);

    /* ------------ §57 every audit surface is Super Admin only */
    for (const path of ['/api/v1/admin/audit-logs', '/api/v1/admin/audit-logs/actions', `/api/v1/admin/audit-logs/${String(seeded[0]._id)}`]) {
      const anonymous = await request(app).get(path);
      assert.equal(anonymous.status, 401, path);
      assert.equal(anonymous.body.error.code, 'AUTH_UNAUTHORIZED', path);
      const asCustomer = await request(app).get(path).set(auth(ct));
      assert.equal(asCustomer.status, 403, path);
      assert.equal(asCustomer.body.error.code, 'AUTH_FORBIDDEN', path);
    }

    /* ------------ §42 the default page is newest first, bounded, and shaped by an allowlist */
    const first = await request(app).get('/api/v1/admin/audit-logs').set(auth(st));
    assert.equal(first.status, 200);
    assert.equal(first.body.data.length, 20);
    assert.deepEqual(first.body.meta, { page: 1, limit: 20, total: TOTAL, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    assert.deepEqual(
      first.body.data.slice(0, 2).map((entry: any) => entry.action),
      ['SETTINGS_UPDATED', 'SETTINGS_UPDATED']
    );
    for (const entry of first.body.data) assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS);
    const times = first.body.data.map((entry: any) => Date.parse(entry.createdAt));
    for (let index = 1; index < times.length; index += 1) assert.ok(times[index - 1] >= times[index], 'newest first');
    const populated = first.body.data.find((entry: any) => entry.action === 'SETTINGS_UPDATED' && entry.actor?.id === String(deputy._id));
    assert.deepEqual(Object.keys(populated.actor).sort(), ACTOR_KEYS);
    assert.deepEqual(populated.actor, { id: String(deputy._id), name: 'Deputy Admin', email: 'deputy@system.test', role: 'SUPER_ADMIN' });
    assert.equal(populated.resourceType, 'StoreConfiguration');
    assert.equal(populated.resourceId, 'STORE');
    assert.ok(typeof populated.requestId === 'string' || populated.requestId === null);

    /* ------------ §54 pagination is bounded and the pages do not overlap */
    const second = await request(app).get('/api/v1/admin/audit-logs?page=2').set(auth(st));
    assert.equal(second.status, 200);
    assert.equal(second.body.data.length, TOTAL - 20);
    assert.deepEqual(second.body.meta, { page: 2, limit: 20, total: TOTAL, totalPages: 2, hasNextPage: false, hasPreviousPage: true });
    const firstIds = new Set(first.body.data.map((entry: any) => entry.id));
    for (const entry of second.body.data) assert.ok(!firstIds.has(entry.id), 'pages must not overlap');
    const wide = await request(app).get('/api/v1/admin/audit-logs?limit=100').set(auth(st));
    assert.equal(wide.body.data.length, TOTAL);
    assert.equal(wide.body.meta.totalPages, 1);
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'page=0', 'page=-1', 'page=abc']) {
      const rejected = await request(app).get(`/api/v1/admin/audit-logs?${query}`).set(auth(st));
      assert.equal(rejected.status, 400, query);
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', query);
    }

    /* ------------ §55 filters are allowlisted equality, never an operator the caller controls */
    const byAction = await request(app).get('/api/v1/admin/audit-logs?action=BANNER_CREATED').set(auth(st));
    assert.equal(byAction.body.meta.total, 1);
    assert.equal(byAction.body.data[0].resourceId, 'banner-eid');
    const byResourceType = await request(app).get('/api/v1/admin/audit-logs?resourceType=Banner').set(auth(st));
    assert.equal(byResourceType.body.meta.total, 2);
    assert.deepEqual(
      byResourceType.body.data.map((entry: any) => entry.action),
      ['BANNER_UPDATED', 'BANNER_CREATED']
    );
    const byResourceId = await request(app).get('/api/v1/admin/audit-logs?resourceId=promo-eid').set(auth(st));
    assert.equal(byResourceId.body.meta.total, 2);
    const byActor = await request(app)
      .get(`/api/v1/admin/audit-logs?actor=${String(deputy._id)}`)
      .set(auth(st));
    assert.equal(byActor.body.meta.total, 4);
    for (const entry of byActor.body.data) assert.equal(entry.actor.id, String(deputy._id));
    const combined = await request(app).get('/api/v1/admin/audit-logs?action=BANNER_UPDATED&resourceType=Promotion').set(auth(st));
    assert.equal(combined.body.meta.total, 0);
    assert.deepEqual(combined.body.data, []);
    const orphanRead = await request(app).get('/api/v1/admin/audit-logs?action=SUPPLIER_SOURCE_DISABLED').set(auth(st));
    assert.equal(orphanRead.body.meta.total, 1);
    assert.equal(orphanRead.body.data[0].actor, null);
    assert.equal(orphanRead.body.data[0].id, String(orphaned._id));
    assert.deepEqual(orphanRead.body.data[0].metadata, {});

    /* ------------ §55 search is an escaped anchored prefix, not a pattern the caller supplies */
    const prefix = await request(app).get('/api/v1/admin/audit-logs?search=BANNER').set(auth(st));
    assert.equal(prefix.body.meta.total, 2);
    assert.deepEqual(
      prefix.body.data.map((entry: any) => entry.action),
      ['BANNER_UPDATED', 'BANNER_CREATED']
    );
    const lowercase = await request(app).get('/api/v1/admin/audit-logs?search=banner').set(auth(st));
    assert.equal(lowercase.body.meta.total, 2);
    // `PROMOTION_BANNER_LINKED` contains the term but does not begin with it.
    assert.ok(!prefix.body.data.some((entry: any) => entry.action === 'PROMOTION_BANNER_LINKED'));
    for (const term of ['.*', '.%2A', '^BANNER', 'BANNER.%2A', '(BANNER|PRODUCT)', '%5BB%5DANNER']) {
      const literal = await request(app).get(`/api/v1/admin/audit-logs?search=${term}`).set(auth(st));
      assert.equal(literal.status, 200, term);
      assert.equal(literal.body.meta.total, 0, term);
    }
    for (const query of [
      'action[$ne]=BANNER_CREATED',
      'resourceType[$exists]=true',
      'resourceId[$regex]=.*',
      'actor[$ne]=x',
      'actor=not-an-object-id',
      'search[$regex]=.*',
      'sort[$gt]=1',
      'sort=action',
      'limit[$gt]=1',
      'from[$gt]=2020-01-01',
      'metadata=1',
      'select=metadata',
      'unexpected=1',
    ]) {
      const rejected = await request(app).get(`/api/v1/admin/audit-logs?${query}`).set(auth(st));
      assert.equal(rejected.status, 400, query);
      assert.equal(rejected.body.error.code, 'VALIDATION_ERROR', query);
      assert.deepEqual(Object.keys(rejected.body.error).sort(), ['code', 'message'], query);
      assert.ok(!JSON.stringify(rejected.body).toLowerCase().includes('stack'), query);
    }

    /* ------------ §56 the date range is validated as a range, and bounded */
    const window = await request(app).get('/api/v1/admin/audit-logs?from=2026-02-01&to=2026-02-28&limit=100').set(auth(st));
    assert.equal(window.status, 200);
    assert.equal(window.body.meta.total, SEEDS.length + 1);
    for (const entry of window.body.data) {
      const stamp = Date.parse(entry.createdAt);
      assert.ok(stamp >= Date.UTC(2026, 1, 1) && stamp <= Date.UTC(2026, 1, 28), entry.action);
    }
    const openEnded = await request(app).get('/api/v1/admin/audit-logs?from=2026-02-08&limit=100').set(auth(st));
    assert.equal(openEnded.body.meta.total, 3);
    const upTo = await request(app).get('/api/v1/admin/audit-logs?to=2025-12-31&limit=100').set(auth(st));
    assert.equal(upTo.body.meta.total, 1);
    assert.equal(upTo.body.data[0].action, 'ORDER_REFUNDED');
    const inverted = await request(app).get('/api/v1/admin/audit-logs?from=2026-02-05&to=2026-02-01').set(auth(st));
    assert.equal(inverted.status, 400);
    assert.equal(inverted.body.error.code, 'VALIDATION_ERROR');
    // 366 days is the widest accepted span; one more day is refused.
    const widest = await request(app).get('/api/v1/admin/audit-logs?from=2026-01-01&to=2027-01-02').set(auth(st));
    assert.equal(widest.status, 200);
    const tooWide = await request(app).get('/api/v1/admin/audit-logs?from=2026-01-01&to=2027-01-03').set(auth(st));
    assert.equal(tooWide.status, 400);
    assert.equal(tooWide.body.error.code, 'VALIDATION_ERROR');
    const unparsable = await request(app).get('/api/v1/admin/audit-logs?from=not-a-date').set(auth(st));
    assert.equal(unparsable.status, 400);

    /* ------------ §42 sort selects one of two fixed orders */
    const oldest = await request(app).get('/api/v1/admin/audit-logs?sort=oldest&limit=100').set(auth(st));
    assert.equal(oldest.status, 200);
    assert.equal(oldest.body.data[0].action, 'ORDER_REFUNDED');
    assert.equal(oldest.body.data[TOTAL - 1].action, 'SETTINGS_UPDATED');
    const ascending = oldest.body.data.map((entry: any) => Date.parse(entry.createdAt));
    for (let index = 1; index < ascending.length; index += 1) assert.ok(ascending[index - 1] <= ascending[index], 'oldest first');

    /* ------------ §42 the action vocabulary is a bounded sorted set, not a route parameter */
    const vocabulary = await request(app).get('/api/v1/admin/audit-logs/actions').set(auth(st));
    assert.equal(vocabulary.status, 200);
    assert.deepEqual(Object.keys(vocabulary.body.data).sort(), ['actions', 'resourceTypes']);
    assert.deepEqual(vocabulary.body.data.actions, [...new Set(ALL_ACTIONS)].sort());
    assert.deepEqual(vocabulary.body.data.resourceTypes, [...new Set(ALL_RESOURCES)].sort());

    /* ------------ §41 one entry reads back, and a bad identifier is a clean 404 */
    const sample = String(seeded[0]._id);
    const detail = await request(app).get(`/api/v1/admin/audit-logs/${sample}`).set(auth(st));
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.body.data).sort(), ENTRY_KEYS);
    assert.equal(detail.body.data.id, sample);
    assert.equal(detail.body.data.action, 'BANNER_CREATED');
    assert.deepEqual(detail.body.data.metadata, { fields: ['title'] });
    const malformed = await request(app).get('/api/v1/admin/audit-logs/not-an-object-id').set(auth(st));
    const absent = await request(app)
      .get(`/api/v1/admin/audit-logs/${String(new mongoose.Types.ObjectId())}`)
      .set(auth(st));
    const hostileId = await request(app).get('/api/v1/admin/audit-logs/%7B%22%24ne%22%3A1%7D').set(auth(st));
    for (const response of [malformed, absent, hostileId]) {
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'AUDIT_LOG_NOT_FOUND');
      assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message']);
      const lower = JSON.stringify(response.body).toLowerCase();
      assert.ok(!lower.includes('cast'));
      assert.ok(!lower.includes('stack'));
      assert.ok(!lower.includes('objectid'));
    }
    // A malformed identifier is indistinguishable from an absent one.
    assert.deepEqual(malformed.body.error, absent.body.error);

    /* ------------ §41 the trail has no write surface: not create, not edit, not delete */
    const before = await AuditLog.countDocuments();
    const attempts: ['post' | 'put' | 'patch' | 'delete', string][] = [
      ['post', '/api/v1/admin/audit-logs'],
      ['put', `/api/v1/admin/audit-logs/${sample}`],
      ['patch', `/api/v1/admin/audit-logs/${sample}`],
      ['delete', `/api/v1/admin/audit-logs/${sample}`],
      ['delete', '/api/v1/admin/audit-logs'],
      ['post', '/api/v1/admin/audit-logs/purge'],
    ];
    for (const [method, path] of attempts) {
      const response = await request(app)[method](path).set(auth(st)).send({ action: 'REWRITTEN', metadata: {} });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.body.error.code, 'NOT_FOUND', `${method} ${path}`);
    }
    assert.equal(await AuditLog.countDocuments(), before);
    const untouched: any = await AuditLog.findById(sample).lean();
    assert.equal(untouched.action, 'BANNER_CREATED');
    assert.equal(untouched.resourceId, 'banner-eid');

    /* ------------ §42 nothing in the trail's own payload names a secret or Mongo bookkeeping */
    for (const [label, body] of [
      ['list', JSON.stringify(first.body)],
      ['page 2', JSON.stringify(second.body)],
      ['detail', JSON.stringify(detail.body)],
      ['vocabulary', JSON.stringify(vocabulary.body)],
      ['404', JSON.stringify(malformed.body)],
    ] as [string, string][]) {
      const lower = body.toLowerCase();
      for (const token of NEVER) assert.ok(!lower.includes(token), `${label} exposed ${token}`);
      assert.ok(!body.includes('"_id"'), `${label} exposed _id`);
      assert.ok(!body.includes('"__v"'), `${label} exposed __v`);
      assert.ok(!body.includes(mongo.getUri()), `${label} exposed the connection string`);
      assert.ok(!body.includes(process.env.JWT_SECRET!), `${label} exposed the signing secret`);
    }
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});

/**
 * Keys a careless writer might record. Each is expected back with its name intact and its
 * value replaced: an operator needs to see that a field existed, never what was in it.
 */
const SENSITIVE: Record<string, string> = {
  password: 'value-password',
  smtpPassword: 'value-smtp',
  passwordHash: 'value-hash',
  authorization: 'value-authorization',
  cookie: 'value-cookie',
  apiKey: 'value-apikey',
  api_key: 'value-api-key',
  'x-api-key': 'value-x-api-key',
  accessToken: 'value-access-token',
  refreshToken: 'value-refresh-token',
  jwtSecret: 'value-jwt-secret',
  clientSecret: 'value-client-secret',
  mongoUri: 'value-mongo-uri',
  connectionString: 'value-connection-string',
  privateKey: 'value-private-key',
  signature: 'value-signature',
  sessionId: 'value-session-id',
  otp: 'value-otp',
  salt: 'value-salt',
  rawCsv: 'value-raw-csv',
  csvBody: 'value-csv-body',
  fileBody: 'value-file-body',
  envVars: 'value-env-vars',
  supplierCredential: 'value-supplier-credential',
};
/** Ordinary operational context, which must survive untouched. */
const SAFE = { section: 'shipping', fields: ['standardFee', 'codEnabled'], count: 3, enabled: true, previous: null, note: 'Fee raised for the northern zone.' };

test('audit metadata is redacted and bounded on the way out, and the record itself is untouched', { concurrency: false }, async () => {
  const mongo = await memory();
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([User.init(), AuditLog.init()]);
    const admin = await User.create({
      name: 'Trail Admin',
      email: 'trail@system.test',
      password: await bcrypt.hash('Sup3r-Admin-Passphrase', 10),
      role: 'SUPER_ADMIN',
    });
    const st = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);

    const hostile = await AuditLog.create({
      actor: admin._id,
      action: 'SETTINGS_UPDATED',
      resourceType: 'StoreConfiguration',
      resourceId: 'STORE',
      metadata: {
        ...SENSITIVE,
        ...SAFE,
        nested: { level: { smtpPassword: 'value-nested-smtp' } },
        deep: { a: { b: { c: { smtpPassword: 'value-deep-smtp' } } } },
      },
    });
    const bounded = await AuditLog.create({
      actor: admin._id,
      action: 'CATALOG_IMPORT_COMMITTED',
      resourceType: 'CatalogImportJob',
      metadata: {
        items: Array.from({ length: 25 }, (_, index) => `item-${index}`),
        wide: Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`k${String(index).padStart(2, '0')}`, index])),
        long: 'L'.repeat(600),
        at: new Date('2026-02-01T09:30:00.000Z'),
      },
    });
    const scalar = await AuditLog.create({
      actor: admin._id,
      action: 'LEGACY_TOUCHED',
      resourceType: 'Legacy',
      metadata: 'a raw string a writer passed by mistake',
    });
    const listed = await AuditLog.create({ actor: admin._id, action: 'LEGACY_LISTED', resourceType: 'Legacy', metadata: ['first', 'second'] });
    const empty = await AuditLog.create({ actor: admin._id, action: 'LEGACY_EMPTY', resourceType: 'Legacy' });

    /* ------------ §42 every sensitive key comes back named and emptied */
    const detail = await request(app)
      .get(`/api/v1/admin/audit-logs/${String(hostile._id)}`)
      .set(auth(st));
    assert.equal(detail.status, 200);
    for (const key of Object.keys(SENSITIVE)) assert.equal(detail.body.data.metadata[key], '[REDACTED]', key);
    assert.equal(detail.body.data.metadata.nested.level.smtpPassword, '[REDACTED]');
    // Structure beyond the depth bound is summarised, so its contents cannot escape either.
    assert.equal(detail.body.data.metadata.deep.a.b.c, '[TRUNCATED]');

    /* ------------ §42 ordinary operational context survives redaction unchanged */
    for (const [key, value] of Object.entries(SAFE)) assert.deepEqual(detail.body.data.metadata[key], value, key);
    assert.deepEqual(Object.keys(detail.body.data.metadata).sort(), [...Object.keys(SENSITIVE), ...Object.keys(SAFE), 'nested', 'deep'].sort());

    /* ------------ §42 redaction is applied on the list route as well as the detail route */
    const list = await request(app).get('/api/v1/admin/audit-logs?action=SETTINGS_UPDATED').set(auth(st));
    assert.equal(list.status, 200);
    assert.equal(list.body.meta.total, 1);
    for (const key of Object.keys(SENSITIVE)) assert.equal(list.body.data[0].metadata[key], '[REDACTED]', key);

    /* ------------ §42 one pathological entry cannot dominate a page of results */
    const boundedRead = await request(app)
      .get(`/api/v1/admin/audit-logs/${String(bounded._id)}`)
      .set(auth(st));
    assert.equal(boundedRead.status, 200);
    const metadata = boundedRead.body.data.metadata;
    assert.equal(metadata.items.length, 21);
    assert.equal(metadata.items[19], 'item-19');
    assert.equal(metadata.items[20], '[5 more]');
    for (const dropped of ['item-20', 'item-21', 'item-22', 'item-23', 'item-24']) assert.ok(!JSON.stringify(metadata).includes(dropped), dropped);
    assert.equal(Object.keys(metadata.wide).length, 41);
    assert.equal(metadata.wide.k39, 39);
    assert.equal(metadata.wide.k40, undefined);
    assert.equal(metadata.wide['[truncated]'], '5 more keys');
    assert.equal(metadata.long.length, 513);
    assert.ok(metadata.long.endsWith('…'));
    assert.equal(metadata.at, '2026-02-01T09:30:00.000Z');

    /* ------------ §42 metadata that is not an object is still published as one */
    const scalarRead = await request(app)
      .get(`/api/v1/admin/audit-logs/${String(scalar._id)}`)
      .set(auth(st));
    assert.deepEqual(scalarRead.body.data.metadata, { value: 'a raw string a writer passed by mistake' });
    const listedRead = await request(app)
      .get(`/api/v1/admin/audit-logs/${String(listed._id)}`)
      .set(auth(st));
    assert.deepEqual(listedRead.body.data.metadata, { value: ['first', 'second'] });
    const emptyRead = await request(app)
      .get(`/api/v1/admin/audit-logs/${String(empty._id)}`)
      .set(auth(st));
    assert.deepEqual(emptyRead.body.data.metadata, {});

    /* ------------ §42 the value is withheld, not lost: the stored record still holds it */
    const stored: any = await AuditLog.findById(hostile._id).lean();
    assert.equal(stored.metadata.smtpPassword, 'value-smtp');
    assert.equal(stored.metadata.nested.level.smtpPassword, 'value-nested-smtp');
    assert.equal(stored.metadata.deep.a.b.c.smtpPassword, 'value-deep-smtp');
    const storedBounded: any = await AuditLog.findById(bounded._id).lean();
    assert.equal(storedBounded.metadata.items.length, 25);
    assert.equal(storedBounded.metadata.long.length, 600);

    /* ------------ §42 no withheld value appears anywhere in any payload */
    const withheld = [...Object.values(SENSITIVE), 'value-nested-smtp', 'value-deep-smtp'];
    for (const [label, body] of [
      ['detail', JSON.stringify(detail.body)],
      ['list', JSON.stringify(list.body)],
      ['bounded', JSON.stringify(boundedRead.body)],
    ] as [string, string][])
      for (const value of withheld) assert.ok(!body.includes(value), `${label} exposed ${value}`);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
