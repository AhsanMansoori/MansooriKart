import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { GoodsReceipt, PurchaseReturn } from '../src/models/goodsReceipt.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Product } from '../src/models/product.js';
import { PurchaseOrder } from '../src/models/purchaseOrder.js';
import { StockLocation } from '../src/models/stockLocation.js';
import { Supplier } from '../src/models/supplier.js';
import { User } from '../src/models/user.js';
import { Warehouse } from '../src/models/warehouse.js';
import { ensureBalance } from '../src/services/inventoryService.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

/** Reads the single authoritative balance row for a product in the default warehouse. */
const onHand = async (productId: string) => {
  const balances = await InventoryBalance.find({ product: productId }).lean();
  return balances.reduce((sum: number, balance: any) => sum + balance.quantityOnHand, 0);
};
const mirror = async (productId: string) => (await Product.findById(productId).lean()).stock;

test('purchasing ERP receives goods atomically, keeps inventory authoritative, and reports real aggregates', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([
      Warehouse.init(),
      StockLocation.init(),
      InventoryBalance.init(),
      Supplier.init(),
      PurchaseOrder.init(),
      GoodsReceipt.init(),
      PurchaseReturn.init(),
    ]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'po-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Customer', email: 'po-customer@test.local', password: 'Secret123!', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };

    const [widget, gadget] = await Product.create([
      {
        name: 'Purchased widget',
        slug: 'purchased-widget',
        sku: 'PO-W-001',
        description: 'x',
        category: 'x',
        image: 'https://e.test/x',
        price: 1_500,
        costPrice: 900,
        stock: 5,
        status: 'ACTIVE',
      },
      {
        name: 'Purchased gadget',
        slug: 'purchased-gadget',
        sku: 'PO-G-001',
        description: 'x',
        category: 'x',
        image: 'https://e.test/x',
        price: 2_500,
        costPrice: 1_800,
        stock: 0,
        status: 'ACTIVE',
      },
    ]);

    /* ---------------------------------------------------------------- RBAC */
    for (const path of ['/suppliers', '/purchase-orders', '/goods-receipts', '/purchase-returns', '/purchasing/dashboard', '/purchasing/reports']) {
      assert.equal((await request(app).get(`/api/v1/admin${path}`)).status, 401, `${path} must reject anonymous access`);
      assert.equal(
        (await request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${customerToken}`)).status,
        403,
        `${path} must reject a customer`
      );
    }
    assert.equal(
      (await request(app).post('/api/v1/admin/suppliers').set('Authorization', `Bearer ${customerToken}`).send({ name: 'X', code: 'X' })).status,
      403
    );

    /* ----------------------------------------------------------- Suppliers */
    let response = await request(app)
      .post('/api/v1/admin/suppliers')
      .set(auth)
      .send({ name: 'Karachi Traders', code: 'kt-01', email: 'sales@kt.test', paymentTerms: 'NET_30', leadTimeDays: 7, city: 'Karachi' });
    assert.equal(response.status, 201);
    const supplier = response.body.data;
    assert.equal(supplier.code, 'KT-01');
    // Banking credentials and portal logins are not part of the supplier record.
    for (const forbidden of ['bankAccount', 'iban', 'password', 'apiKey', 'accountNumber']) {
      assert.ok(!(forbidden in supplier), `supplier must not expose ${forbidden}`);
    }
    assert.equal(
      (await request(app).post('/api/v1/admin/suppliers').set(auth).send({ name: 'Bank details', code: 'BANK-1', bankAccount: '123' })).status,
      400,
      'unknown supplier fields must be rejected by the strict allowlist'
    );
    assert.equal((await request(app).post('/api/v1/admin/suppliers').set(auth).send({ name: 'Duplicate', code: 'KT-01' })).status, 409);

    response = await request(app).post('/api/v1/admin/suppliers').set(auth).send({ name: 'Lahore Supply', code: 'LS-01' });
    const secondSupplier = response.body.data;
    response = await request(app).patch(`/api/v1/admin/suppliers/${secondSupplier.id}`).set(auth).send({ status: 'INACTIVE' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'INACTIVE');

    response = await request(app).get('/api/v1/admin/suppliers?search=Karachi').set(auth);
    assert.equal(response.body.data.length, 1);
    assert.equal((await request(app).get('/api/v1/admin/suppliers?bogus=1').set(auth)).status, 400);

    /* ------------------------------------------------- Purchase order draft */
    const bootstrap = await request(app).get('/api/v1/admin/inventory/bootstrap-default').set(auth);
    assert.equal(bootstrap.status, 200);
    const main = bootstrap.body.data;
    // Materialise the authoritative balance rows from opening stock so later
    // assertions compare balances against the mirror rather than against nothing.
    await Promise.all([ensureBalance(String(widget._id)), ensureBalance(String(gadget._id))]);
    assert.equal(await onHand(String(widget._id)), 5);
    assert.equal(await onHand(String(gadget._id)), 0);

    // A submitted total is never trusted: the server derives every money figure.
    response = await request(app)
      .post('/api/v1/admin/purchase-orders')
      .set(auth)
      .send({
        supplierId: supplier.id,
        items: [
          { productId: String(widget._id), quantity: 10, unitCost: 1_000 },
          { productId: String(gadget._id), quantity: 4, unitCost: 2_000 },
        ],
        shippingCost: 500,
        taxAmount: 100,
        total: 1,
      });
    assert.equal(response.status, 400, 'a client-supplied total must be rejected outright');

    response = await request(app)
      .post('/api/v1/admin/purchase-orders')
      .set(auth)
      .send({ supplierId: supplier.id, items: [{ productId: String(widget._id), quantity: 1, unitCost: 1 }], poNumber: 'PO-CLIENT-1' });
    assert.equal(response.status, 400, 'a client-supplied PO number must be rejected outright');

    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/purchase-orders')
          .set(auth)
          .send({ supplierId: secondSupplier.id, items: [{ productId: String(widget._id), quantity: 1, unitCost: 1 }] })
      ).status,
      400,
      'an inactive supplier cannot receive purchase orders'
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/purchase-orders')
          .set(auth)
          .send({
            supplierId: supplier.id,
            items: [
              { productId: String(widget._id), quantity: 1, unitCost: 1 },
              { productId: String(widget._id), quantity: 2, unitCost: 2 },
            ],
          })
      ).body.error.code,
      'PURCHASE_ITEMS_DUPLICATED'
    );

    response = await request(app)
      .post('/api/v1/admin/purchase-orders')
      .set(auth)
      .send({
        supplierId: supplier.id,
        items: [
          { productId: String(widget._id), quantity: 10, unitCost: 1_000 },
          { productId: String(gadget._id), quantity: 4, unitCost: 2_000 },
        ],
        shippingCost: 500,
        taxAmount: 100,
        discount: 600,
        reference: 'Q3 restock',
      });
    assert.equal(response.status, 201);
    const po = response.body.data;
    assert.ok(/^PO-\d{8}-[0-9A-F]{6}$/.test(po.poNumber), `server-generated PO number expected, got ${po.poNumber}`);
    assert.equal(po.status, 'DRAFT');
    assert.equal(po.subtotal, 18_000);
    assert.equal(po.total, 18_000);
    assert.equal(po.warehouse, main.warehouseId);
    // Raising a purchase order never moves stock.
    assert.equal(await onHand(String(widget._id)), 5);
    assert.equal(await mirror(String(widget._id)), 5);
    assert.equal(await onHand(String(gadget._id)), 0);

    const widgetLine = po.items.find((item: any) => item.product === String(widget._id));
    const gadgetLine = po.items.find((item: any) => item.product === String(gadget._id));

    /* ----------------------------------------------------- Receiving gating */
    let attempt = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': 'too-early-key-1' })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 1 }] });
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body.error.code, 'PURCHASE_ORDER_NOT_RECEIVABLE');
    assert.equal(await onHand(String(widget._id)), 5);

    // A DRAFT order is editable; anything beyond DRAFT is not.
    response = await request(app).patch(`/api/v1/admin/purchase-orders/${po.id}`).set(auth).send({ notes: 'Confirmed by phone' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.notes, 'Confirmed by phone');

    assert.equal((await request(app).post(`/api/v1/admin/purchase-orders/${po.id}/submit`).set(auth).send({})).status, 200);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/purchase-orders/${po.id}`).set(auth).send({ notes: 'Too late' })).body.error.code,
      'PURCHASE_ORDER_NOT_EDITABLE'
    );
    assert.equal((await request(app).post(`/api/v1/admin/purchase-orders/${po.id}/close`).set(auth).send({})).status, 409);

    response = await request(app).post(`/api/v1/admin/purchase-orders/${po.id}/approve`).set(auth).send({ reason: 'Budget approved' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'APPROVED');
    // Approval alone never increases inventory.
    assert.equal(await onHand(String(widget._id)), 5);
    assert.equal(await mirror(String(widget._id)), 5);

    /* -------------------------------------------------- Partial receiving */
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set(auth)
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 4 }] });
    assert.equal(response.status, 400, 'a receipt without an Idempotency-Key must be refused');
    assert.equal(response.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    const firstKey = 'receipt-key-000001';
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': firstKey })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 4, quantityRejected: 1, rejectionReason: 'Dented casing' }] });
    assert.equal(response.status, 201);
    const firstReceipt = response.body.data;
    assert.equal(firstReceipt.totalAccepted, 4);
    assert.equal(firstReceipt.totalRejected, 1);
    assert.equal(firstReceipt.acceptedValue, 4_000);
    // Only accepted units become stock. The rejected unit is recorded, never stocked.
    assert.equal(await onHand(String(widget._id)), 9);
    assert.equal(await mirror(String(widget._id)), 9, 'Product.stock mirror must track InventoryBalance');
    const movements = await InventoryMovement.find({ product: widget._id, type: 'PURCHASE_RECEIPT' }).lean();
    assert.equal(movements.length, 1);
    assert.equal(movements[0].quantityDelta, 4);
    assert.equal(String(movements[0].referenceId), po.id);
    // Cost price follows the latest accepted purchase cost (documented Option B).
    assert.equal(
      await Product.findById(widget._id)
        .lean()
        .then((p: any) => p.costPrice),
      1_000
    );
    assert.equal(firstReceipt.items[0].previousCostPrice, 900);
    assert.equal(firstReceipt.costPriceSynced, true);

    response = await request(app).get(`/api/v1/admin/purchase-orders/${po.id}`).set(auth);
    assert.equal(response.body.data.status, 'PARTIALLY_RECEIVED');
    const partialWidget = response.body.data.items.find((item: any) => item.id === widgetLine.id);
    assert.equal(partialWidget.quantityReceived, 5);
    assert.equal(partialWidget.quantityAccepted, 4);
    assert.equal(partialWidget.quantityRejected, 1);
    assert.equal(partialWidget.quantityOutstanding, 5);

    /* --------------------------------------------------- Idempotent replay */
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': firstKey })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 4, quantityRejected: 1 }] });
    assert.equal(response.status, 200, 'a replayed receipt is returned, not re-applied');
    assert.equal(response.body.data.id, firstReceipt.id);
    assert.equal(await onHand(String(widget._id)), 9, 'a replay must not add stock a second time');
    assert.equal(await GoodsReceipt.countDocuments({ purchaseOrder: po.id }), 1);

    // A replay with a different body still returns the original receipt and moves no stock.
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': firstKey })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 999 }] });
    assert.equal(response.body.data.id, firstReceipt.id);
    assert.equal(await onHand(String(widget._id)), 9);

    /* ------------------------------------------------------- Over-receipt */
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': 'over-receipt-key-1' })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 6 }] });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'PURCHASE_RECEIPT_QUANTITY_INVALID');
    assert.equal(await onHand(String(widget._id)), 9, 'a rejected over-receipt must move no stock');
    assert.equal(await GoodsReceipt.countDocuments({ purchaseOrder: po.id }), 1);

    // A zero-quantity receipt line is meaningless and refused.
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': 'zero-quantity-key-1' })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 0, quantityRejected: 0 }] });
    assert.equal(response.status, 400);

    // A partially-invalid multi-line receipt applies nothing at all.
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': 'mixed-validity-key-1' })
      .send({
        items: [
          { purchaseOrderItemId: gadgetLine.id, quantityAccepted: 2 },
          { purchaseOrderItemId: widgetLine.id, quantityAccepted: 99 },
        ],
      });
    assert.equal(response.status, 409);
    assert.equal(await onHand(String(gadget._id)), 0, 'no line may apply when another line is invalid');
    assert.equal(await onHand(String(widget._id)), 9);

    /* ------------------------------------------------- Cancellation guard */
    response = await request(app).post(`/api/v1/admin/purchase-orders/${po.id}/cancel`).set(auth).send({ reason: 'Change of plan' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'PURCHASE_ORDER_NOT_CANCELLABLE');
    assert.equal(await onHand(String(widget._id)), 9, 'received inventory survives a refused cancellation');

    /* ------------------------------------------------ Concurrent receiving */
    // Five simultaneous receipts, each with its own key, against 5 remaining units.
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        request(app)
          .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
          .set({ ...auth, 'Idempotency-Key': `concurrent-widget-key-${index}` })
          .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 2 }] })
      )
    );
    const accepted = concurrent.filter(entry => entry.status === 201);
    const refused = concurrent.filter(entry => entry.status === 409);
    assert.equal(accepted.length + refused.length, 5, 'every concurrent receipt must be a clean success or a clean conflict');
    const receivedByConcurrency = accepted.length * 2;
    assert.ok(receivedByConcurrency <= 5, 'concurrent receipts may never exceed the ordered quantity');
    assert.equal(await onHand(String(widget._id)), 9 + receivedByConcurrency);
    assert.equal(await mirror(String(widget._id)), 9 + receivedByConcurrency);
    const widgetState = await PurchaseOrder.findById(po.id).lean();
    const widgetPersisted = widgetState.items.find((item: any) => String(item._id) === widgetLine.id);
    assert.ok(widgetPersisted.quantityReceived <= widgetPersisted.quantityOrdered, 'quantityReceived may never exceed quantityOrdered');
    assert.equal(widgetPersisted.quantityAccepted + widgetPersisted.quantityRejected, widgetPersisted.quantityReceived);
    // The ledger, the balance and the mirror agree to the unit.
    const ledger = await InventoryMovement.aggregate([{ $match: { product: widget._id } }, { $group: { _id: null, delta: { $sum: '$quantityDelta' } } }]);
    assert.equal(5 + ledger[0].delta, await onHand(String(widget._id)), 'balance must equal opening stock plus the movement ledger');

    // Two simultaneous replays of one key produce exactly one receipt.
    const replayKey = 'replay-race-key-00001';
    const race = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app)
          .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
          .set({ ...auth, 'Idempotency-Key': replayKey })
          .send({ items: [{ purchaseOrderItemId: gadgetLine.id, quantityAccepted: 1 }] })
      )
    );
    const raceIds = new Set(race.filter(entry => entry.status < 300).map(entry => entry.body.data.id));
    assert.equal(raceIds.size, 1, 'a single idempotency key must resolve to a single receipt');
    assert.equal(await GoodsReceipt.countDocuments({ purchaseOrder: po.id, idempotencyKey: replayKey }), 1);
    assert.equal(await onHand(String(gadget._id)), 1, 'a raced key must add its quantity exactly once');

    /* ---------------------------------------------- Completing the receipt */
    const remaining = 10 - widgetPersisted.quantityReceived;
    if (remaining > 0) {
      response = await request(app)
        .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
        .set({ ...auth, 'Idempotency-Key': 'final-widget-key-0001' })
        .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: remaining }] });
      assert.equal(response.status, 201);
    }
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': 'final-gadget-key-0001' })
      .send({ items: [{ purchaseOrderItemId: gadgetLine.id, quantityAccepted: 3 }] });
    assert.equal(response.status, 201);

    response = await request(app).get(`/api/v1/admin/purchase-orders/${po.id}`).set(auth);
    assert.equal(response.body.data.status, 'RECEIVED', 'a fully delivered order reaches RECEIVED automatically');
    const finalGadget = response.body.data.items.find((item: any) => item.id === gadgetLine.id);
    assert.equal(finalGadget.quantityAccepted, 4);
    assert.equal(await onHand(String(gadget._id)), 4);
    assert.equal(await mirror(String(gadget._id)), 4);

    /* ------------------------------------------------------ Supplier return */
    const widgetBeforeReturn = await onHand(String(widget._id));
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/returns`)
      .set({ ...auth, 'Idempotency-Key': 'return-key-00000001' })
      .send({ items: [{ purchaseOrderItemId: gadgetLine.id, quantity: 2 }], reason: 'Wrong specification' });
    assert.equal(response.status, 201);
    const supplierReturn = response.body.data;
    assert.equal(supplierReturn.totalQuantity, 2);
    assert.equal(supplierReturn.returnedValue, 4_000);
    assert.equal(await onHand(String(gadget._id)), 2, 'a supplier return removes stock through the inventory service');
    assert.equal(await mirror(String(gadget._id)), 2);
    assert.equal(await onHand(String(widget._id)), widgetBeforeReturn, 'a return may not touch an unrelated line');
    assert.equal(await InventoryMovement.countDocuments({ product: gadget._id, type: 'PURCHASE_RETURN' }), 1);

    // Replaying the return key returns the original record and removes nothing further.
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/returns`)
      .set({ ...auth, 'Idempotency-Key': 'return-key-00000001' })
      .send({ items: [{ purchaseOrderItemId: gadgetLine.id, quantity: 2 }], reason: 'Wrong specification' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, supplierReturn.id);
    assert.equal(await onHand(String(gadget._id)), 2);

    // Returning more than was accepted is refused and moves nothing.
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/returns`)
      .set({ ...auth, 'Idempotency-Key': 'return-key-00000002' })
      .send({ items: [{ purchaseOrderItemId: gadgetLine.id, quantity: 3 }], reason: 'Too many' });
    assert.equal(response.status, 409);
    assert.equal(await onHand(String(gadget._id)), 2);
    assert.equal(await PurchaseReturn.countDocuments({ purchaseOrder: po.id }), 1);

    /* ------------------------------------------------------------- Closure */
    response = await request(app).post(`/api/v1/admin/purchase-orders/${po.id}/close`).set(auth).send({ reason: 'Complete' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'CLOSED');
    response = await request(app)
      .post(`/api/v1/admin/purchase-orders/${po.id}/receipts`)
      .set({ ...auth, 'Idempotency-Key': 'after-close-key-0001' })
      .send({ items: [{ purchaseOrderItemId: widgetLine.id, quantityAccepted: 1 }] });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'PURCHASE_ORDER_NOT_RECEIVABLE');

    /* ----------------------------------------- Cancellable order and audit */
    response = await request(app)
      .post('/api/v1/admin/purchase-orders')
      .set(auth)
      .send({ supplierId: supplier.id, items: [{ productId: String(widget._id), quantity: 3, unitCost: 1_100 }] });
    const cancellable = response.body.data;
    assert.equal((await request(app).post(`/api/v1/admin/purchase-orders/${cancellable.id}/cancel`).set(auth).send({ reason: 'Duplicate' })).status, 200);
    assert.equal((await PurchaseOrder.findById(cancellable.id).lean()).status, 'CANCELLED');
    assert.equal(
      (await request(app).post(`/api/v1/admin/purchase-orders/${cancellable.id}/approve`).set(auth).send({})).body.error.code,
      'PURCHASE_ORDER_TRANSITION_INVALID'
    );

    // A supplier with open orders is not archivable; the archived supplier survives for history.
    response = await request(app)
      .post('/api/v1/admin/purchase-orders')
      .set(auth)
      .send({ supplierId: supplier.id, items: [{ productId: String(widget._id), quantity: 1, unitCost: 1_000 }] });
    const openDraft = response.body.data;

    // Supplier detail and performance are real aggregates over that history.
    response = await request(app).get(`/api/v1/admin/suppliers/${supplier.id}`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.code, 'KT-01');
    assert.equal(response.body.data.openPurchaseOrders, 1, 'the open draft must be counted');
    const supplierReceipts = await GoodsReceipt.aggregate([
      { $match: { supplier: new mongoose.Types.ObjectId(supplier.id) } },
      { $group: { _id: null, value: { $sum: '$acceptedValue' } } },
    ]);
    assert.equal(response.body.data.receivedValue, Number(supplierReceipts[0].value.toFixed(2)));
    assert.equal((await request(app).get(`/api/v1/admin/suppliers/${new mongoose.Types.ObjectId()}`).set(auth)).status, 404);

    response = await request(app).get(`/api/v1/admin/suppliers/${supplier.id}/performance`).set(auth);
    assert.equal(response.status, 200);
    const performance = response.body.data;
    assert.equal(performance.purchaseOrders.total, await PurchaseOrder.countDocuments({ supplier: supplier.id }));
    assert.equal(performance.receiving.receipts, await GoodsReceipt.countDocuments({ supplier: supplier.id }));
    // Acceptance is derived from delivered units, not asserted as a constant.
    const delivered = performance.receiving.unitsAccepted + performance.receiving.unitsRejected;
    assert.ok(performance.receiving.unitsRejected > 0, 'the fixture rejected units, so the rate must be below 100');
    assert.equal(performance.receiving.acceptanceRate, Number(((performance.receiving.unitsAccepted / delivered) * 100).toFixed(2)));
    assert.equal(performance.supplierReturns.count, await PurchaseReturn.countDocuments({ supplier: supplier.id }));
    // Performance is a logistics statistic and claims no accounting semantics.
    for (const forbidden of ['profit', 'expense', 'payable', 'grossMargin', 'costOfGoodsSold']) {
      assert.ok(!JSON.stringify(performance).toLowerCase().includes(forbidden.toLowerCase()), `performance must not claim ${forbidden}`);
    }

    response = await request(app).delete(`/api/v1/admin/suppliers/${supplier.id}`).set(auth);
    assert.equal(response.status, 409, 'a supplier with an open order may not be archived');
    assert.equal(response.body.error.code, 'SUPPLIER_HAS_OPEN_ORDERS');
    assert.equal((await Supplier.findById(supplier.id).lean()).status, 'ACTIVE');
    assert.equal((await request(app).post(`/api/v1/admin/purchase-orders/${openDraft.id}/cancel`).set(auth).send({ reason: 'Not needed' })).status, 200);

    assert.equal((await request(app).delete(`/api/v1/admin/suppliers/${supplier.id}`).set(auth)).status, 200);
    assert.equal((await Supplier.findById(supplier.id).lean()).status, 'ARCHIVED');
    assert.equal((await request(app).delete(`/api/v1/admin/suppliers/${secondSupplier.id}`).set(auth)).status, 200);

    for (const action of [
      'SUPPLIER_CREATED',
      'SUPPLIER_ARCHIVED',
      'PURCHASE_ORDER_CREATED',
      'PURCHASE_ORDER_APPROVED',
      'PURCHASE_GOODS_RECEIVED',
      'PURCHASE_RETURN_CREATED',
    ]) {
      assert.ok((await AuditLog.countDocuments({ action })) > 0, `${action} must be audited`);
    }
    // Refused operations never produce a success audit.
    assert.equal(await AuditLog.countDocuments({ action: 'PURCHASE_ORDER_CANCELLED', resourceId: po.id }), 0);

    /* ------------------------------------------------- Dashboard / reports */
    response = await request(app).get('/api/v1/admin/purchasing/dashboard').set(auth);
    assert.equal(response.status, 200);
    const dashboard = response.body.data;
    const receiptTotals = await GoodsReceipt.aggregate([
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          accepted: { $sum: '$totalAccepted' },
          rejected: { $sum: '$totalRejected' },
          value: { $sum: '$acceptedValue' },
        },
      },
    ]);
    assert.equal(dashboard.receiving.receipts, receiptTotals[0].count, 'dashboard receipts must be a real aggregate');
    assert.equal(dashboard.receiving.unitsAccepted, receiptTotals[0].accepted);
    assert.equal(dashboard.receiving.unitsRejected, receiptTotals[0].rejected);
    assert.equal(dashboard.receiving.receivedValue, Number(receiptTotals[0].value.toFixed(2)));
    assert.equal(dashboard.purchaseOrders.total, await PurchaseOrder.countDocuments({}));
    assert.equal(dashboard.suppliers.archived, 2);
    assert.equal(dashboard.supplierReturns.units, 2);
    assert.equal(dashboard.basis, 'PROCUREMENT_COMMITMENT_AND_GOODS_IN');
    // No accounting semantics are claimed anywhere in the payload.
    for (const forbidden of ['profit', 'expense', 'payable', 'grossMargin', 'costOfGoodsSold']) {
      assert.ok(!JSON.stringify(dashboard).toLowerCase().includes(forbidden.toLowerCase()), `dashboard must not claim ${forbidden}`);
    }

    for (const groupBy of ['supplier', 'product', 'date']) {
      response = await request(app).get(`/api/v1/admin/purchasing/reports?groupBy=${groupBy}`).set(auth);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.groupBy, groupBy);
      assert.ok(Array.isArray(response.body.data.rows));
    }
    response = await request(app).get('/api/v1/admin/purchasing/reports?groupBy=product').set(auth);
    const widgetRow = response.body.data.rows.find((row: any) => row.product === String(widget._id));
    assert.equal(
      widgetRow.unitsAccepted,
      (await PurchaseOrder.findById(po.id).lean()).items.find((item: any) => String(item._id) === widgetLine.id).quantityAccepted
    );
    assert.equal((await request(app).get('/api/v1/admin/purchasing/reports?groupBy=nonsense').set(auth)).status, 400);

    /* ----------------------------------------------------- Error hygiene */
    for (const path of ['/api/v1/admin/purchase-orders/not-an-id', '/api/v1/admin/suppliers/not-an-id', '/api/v1/admin/goods-receipts/not-an-id']) {
      response = await request(app).get(path).set(auth);
      assert.equal(response.status, 400, `${path} must fail validation cleanly`);
      const serialized = JSON.stringify(response.body);
      assert.ok(!serialized.includes('CastError'), 'no driver CastError may reach a client');
      assert.ok(!serialized.includes('at Object.'), 'no stack trace may reach a client');
      assert.ok(!serialized.toLowerCase().includes('mongo'), 'no driver detail may reach a client');
    }
    assert.equal((await request(app).get(`/api/v1/admin/purchase-orders/${new mongoose.Types.ObjectId()}`).set(auth)).status, 404);
    assert.equal((await request(app).get(`/api/v1/admin/goods-receipts/${new mongoose.Types.ObjectId()}`).set(auth)).status, 404);

    /* ---------------------------------------------------- Receipt listings */
    response = await request(app).get(`/api/v1/admin/purchase-orders/${po.id}/receipts`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.total, await GoodsReceipt.countDocuments({ purchaseOrder: po.id }));
    response = await request(app).get('/api/v1/admin/purchase-returns').set(auth);
    assert.equal(response.body.meta.total, 1);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
