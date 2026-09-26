import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Cart } from '../src/models/cart.js';
import { DropshipFulfillment } from '../src/models/dropshipFulfillment.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { Supplier } from '../src/models/supplier.js';
import { SupplierCatalogItem } from '../src/models/supplierCatalogItem.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('a mixed order splits into supplier obligations without touching owned inventory', { concurrency: false }, async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Supplier.init(), SupplierCatalogItem.init(), DropshipFulfillment.init(), Product.init(), Order.init()]);
    const admin = await User.create({ name: 'Admin', email: 'ff-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' });
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };
    const shopper = async (email: string) => {
      const user = await User.create({ name: email, email, password: 'Secret123!', role: 'CUSTOMER' });
      const address = await Address.create({ user: user._id, fullName: 'N', phone: '1', addressLine1: 'A', city: 'C', country: 'PK' });
      return { user, address, token: jwt.sign({ sub: String(user._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!) };
    };
    const checkout = (buyer: any, key: string) =>
      request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${buyer.token}`)
        .set('Idempotency-Key', key)
        .send({ addressId: String(buyer.address._id), paymentMethod: 'CASH_ON_DELIVERY' });
    const [alphaSupplier, betaSupplier] = await Supplier.create([
      { name: 'Alpha Supplier', code: 'FF-A', email: 'alpha@supplier.test', phone: '111' },
      { name: 'Beta Supplier', code: 'FF-B' },
    ]);
    const product = async (name: string, extra: Record<string, unknown> = {}) =>
      Product.create({
        name,
        slug: name.toLowerCase().replaceAll(' ', '-'),
        sku: `MK-${name.replaceAll(' ', '').toUpperCase().slice(0, 11)}`,
        description: name,
        category: 'Accessories',
        image: 'https://cdn.example.com/p.png',
        price: 1000,
        stock: 0,
        status: 'ACTIVE',
        ...extra,
      });
    const source = (supplier: any, item: any, extra: Record<string, unknown> = {}) =>
      SupplierCatalogItem.create({
        supplier: supplier._id,
        product: item._id,
        supplierSku: `SS-${String(item._id).slice(-6)}`,
        supplierProductName: item.name,
        supplierCost: 600,
        supplierStock: 20,
        supplierAvailability: 'IN_STOCK',
        supplierStockUpdatedAt: new Date(),
        isActive: true,
        ...extra,
      });

    /* ------------------- §39 owned stock behaves exactly as it did before Phase G */
    const owned = await product('Owned widget', { stock: 5, costPrice: 400, fulfillmentType: 'OWN_STOCK' });
    const ownBuyer = await shopper('own@ff.test');
    await Cart.create({ user: ownBuyer.user._id, items: [{ product: owned._id, quantity: 2 }] });
    let response = await checkout(ownBuyer, 'own-stock-checkout-1');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const ownOrder = await Order.findById(response.body.data._id).lean();
    assert.equal((await Product.findById(owned._id).lean()).stock, 3, 'an owned-stock line still decrements the warehouse mirror (§39)');
    const ownMovements = await InventoryMovement.find({ product: owned._id }).lean();
    assert.equal(ownMovements.length, 1, 'and still writes exactly one InventoryMovement (§39)');
    assert.equal(ownMovements[0].type, 'ORDER');
    assert.equal(ownOrder.items[0].fulfillmentType, 'OWN_STOCK');
    assert.equal(ownOrder.items[0].unitCost, 400, 'own stock keeps costing from Product.costPrice (§57)');
    assert.equal(ownOrder.items[0].lineCost, 800);
    assert.equal(ownOrder.items[0].supplier ?? null, null, 'an owned line has no supplier snapshot');
    assert.equal(await DropshipFulfillment.countDocuments({ order: ownOrder._id }), 0, 'an owned-stock order creates no supplier obligation (§29)');
    // Cancelling restores the warehouse exactly as before.
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/orders/${String(ownOrder._id)}/cancel`)
          .set('Authorization', `Bearer ${ownBuyer.token}`)
          .send({})
      ).status,
      200
    );
    assert.equal((await Product.findById(owned._id).lean()).stock, 5, 'cancellation restocks owned inventory (§39)');
    assert.equal((await InventoryMovement.find({ product: owned._id }).lean()).length, 2);

    /* ---------------------- §30, §32, §34 a mixed order across two suppliers */
    const alphaOne = await product('Alpha mouse', { fulfillmentType: 'DROPSHIP', price: 2500, costPrice: 600 });
    const alphaTwo = await product('Alpha pad', { fulfillmentType: 'DROPSHIP', price: 800, costPrice: 300 });
    const betaOne = await product('Beta cable', { fulfillmentType: 'DROPSHIP', price: 1200, costPrice: 500 });
    await source(alphaSupplier, alphaOne);
    await source(alphaSupplier, alphaTwo, { supplierCost: 300 });
    await source(betaSupplier, betaOne, { supplierCost: 500 });
    const mixedBuyer = await shopper('mixed@ff.test');
    await Cart.create({
      user: mixedBuyer.user._id,
      items: [
        { product: owned._id, quantity: 1 },
        { product: alphaOne._id, quantity: 2 },
        { product: alphaTwo._id, quantity: 1 },
        { product: betaOne._id, quantity: 3 },
      ],
    });
    response = await checkout(mixedBuyer, 'mixed-checkout-1');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const mixedId = String(response.body.data._id);
    const mixed = await Order.findById(mixedId).lean();
    assert.equal(mixed.items.length, 4);
    assert.deepEqual(
      mixed.items.map((item: any) => item.fulfillmentType),
      ['OWN_STOCK', 'DROPSHIP', 'DROPSHIP', 'DROPSHIP'],
      'each line records which shelf it ships from (§30)'
    );
    assert.equal((await Product.findById(owned._id).lean()).stock, 4, 'only the owned line moved warehouse stock (§29)');
    for (const item of mixed.items.slice(1))
      assert.equal(await InventoryMovement.countDocuments({ product: item.productId }), 0, 'a dropship line never produces an InventoryMovement (§28, §29)');
    // §30: the supplier snapshot lives on the line, cost included, for finance.
    const alphaLine = mixed.items[1];
    assert.equal(String(alphaLine.supplier), String(alphaSupplier._id));
    assert.equal(alphaLine.supplierSku, `SS-${String(alphaOne._id).slice(-6)}`);
    assert.equal(alphaLine.supplierCost, 600);
    assert.equal(alphaLine.unitCost, 600, 'a dropship line costs from the supplier, not from Product.costPrice (§57)');
    assert.equal(alphaLine.lineCost, 1200);

    // §32: one order, one fulfillment per supplier, each naming the lines it covers.
    const fulfillments = await DropshipFulfillment.find({ order: mixedId }).sort({ createdAt: 1 }).lean();
    assert.equal(fulfillments.length, 2, 'two suppliers means two obligations, not one merged job (§32)');
    const bySupplier = new Map(fulfillments.map((item: any) => [String(item.supplier), item]));
    const alphaFulfillment = bySupplier.get(String(alphaSupplier._id));
    const betaFulfillment = bySupplier.get(String(betaSupplier._id));
    assert.deepEqual(alphaFulfillment.orderItems, [1, 2], 'the alpha obligation covers exactly the alpha lines (§32)');
    assert.deepEqual(betaFulfillment.orderItems, [3]);
    assert.equal(alphaFulfillment.status, 'PENDING');
    assert.equal(alphaFulfillment.orderNumber, mixed.orderNumber);
    assert.ok(/^DSF-\d{8}-[0-9A-Z]{6}$/.test(alphaFulfillment.fulfillmentNumber), 'the fulfillment number is server-minted');
    assert.notEqual(alphaFulfillment.fulfillmentNumber, betaFulfillment.fulfillmentNumber);
    // §35: MansooriKart order identity is its own number, never the supplier's reference.
    assert.notEqual(alphaFulfillment.fulfillmentNumber, mixed.orderNumber);
    assert.equal(alphaFulfillment.supplierOrderReference ?? null, null);
    assert.equal(String(alphaFulfillment.createdBy), String(mixedBuyer.user._id));

    // §34: a replayed checkout is one logical effect, not a second set of obligations.
    response = await checkout(mixedBuyer, 'mixed-checkout-1');
    assert.equal(response.status, 201);
    assert.equal(String(response.body.data._id), mixedId);
    assert.equal(await DropshipFulfillment.countDocuments({ order: mixedId }), 2, 'an idempotent replay does not double-create (§44)');
    assert.equal(await Order.countDocuments({ orderNumber: mixed.orderNumber }), 1);

    // §30, §56: none of the supplier economics reaches the customer's own order payload.
    const customerOrder = await request(app).get(`/api/v1/orders/${mixedId}`).set('Authorization', `Bearer ${mixedBuyer.token}`);
    assert.equal(customerOrder.status, 200);
    const customerBody = JSON.stringify(customerOrder.body);
    for (const leak of ['supplierCost', 'supplierSku', 'unitCost', 'lineCost', 'fulfillmentType', 'Alpha Supplier', 'DSF-'])
      assert.ok(!customerBody.includes(leak), `${leak} must never reach a customer order payload (§30, §56)`);
    assert.equal(customerOrder.body.data.items[1].unitPrice, 2500, 'the customer sees prices, quantities and totals');
    assert.equal(customerOrder.body.data.total, mixed.total);
    // The admin view of the same order does show the split, because that is its job.
    const adminOrder = await request(app).get(`/api/v1/admin/orders/${mixedId}`).set(auth);
    assert.equal(adminOrder.status, 200);
    assert.equal(adminOrder.body.data.dropshipFulfillments.length, 2, 'a split order is traceable from the order itself (§32)');
    assert.equal(adminOrder.body.data.items[1].supplierCost, 600);

    /* ------------------------------- §29 the supplier feed governs a dropship line */
    const blocked = await product('Blocked item', { fulfillmentType: 'DROPSHIP', price: 900 });
    await source(betaSupplier, blocked, { supplierAvailability: 'OUT_OF_STOCK', supplierStock: 0 });
    const blockedBuyer = await shopper('blocked@ff.test');
    await Cart.create({ user: blockedBuyer.user._id, items: [{ product: blocked._id, quantity: 1 }] });
    response = await checkout(blockedBuyer, 'blocked-checkout-1');
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DROPSHIP_UNAVAILABLE');
    assert.equal(await Order.countDocuments({ customer: blockedBuyer.user._id }), 0, 'a refused dropship line leaves no partial order (§34)');
    assert.equal(await DropshipFulfillment.countDocuments({ createdBy: blockedBuyer.user._id }), 0, 'and no orphan supplier obligation (§34)');
    // A source that is merely stale or reports UNKNOWN is advisory, not evidence of absence.
    const stale = await product('Stale item', { fulfillmentType: 'DROPSHIP', price: 900 });
    await source(betaSupplier, stale, { supplierAvailability: 'UNKNOWN', supplierStockUpdatedAt: new Date(Date.now() - 90 * 3600 * 1000) });
    const staleBuyer = await shopper('stale@ff.test');
    await Cart.create({ user: staleBuyer.user._id, items: [{ product: stale._id, quantity: 1 }] });
    assert.equal((await checkout(staleBuyer, 'stale-checkout-1')).status, 201, 'stale or unknown supplier stock does not block checkout (§24, §29)');
    // A product whose only source was deactivated cannot be routed to anyone.
    const orphan = await product('Orphan item', { fulfillmentType: 'DROPSHIP', price: 900 });
    await source(betaSupplier, orphan, { isActive: false });
    const orphanBuyer = await shopper('orphan@ff.test');
    await Cart.create({ user: orphanBuyer.user._id, items: [{ product: orphan._id, quantity: 1 }] });
    assert.equal((await checkout(orphanBuyer, 'orphan-checkout-1')).body.error.code, 'DROPSHIP_UNAVAILABLE');

    /* ---------------------- §31 the line snapshots are frozen at order creation */
    await SupplierCatalogItem.updateOne({ product: alphaOne._id }, { $set: { supplierCost: 1750, supplier: betaSupplier._id, supplierSku: 'RENEGOTIATED-1' } });
    await Product.updateOne({ _id: alphaOne._id }, { $set: { fulfillmentType: 'OWN_STOCK', costPrice: 999, price: 4444 } });
    const frozen = await Order.findById(mixedId).lean();
    assert.equal(frozen.items[1].supplierCost, 600, 'renegotiating cost does not rewrite history (§31)');
    assert.equal(String(frozen.items[1].supplier), String(alphaSupplier._id), 'moving the product to another supplier does not rewrite history (§31)');
    assert.equal(frozen.items[1].supplierSku, `SS-${String(alphaOne._id).slice(-6)}`);
    assert.equal(frozen.items[1].fulfillmentType, 'DROPSHIP', 'switching the product to own stock does not rewrite history (§31)');
    assert.equal(frozen.items[1].unitPrice, 2500);
    assert.equal(frozen.items[1].lineCost, 1200);
    assert.equal(frozen.total, mixed.total);

    /* -------------------------------------------------------- §49, §48 the API */
    const fulfillmentId = String(alphaFulfillment._id);
    const url = `/api/v1/admin/dropship-fulfillments/${fulfillmentId}`;
    assert.equal((await request(app).get('/api/v1/admin/dropship-fulfillments')).status, 401);
    assert.equal(
      (await request(app).get('/api/v1/admin/dropship-fulfillments').set('Authorization', `Bearer ${mixedBuyer.token}`)).status,
      403,
      'a customer may never see supplier obligations (§49)'
    );
    assert.equal((await request(app).patch(url).set('Authorization', `Bearer ${mixedBuyer.token}`).send({ status: 'SHIPPED' })).status, 403);
    // §48: the number, the order it belongs to, its line indexes and every timestamp are server-owned.
    for (const body of [
      { fulfillmentNumber: 'DSF-HACKED' },
      { order: String(ownOrder._id) },
      { orderNumber: 'MK-OTHER' },
      { orderItems: [0] },
      { supplier: String(betaSupplier._id) },
      { shippedAt: new Date().toISOString() },
      { statusHistory: [] },
      { createdBy: String(admin._id) },
      { status: 'INVENTED' },
      {},
    ])
      assert.equal((await request(app).patch(url).set(auth).send(body)).status, 400, `${JSON.stringify(body)} must be refused (§48)`);
    // There is no create route: a fulfillment exists because an order exists.
    assert.equal((await request(app).post('/api/v1/admin/dropship-fulfillments').set(auth).send({ order: mixedId })).status, 404);
    assert.equal((await request(app).get('/api/v1/admin/dropship-fulfillments/not-an-id').set(auth)).status, 400);
    assert.equal(
      (await request(app).get(`/api/v1/admin/dropship-fulfillments/${new mongoose.Types.ObjectId()}`).set(auth)).body.error.code,
      'DROPSHIP_FULFILLMENT_NOT_FOUND'
    );

    /* ------------------------------- §33, §36 the supplier-side lifecycle */
    response = await request(app).get(url).set(auth);
    assert.equal(response.status, 200);
    let view = response.body.data;
    assert.equal(view.status, 'PENDING');
    assert.equal(view.supplier.name, 'Alpha Supplier');
    assert.equal(view.supplier.code, 'FF-A');
    assert.deepEqual(view.orderItems, [1, 2]);
    assert.deepEqual(view.allowedTransitions.sort(), ['CANCELLED', 'FAILED', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED']);
    assert.ok(view.cancellationPolicy, 'every response states what cancelling would mean from here (§37)');
    assert.equal(view.timeline.sentToSupplierAt, null);
    // §33: an illegal jump is refused rather than quietly reordered.
    response = await request(app).patch(url).set(auth).send({ status: 'DELIVERED' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DROPSHIP_TRANSITION_INVALID');
    assert.equal((await DropshipFulfillment.findById(fulfillmentId).lean()).status, 'PENDING');

    response = await request(app)
      .patch(url)
      .set(auth)
      .send({ status: 'SENT_TO_SUPPLIER', supplierOrderReference: 'ALPHA-99881', reason: 'Emailed the supplier' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    view = response.body.data;
    assert.equal(view.status, 'SENT_TO_SUPPLIER');
    assert.equal(view.supplierOrderReference, 'ALPHA-99881');
    assert.ok(view.timeline.sentToSupplierAt, 'the stage timestamp is stamped by the transition, not by the client (§48)');
    assert.equal(view.statusHistory.at(-1).from, 'PENDING');
    assert.equal(view.statusHistory.at(-1).to, 'SENT_TO_SUPPLIER');
    assert.equal(view.statusHistory.at(-1).reason, 'Emailed the supplier');
    assert.equal(String(view.updatedBy), String(admin._id));
    // §35: the supplier's own reference is informational and does not become the identity.
    assert.equal(view.fulfillmentNumber, alphaFulfillment.fulfillmentNumber);
    assert.equal(view.orderNumber, mixed.orderNumber);

    response = await request(app).patch(url).set(auth).send({ status: 'SUPPLIER_CONFIRMED' });
    assert.equal(response.body.data.status, 'SUPPLIER_CONFIRMED');
    assert.ok(response.body.data.timeline.confirmedAt);
    // §36: carrier, tracking number and tracking URL are recordable; nothing internal leaks with them.
    response = await request(app).patch(url).set(auth).send({
      status: 'SHIPPED',
      carrier: 'TCS',
      supplierTrackingNumber: 'TCS-77120',
      trackingUrl: 'https://tracking.example.com/TCS-77120',
      notes: 'Internal: partial box',
    });
    assert.equal(response.status, 200);
    view = response.body.data;
    assert.equal(view.status, 'SHIPPED');
    assert.equal(view.carrier, 'TCS');
    assert.equal(view.supplierTrackingNumber, 'TCS-77120');
    assert.ok(view.timeline.shippedAt);
    assert.equal((await request(app).patch(url).set(auth).send({ trackingUrl: 'javascript:alert(1)' })).body.error.code, 'TRACKING_URL_INVALID');
    assert.equal((await request(app).patch(url).set(auth).send({ trackingUrl: '/tracking/TCS-77120' })).body.error.code, 'TRACKING_URL_INVALID');
    assert.equal((await DropshipFulfillment.findById(fulfillmentId).lean()).trackingUrl, 'https://tracking.example.com/TCS-77120');

    // §33: the supplier lifecycle is not the customer workflow. Advancing one leaves the other alone.
    assert.equal((await Order.findById(mixedId).lean()).orderStatus, 'PENDING', 'a supplier-side transition never moves the customer order (§33)');
    assert.equal((await DropshipFulfillment.findById(String(betaFulfillment._id)).lean()).status, 'PENDING', 'and never moves another supplier’s obligation');

    response = await request(app).patch(url).set(auth).send({ status: 'DELIVERED' });
    assert.equal(response.body.data.status, 'DELIVERED');
    assert.deepEqual(response.body.data.allowedTransitions, [], 'a delivered obligation is terminal (§33)');
    assert.equal(response.body.data.cancellationPolicy, null);
    assert.equal((await request(app).patch(url).set(auth).send({ status: 'CANCELLED' })).body.error.code, 'DROPSHIP_TRANSITION_INVALID');
    // Re-sending the status it already holds is a no-op, not a duplicate history entry.
    const beforeNoop = (await DropshipFulfillment.findById(fulfillmentId).lean()).statusHistory.length;
    assert.equal((await request(app).patch(url).set(auth).send({ status: 'DELIVERED' })).status, 200);
    assert.equal((await DropshipFulfillment.findById(fulfillmentId).lean()).statusHistory.length, beforeNoop);

    /* ------------------------------------------ §37 what cancellation does mean */
    response = await request(app).get('/api/v1/admin/dropship-fulfillments/cancellation-policy').set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.data.statuses.map((entry: any) => entry.status),
      ['PENDING', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'SHIPPED'],
      'the four stages where cancelling means something different are each documented (§37)'
    );
    assert.equal(response.body.data.statuses.find((entry: any) => entry.status === 'PENDING').requiresSupplierContact, false);
    for (const status of ['SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'SHIPPED'])
      assert.equal(
        response.body.data.statuses.find((entry: any) => entry.status === status).requiresSupplierContact,
        true,
        `${status} cannot be undone by MansooriKart alone (§37)`
      );
    assert.match(response.body.data.note, /records its own intent only/i);
    assert.ok(!JSON.stringify(response.body).match(/cancelled at the supplier|supplier has cancelled/i), 'no fake external side effect is claimed (§37)');

    // Cancelling the customer order withdraws the still-open obligations and nothing else.
    const betaUrl = `/api/v1/admin/dropship-fulfillments/${String(betaFulfillment._id)}`;
    assert.equal((await request(app).patch(betaUrl).set(auth).send({ status: 'SENT_TO_SUPPLIER' })).status, 200);
    assert.equal((await request(app).post(`/api/v1/admin/orders/${mixedId}/cancel`).set(auth).send({})).status, 200);
    assert.equal((await DropshipFulfillment.findById(String(betaFulfillment._id)).lean()).status, 'CANCELLED');
    const cancelledBeta = await DropshipFulfillment.findById(String(betaFulfillment._id)).lean();
    assert.ok(cancelledBeta.cancelledAt);
    assert.match(cancelledBeta.statusHistory.at(-1).reason, /Order cancelled by admin/);
    assert.equal(
      (await DropshipFulfillment.findById(fulfillmentId).lean()).status,
      'DELIVERED',
      'an already-delivered obligation is left alone by an order cancellation (§37)'
    );
    assert.equal((await Product.findById(owned._id).lean()).stock, 5, 'only the owned line was restocked (§29, §39)');

    /* ----------------------------------------- §43 the operational list surface */
    response = await request(app).get('/api/v1/admin/dropship-fulfillments?limit=100').set(auth);
    assert.equal(response.status, 200);
    assert.ok(response.body.data.length >= 3);
    assert.equal(response.body.meta.page, 1);
    assert.ok(response.body.meta.total >= 3);
    const filtered = async (query: string) => (await request(app).get(`/api/v1/admin/dropship-fulfillments?${query}`).set(auth)).body;
    assert.equal(
      (await filtered(`supplierId=${String(alphaSupplier._id)}`)).data.every((item: any) => item.supplier.id === String(alphaSupplier._id)),
      true
    );
    assert.equal((await filtered('status=DELIVERED')).data.length, 1);
    assert.equal((await filtered(`orderId=${mixedId}`)).data.length, 2);
    assert.equal((await filtered(`orderNumber=${mixed.orderNumber}`)).data.length, 2);
    assert.equal(
      (await filtered('status=CANCELLED')).data.every((item: any) => item.status === 'CANCELLED'),
      true
    );
    assert.equal((await filtered(`from=${new Date(Date.now() + 86400000).toISOString()}`)).data.length, 0);
    let paged = await filtered('page=1&limit=2');
    assert.equal(paged.data.length, 2);
    assert.equal(paged.meta.hasNextPage, paged.meta.total > 2);
    assert.equal((await request(app).get('/api/v1/admin/dropship-fulfillments?limit=500').set(auth)).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/dropship-fulfillments?status=NOPE').set(auth)).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/dropship-fulfillments?sortBy=supplierCost').set(auth)).status, 400);
    assert.equal((await request(app).get('/api/v1/admin/dropship-fulfillments?nope=1').set(auth)).status, 400);
    const listBody = JSON.stringify(await filtered('limit=100'));
    for (const leak of ['supplierCost', 'costPrice', 'grossUnitMargin', 'sourceRowHash'])
      assert.ok(!listBody.includes(leak), `${leak} does not belong in a fulfillment payload (§36)`);

    /* -------------------------------------------------------- §50 audit trail */
    const actions = (await AuditLog.find({ resourceType: 'DropshipFulfillment' }).lean()).map((entry: any) => entry.action);
    assert.ok(actions.includes('DROPSHIP_FULFILLMENT_CREATED'), 'creating an obligation is audited (§50)');
    assert.ok(actions.includes('DROPSHIP_FULFILLMENT_STATUS_CHANGED'), 'every status change is audited (§50)');
    assert.ok(actions.includes('DROPSHIP_FULFILLMENT_TRACKING_UPDATED'), 'tracking updates are audited (§50)');
    const trackingEntry = await AuditLog.findOne({ action: 'DROPSHIP_FULFILLMENT_TRACKING_UPDATED' }).lean();
    assert.equal(String(trackingEntry.actor), String(admin._id));
    assert.ok(!JSON.stringify(trackingEntry.metadata).includes('Internal: partial box'), 'an audit entry records the change, not the operator’s notes (§50)');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
