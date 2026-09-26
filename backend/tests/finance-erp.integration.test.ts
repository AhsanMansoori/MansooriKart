import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Expense } from '../src/models/expense.js';
import { GoodsReceipt } from '../src/models/goodsReceipt.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { PurchaseOrder } from '../src/models/purchaseOrder.js';
import { Refund } from '../src/models/refund.js';
import { StockLocation } from '../src/models/stockLocation.js';
import { Supplier } from '../src/models/supplier.js';
import { User } from '../src/models/user.js';
import { Warehouse } from '../src/models/warehouse.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

/** Nothing that would betray the driver, the schema internals, or a stack may reach a client. */
const LEAKS = ['CastError', 'ValidationError', 'ObjectId', 'E11000', 'stack', 'mongodb://', 'BSON'];
const assertSafeError = (response: any, label: string) => {
  const body = JSON.stringify(response.body);
  for (const leak of LEAKS) assert.ok(!body.includes(leak), `${label} must not leak "${leak}": ${body}`);
  assert.equal(response.body.success, false, `${label} must be a structured failure`);
  assert.ok(typeof response.body.error?.code === 'string' && response.body.error.code.length > 0, `${label} needs a stable error code`);
};

const address = {
  fullName: 'Buyer',
  phone: '03001234567',
  addressLine1: 'Street 1',
  city: 'Karachi',
  stateProvince: 'Sindh',
  postalCode: '75000',
  country: 'PK',
};

test('finance ERP records expenses safely and reports real, reconcilable money', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([User.init(), Order.init(), Product.init(), Expense.init(), Refund.init(), Supplier.init(), PurchaseOrder.init(), GoodsReceipt.init()]);
    const [admin, customer] = await User.create([
      { name: 'Admin', email: 'fin-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Customer', email: 'fin-customer@test.local', password: 'Secret123!', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };

    const [widget, legacy] = await Product.create([
      {
        name: 'Finance widget',
        slug: 'finance-widget',
        sku: 'FIN-W-1',
        description: 'x',
        category: 'Audio',
        image: 'https://e.test/x',
        price: 25_000,
        costPrice: 15_000,
        stock: 40,
      },
      { name: 'Legacy item', slug: 'legacy-item', sku: 'FIN-L-1', description: 'x', category: 'Audio', image: 'https://e.test/x', price: 10_000, stock: 10 },
    ]);
    const supplier = await Supplier.create({ name: 'Finance Supplier', code: 'FSUP-1', createdBy: admin._id });
    const warehouse = await Warehouse.create({ name: 'Finance WH', code: 'FWH' });
    const location = await StockLocation.create({ warehouse: warehouse._id, name: 'Bay', code: 'BAY-F' });

    // Four orders spanning every revenue case the semantics have to separate:
    // realized, delivered-but-uncollected COD, cancelled, and a legacy line that
    // carries no cost snapshot at all.
    const [realizedOrder, unpaidCod, cancelled, legacyOrder] = await Order.create([
      {
        customer: customer._id,
        orderNumber: 'MK-F-1',
        idempotencyKey: 'f1',
        items: [
          {
            productId: widget._id,
            name: widget.name,
            sku: widget.sku,
            unitPrice: 25_000,
            quantity: 2,
            lineSubtotal: 50_000,
            unitCost: 15_000,
            lineCost: 30_000,
          },
        ],
        shippingAddress: address,
        subtotal: 50_000,
        discount: 0,
        shipping: 500,
        tax: 2_000,
        total: 52_500,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PARTIALLY_REFUNDED',
        orderStatus: 'DELIVERED',
      },
      {
        customer: customer._id,
        orderNumber: 'MK-F-2',
        idempotencyKey: 'f2',
        items: [
          {
            productId: widget._id,
            name: widget.name,
            sku: widget.sku,
            unitPrice: 30_000,
            quantity: 1,
            lineSubtotal: 30_000,
            unitCost: 15_000,
            lineCost: 15_000,
          },
        ],
        shippingAddress: address,
        subtotal: 30_000,
        tax: 1_000,
        total: 30_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: customer._id,
        orderNumber: 'MK-F-3',
        idempotencyKey: 'f3',
        items: [
          {
            productId: widget._id,
            name: widget.name,
            sku: widget.sku,
            unitPrice: 17_500,
            quantity: 1,
            lineSubtotal: 17_500,
            unitCost: 15_000,
            lineCost: 15_000,
          },
        ],
        shippingAddress: address,
        subtotal: 17_500,
        tax: 500,
        total: 17_500,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'CANCELLED',
      },
      {
        customer: customer._id,
        orderNumber: 'MK-F-4',
        idempotencyKey: 'f4',
        // No `unitCost`/`lineCost`: this is the pre-snapshot shape, and it must
        // reduce reported cost coverage instead of silently costing zero.
        items: [{ productId: legacy._id, name: legacy.name, sku: legacy.sku, unitPrice: 10_000, quantity: 1, lineSubtotal: 10_000 }],
        shippingAddress: address,
        subtotal: 10_000,
        tax: 0,
        total: 10_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'REFUNDED',
        orderStatus: 'DELIVERED',
      },
    ]);

    // A completed and a pending refund both reduce revenue; the failed one never does.
    await Refund.create([
      {
        refundNumber: 'RF-F-1',
        order: realizedOrder._id,
        amount: 1_500,
        currency: 'PKR',
        status: 'COMPLETED',
        reason: 'Damaged',
        paymentMethod: 'CASH_ON_DELIVERY',
        processedBy: admin._id,
        idempotencyKey: 'rf1',
      },
      {
        refundNumber: 'RF-F-2',
        order: realizedOrder._id,
        amount: 1_000,
        currency: 'PKR',
        status: 'PENDING',
        reason: 'Late',
        paymentMethod: 'CASH_ON_DELIVERY',
        processedBy: admin._id,
        idempotencyKey: 'rf2',
      },
      {
        refundNumber: 'RF-F-3',
        order: realizedOrder._id,
        amount: 9_999,
        currency: 'PKR',
        status: 'FAILED',
        reason: 'Bank rejected',
        paymentMethod: 'CASH_ON_DELIVERY',
        processedBy: admin._id,
        idempotencyKey: 'rf3',
      },
    ]);

    // Procurement: a live commitment partly received, plus a draft that is not a
    // commitment yet. Neither may ever appear as an operating expense.
    const [livePo] = await PurchaseOrder.create([
      {
        poNumber: 'PO-F-1',
        supplier: supplier._id,
        warehouse: warehouse._id,
        location: location._id,
        status: 'APPROVED',
        items: [
          {
            product: widget._id,
            name: widget.name,
            sku: widget.sku,
            quantityOrdered: 10,
            unitCost: 15_000,
            lineSubtotal: 150_000,
            quantityReceived: 4,
            quantityAccepted: 4,
          },
        ],
        subtotal: 150_000,
        total: 150_000,
        createdBy: admin._id,
      },
      {
        poNumber: 'PO-F-2',
        supplier: supplier._id,
        warehouse: warehouse._id,
        location: location._id,
        status: 'DRAFT',
        items: [{ product: widget._id, name: widget.name, sku: widget.sku, quantityOrdered: 5, unitCost: 10_000, lineSubtotal: 50_000 }],
        subtotal: 50_000,
        total: 50_000,
        createdBy: admin._id,
      },
    ]);
    await GoodsReceipt.create({
      receiptNumber: 'GRN-F-1',
      purchaseOrder: livePo._id,
      supplier: supplier._id,
      warehouse: warehouse._id,
      location: location._id,
      items: [{ purchaseOrderItem: livePo.items[0]._id, product: widget._id, name: widget.name, unitCost: 15_000, quantityAccepted: 4, quantityRejected: 1 }],
      totalAccepted: 4,
      totalRejected: 1,
      acceptedValue: 60_000,
      receivedBy: admin._id,
      idempotencyKey: 'grf1',
    });

    /* ------------------------------------------------------------- Authorization */
    const financePaths = ['/expenses', '/expenses/summary', '/finance/dashboard', '/finance/analytics', '/finance/profit-loss'];
    for (const path of financePaths) {
      assert.equal((await request(app).get(`/api/v1/admin${path}`)).status, 401, `${path} must reject anonymous access`);
      assert.equal(
        (await request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${customerToken}`)).status,
        403,
        `${path} must reject a customer`
      );
      assert.equal((await request(app).get(`/api/v1/admin${path}`).set(auth)).status, 200, `${path} must serve a Super Admin`);
    }
    assert.equal(
      (
        await request(app)
          .post('/api/v1/admin/expenses')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ category: 'SHIPPING', description: 'x', amount: 1, expenseDate: '2026-01-01' })
      ).status,
      403
    );

    /* ---------------------------------------------------------- Expense creation */
    const today = new Date().toISOString();
    let response = await request(app)
      .post('/api/v1/admin/expenses')
      .set(auth)
      .send({
        category: 'SHIPPING',
        description: 'Courier settlement',
        amount: 5_000,
        taxAmount: 500,
        expenseDate: today,
        paymentMethod: 'BANK_TRANSFER',
        supplier: String(supplier._id),
        purchaseOrder: String(livePo._id),
        reference: 'INV-9',
        notes: 'n',
      });
    assert.equal(response.status, 201);
    const shippingExpense = response.body.data.id;
    assert.match(response.body.data.expenseNumber, /^EXP-\d{8}-[0-9A-F]{6}$/);
    assert.equal(response.body.data.status, 'DRAFT');
    assert.equal(response.body.data.amount, 5_000);
    assert.equal(response.body.data.taxAmount, 500);
    // Server-derived, never echoed from the client.
    assert.equal(response.body.data.totalAmount, 5_500);
    assert.equal(response.body.data.supplier.id, String(supplier._id));
    assert.equal(response.body.data.purchaseOrder, String(livePo._id));
    assert.equal(String((await Expense.findById(shippingExpense).lean()).createdBy), String(admin._id));

    const draft = (
      await request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: 'MARKETING', description: 'Ad spend, still draft', amount: 1_000, expenseDate: today })
    ).body.data.id;
    const voided = (
      await request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: 'SOFTWARE', description: 'Duplicate licence charge', amount: 7_000, expenseDate: today })
    ).body.data.id;

    /* ------------------------------------------------------------ Mass assignment */
    // Every server-owned field is absent from the schema, so `.strict()` refuses
    // the request outright rather than quietly dropping the key.
    for (const payload of [
      { expenseNumber: 'EXP-19700101-AAAAAA' },
      { status: 'APPROVED' },
      { createdBy: String(customer._id) },
      { approvedBy: String(admin._id) },
      { approvedAt: today },
      { voidedBy: String(admin._id) },
      { voidedAt: today },
      { voidReason: 'forged' },
      { totalAmount: 1 },
      { currency: 'USD' },
      { statusHistory: [{ to: 'APPROVED' }] },
      { createdAt: today },
      { updatedAt: today },
      { _id: String(livePo._id) },
    ]) {
      const attempt = await request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: 'OFFICE', description: 'Mass assignment probe', amount: 10, expenseDate: today, ...payload });
      assert.equal(attempt.status, 400, `POST /expenses must reject ${JSON.stringify(payload)}`);
      assertSafeError(attempt, 'expense mass assignment');
    }
    // Prototype keys have to travel as raw JSON: an object literal would set the
    // prototype locally instead of sending the key over the wire.
    for (const raw of [
      `{"category":"OFFICE","description":"Mass assignment probe","amount":10,"expenseDate":"${today}","__proto__":{"polluted":true}}`,
      `{"category":"OFFICE","description":"Mass assignment probe","amount":10,"expenseDate":"${today}","constructor":{"prototype":{"polluted":true}}}`,
      `{"category":"OFFICE","description":"Mass assignment probe","amount":10,"expenseDate":"${today}","prototype":{"polluted":true}}`,
    ]) {
      const attempt = await request(app).post('/api/v1/admin/expenses').set(auth).set('Content-Type', 'application/json').send(raw);
      assert.equal(attempt.status, 400, `POST /expenses must reject ${raw}`);
      assertSafeError(attempt, 'prototype pollution');
    }
    assert.equal(await Expense.countDocuments({ description: 'Mass assignment probe' }), 0);
    assert.equal(({} as any).polluted, undefined);
    assert.equal((Object.prototype as any).polluted, undefined);
    // The same fields are rejected on update.
    for (const payload of [
      { expenseNumber: 'EXP-19700101-BBBBBB' },
      { status: 'APPROVED' },
      { totalAmount: 1 },
      { approvedBy: String(admin._id) },
      { statusHistory: [] },
    ])
      assert.equal(
        (await request(app).patch(`/api/v1/admin/expenses/${draft}`).set(auth).send(payload)).status,
        400,
        `PATCH must reject ${JSON.stringify(payload)}`
      );

    /* ------------------------------------------------- Malformed and missing input */
    const missing = new mongoose.Types.ObjectId().toString();
    for (const [path, expected] of [
      [`/api/v1/admin/expenses/not-an-id`, 400],
      [`/api/v1/admin/expenses/${missing}`, 404],
    ] as const) {
      const attempt = await request(app).get(path).set(auth);
      assert.equal(attempt.status, expected, `GET ${path}`);
      assertSafeError(attempt, `GET ${path}`);
    }
    // A malformed or dangling cross-reference is a clean domain failure, never a
    // CastError and never a driver message.
    for (const body of [
      { supplier: 'nope' },
      { purchaseOrder: 'nope' },
      { purchaseOrder: '{"$ne":null}' },
      { supplier: missing },
      { purchaseOrder: missing },
    ]) {
      const attempt = await request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: 'OFFICE', description: 'Bad reference probe', amount: 10, expenseDate: today, ...body });
      assert.ok([400, 404].includes(attempt.status), `POST /expenses must refuse ${JSON.stringify(body)}: got ${attempt.status}`);
      assertSafeError(attempt, `expense reference ${JSON.stringify(body)}`);
    }
    assert.equal(await Expense.countDocuments({ description: 'Bad reference probe' }), 0);
    for (const body of [
      { category: 'PAYROLL', description: 'Salaries', amount: 1, expenseDate: today },
      { category: 'OFFICE', description: 'x', amount: 1, expenseDate: today },
      { category: 'OFFICE', description: 'Zero amount', amount: 0, expenseDate: today },
      { category: 'OFFICE', description: 'Negative', amount: -5, expenseDate: today },
      { category: 'OFFICE', description: 'Not a number', amount: 'many', expenseDate: today },
      { category: 'OFFICE', description: 'Operator amount', amount: { $gt: 0 }, expenseDate: today },
      { category: 'OFFICE', description: 'Bad date', amount: 5, expenseDate: 'yesterday' },
      { category: 'OFFICE', description: 'Missing date', amount: 5 },
      { category: 'OFFICE', description: 'Negative tax', amount: 5, taxAmount: -1, expenseDate: today },
      { category: 'OFFICE', description: 'Bad method', amount: 5, expenseDate: today, paymentMethod: 'CRYPTO' },
    ]) {
      const attempt = await request(app).post('/api/v1/admin/expenses').set(auth).send(body);
      assert.equal(attempt.status, 400, `POST /expenses must reject ${JSON.stringify(body)}`);
      assertSafeError(attempt, 'expense validation');
    }
    // There is no payroll category because there is no payroll module.
    assert.equal(await Expense.countDocuments({ category: 'PAYROLL' }), 0);
    assert.equal((await request(app).patch(`/api/v1/admin/expenses/${draft}`).set(auth).send({})).status, 400);

    /* --------------------------------------------------------- Lifecycle: DRAFT edit */
    response = await request(app)
      .patch(`/api/v1/admin/expenses/${draft}`)
      .set(auth)
      .send({ amount: 1_200, taxAmount: 100, description: 'Ad spend, corrected' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.amount, 1_200);
    // The total is recomputed server-side from the new amount and tax.
    assert.equal(response.body.data.totalAmount, 1_300);
    assert.equal(response.body.data.status, 'DRAFT');

    /* ------------------------------------------------------- Lifecycle: approval */
    assert.equal((await request(app).patch(`/api/v1/admin/expenses/${shippingExpense}/status`).set(auth).send({ status: 'DRAFT' })).status, 400);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/expenses/${shippingExpense}/status`).set(auth).send({ status: 'VOIDED' })).status,
      400,
      'voiding requires a reason'
    );
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/admin/expenses/${shippingExpense}/status`)
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ status: 'APPROVED' })
      ).status,
      403
    );
    response = await request(app).patch(`/api/v1/admin/expenses/${shippingExpense}/status`).set(auth).send({ status: 'APPROVED' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'APPROVED');
    assert.ok(response.body.data.approvedAt);
    assert.equal(String((await Expense.findById(shippingExpense).lean()).approvedBy), String(admin._id));

    /* --------------------------------------------- Immutability after approval (§9) */
    // An approved amount is financial history. Editing it is refused outright; the
    // documented correction path is to void it and record a replacement.
    for (const body of [{ amount: 999_999 }, { taxAmount: 0 }, { category: 'OFFICE' }, { description: 'rewritten' }, { expenseDate: today }]) {
      const attempt = await request(app).patch(`/api/v1/admin/expenses/${shippingExpense}`).set(auth).send(body);
      assert.equal(attempt.status, 409, `approved expense must refuse ${JSON.stringify(body)}`);
      assert.equal(attempt.body.error.code, 'EXPENSE_NOT_EDITABLE');
      assertSafeError(attempt, 'approved expense edit');
    }
    const stillApproved = await Expense.findById(shippingExpense).lean();
    assert.equal(stillApproved.amount, 5_000);
    assert.equal(stillApproved.totalAmount, 5_500);
    // Re-approving is a no-op failure, not a second approval.
    let attempt = await request(app).patch(`/api/v1/admin/expenses/${shippingExpense}/status`).set(auth).send({ status: 'APPROVED' });
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body.error.code, 'EXPENSE_NOT_APPROVABLE');
    // There is deliberately no expense DELETE at all.
    assert.equal((await request(app).delete(`/api/v1/admin/expenses/${shippingExpense}`).set(auth)).status, 404);
    assert.equal(await Expense.countDocuments({ _id: shippingExpense }), 1);

    /* --------------------------------------------------------- Lifecycle: voiding */
    response = await request(app).patch(`/api/v1/admin/expenses/${voided}/status`).set(auth).send({ status: 'VOIDED', reason: 'Charged twice by the vendor' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'VOIDED');
    assert.equal(response.body.data.voidReason, 'Charged twice by the vendor');
    assert.equal(String((await Expense.findById(voided).lean()).voidedBy), String(admin._id));
    // Voided is terminal: no second void, no resurrection to APPROVED, no edits.
    attempt = await request(app).patch(`/api/v1/admin/expenses/${voided}/status`).set(auth).send({ status: 'VOIDED', reason: 'Again' });
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body.error.code, 'EXPENSE_ALREADY_VOIDED');
    assert.equal((await request(app).patch(`/api/v1/admin/expenses/${voided}/status`).set(auth).send({ status: 'APPROVED' })).status, 409);
    assert.equal((await request(app).patch(`/api/v1/admin/expenses/${voided}`).set(auth).send({ amount: 1 })).status, 409);
    // The record survives the reversal so the total can still be explained later.
    assert.equal((await Expense.findById(voided).lean()).amount, 7_000);

    // Status history records every transition it went through.
    const history = (await request(app).get(`/api/v1/admin/expenses/${voided}`).set(auth)).body.data.statusHistory;
    assert.deepEqual(
      history.map((entry: any) => [entry.from, entry.to]),
      [
        [null, 'DRAFT'],
        ['DRAFT', 'VOIDED'],
      ]
    );

    /* --------------------------------------- Concurrent approval must not race (§55) */
    const contended = (
      await request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: 'UTILITIES', description: 'Contended approval', amount: 400, expenseDate: today })
    ).body.data.id;
    const racedApprovals = await Promise.all(
      Array.from({ length: 4 }, () => request(app).patch(`/api/v1/admin/expenses/${contended}/status`).set(auth).send({ status: 'APPROVED' }))
    );
    assert.equal(racedApprovals.filter(r => r.status === 200).length, 1, 'exactly one concurrent approval may win');
    assert.equal(racedApprovals.filter(r => r.status === 409).length, 3);
    const settled = await Expense.findById(contended).lean();
    assert.equal(settled.status, 'APPROVED');
    // One approval means exactly one approval entry, never four.
    assert.equal(settled.statusHistory.filter((entry: any) => entry.to === 'APPROVED').length, 1);
    assert.equal(await AuditLog.countDocuments({ resourceId: String(contended), action: 'EXPENSE_APPROVED' }), 1);

    // An approve and a void arriving together must also settle on one outcome.
    const contested = (
      await request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: 'TRAVEL', description: 'Contested reversal', amount: 600, expenseDate: today })
    ).body.data.id;
    const mixed = await Promise.all([
      request(app).patch(`/api/v1/admin/expenses/${contested}/status`).set(auth).send({ status: 'APPROVED' }),
      request(app).patch(`/api/v1/admin/expenses/${contested}/status`).set(auth).send({ status: 'VOIDED', reason: 'Cancelled trip' }),
    ]);
    const contestedDoc = await Expense.findById(contested).lean();
    assert.ok(['APPROVED', 'VOIDED'].includes(contestedDoc.status));
    assert.equal(mixed.filter(r => r.status === 200).length >= 1, true);
    assert.ok(contestedDoc.status !== 'DRAFT', 'a contested transition must still leave a settled status');

    /* ------------------------------------- APPROVED → VOIDED, the only reversal (§9) */
    // The two race probes are reversed here, which both exercises the approved-to-
    // voided transition and removes them from every realized total below, leaving the
    // arithmetic in the rest of this test driven only by the expenses under test.
    for (const id of [contended, contested]) {
      const reversal = await request(app)
        .patch(`/api/v1/admin/expenses/${id}/status`)
        .set(auth)
        .send({ status: 'VOIDED', reason: 'Reversed after the concurrency probe' });
      assert.ok([200, 409].includes(reversal.status), `void after race: got ${reversal.status}`);
      const document = await Expense.findById(id).lean();
      assert.equal(document.status, 'VOIDED');
      // The approved amount is preserved, not erased.
      assert.ok(document.amount > 0);
    }
    const reversedHistory = (await Expense.findById(contended).lean()).statusHistory.map((entry: any) => [entry.from, entry.to]);
    assert.deepEqual(reversedHistory, [
      [null, 'DRAFT'],
      ['DRAFT', 'APPROVED'],
      ['APPROVED', 'VOIDED'],
    ]);

    /* ------------------------------------------------------------- Expense listing */
    response = await request(app).get('/api/v1/admin/expenses').set(auth).query({ page: 1, limit: 50 });
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.total, 5, 'only the five real expenses exist; every rejected probe was never written');
    assert.equal(response.body.meta.totalPages, 1);
    assert.equal(response.body.meta.hasNextPage, false);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ status: 'APPROVED' })).body.meta.total, 1);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ status: 'DRAFT' })).body.meta.total, 1);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ status: 'VOIDED' })).body.meta.total, 3);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ category: 'SHIPPING' })).body.meta.total, 1);
    assert.equal(
      (
        await request(app)
          .get('/api/v1/admin/expenses')
          .set(auth)
          .query({ supplier: String(supplier._id) })
      ).body.meta.total,
      1
    );
    assert.equal(
      (
        await request(app)
          .get('/api/v1/admin/expenses')
          .set(auth)
          .query({ purchaseOrder: String(livePo._id) })
      ).body.meta.total,
      1
    );
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ paymentMethod: 'BANK_TRANSFER' })).body.meta.total, 1);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ minAmount: 5_000 })).body.meta.total, 2);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ maxAmount: 1_300 })).body.meta.total, 3);
    // Pagination is real: two pages of two from five rows, with distinct ids.
    const firstPage = await request(app).get('/api/v1/admin/expenses').set(auth).query({ page: 1, limit: 2, sort: 'totalAmount', direction: 'desc' });
    const secondPage = await request(app).get('/api/v1/admin/expenses').set(auth).query({ page: 2, limit: 2, sort: 'totalAmount', direction: 'desc' });
    assert.equal(firstPage.body.data.length, 2);
    assert.equal(secondPage.body.data.length, 2);
    assert.equal(firstPage.body.meta.totalPages, 3);
    assert.equal(firstPage.body.meta.hasNextPage, true);
    assert.equal(secondPage.body.meta.hasPreviousPage, true);
    assert.equal(new Set([...firstPage.body.data, ...secondPage.body.data].map((row: any) => row.id)).size, 4);
    const descending = firstPage.body.data.map((row: any) => row.totalAmount);
    assert.deepEqual(
      descending,
      [...descending].sort((a: number, b: number) => b - a)
    );
    const ascending = (await request(app).get('/api/v1/admin/expenses').set(auth).query({ limit: 50, sort: 'totalAmount', direction: 'asc' })).body.data.map(
      (row: any) => row.totalAmount
    );
    assert.deepEqual(
      ascending,
      [...ascending].sort((a: number, b: number) => a - b)
    );

    /* ------------------------------------------------- Literal-safe search (§41) */
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ search: 'Courier' })).body.meta.total, 1);
    assert.equal((await request(app).get('/api/v1/admin/expenses').set(auth).query({ search: 'INV-9' })).body.meta.total, 1);
    assert.equal(
      (await request(app).get('/api/v1/admin/expenses').set(auth).query({ search: 'EXP-' })).body.meta.total,
      5,
      'the expense number prefix is matched literally'
    );
    // Regex metacharacters are escaped, so a catch-all pattern matches nothing rather
    // than every row, and a pathological pattern cannot be evaluated at all.
    for (const search of ['.*', '.+', '^', '(', '[', '\\', '(a+)+$', '.*Courier.*'])
      assert.equal(
        (await request(app).get('/api/v1/admin/expenses').set(auth).query({ search })).body.meta.total,
        0,
        `search ${JSON.stringify(search)} must match literally`
      );
    // Mongo operators arriving as query objects are refused by the strict schema.
    for (const query of [
      'status[$ne]=VOIDED',
      'category[$exists]=true',
      'search[$regex]=.*',
      'minAmount[$gt]=0',
      'supplier[$ne]=x',
      'sort=amount',
      'sort[]=amount',
      'direction=sideways',
      'limit=1000',
      'page=0',
      'unknown=1',
    ]) {
      const probe = await request(app).get(`/api/v1/admin/expenses?${query}`).set(auth);
      assert.equal(probe.status, 400, `list must reject ?${query}`);
      assertSafeError(probe, `list ?${query}`);
    }
    const inverted = await request(app).get('/api/v1/admin/expenses').set(auth).query({ from: '2026-06-01', to: '2026-01-01' });
    assert.equal(inverted.status, 400);
    assert.equal(inverted.body.error.code, 'RANGE_INVALID');
    const invertedAmounts = await request(app).get('/api/v1/admin/expenses').set(auth).query({ minAmount: 900, maxAmount: 100 });
    assert.equal(invertedAmounts.status, 400);
    assert.equal(invertedAmounts.body.error.code, 'AMOUNT_RANGE_INVALID');

    /* ------------------------------------------------------------ Expense summary */
    response = await request(app).get('/api/v1/admin/expenses/summary').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.draft.count, 1);
    assert.equal(response.body.data.draft.total, 1_300);
    assert.equal(response.body.data.approved.count, 1);
    assert.equal(response.body.data.approved.total, 5_500);
    assert.equal(response.body.data.voided.count, 3);
    assert.equal(response.body.data.voided.total, 8_000);
    // §17: only APPROVED value is realized. DRAFT and VOIDED are visible but excluded.
    assert.equal(response.body.data.realizedExpenses, 5_500);
    assert.equal(response.body.data.basis, 'APPROVED_EXPENSES_ONLY');
    assert.deepEqual(
      response.body.data.byCategory.map((row: any) => [row.category, row.amount, row.taxAmount, row.totalAmount]),
      [['SHIPPING', 5_000, 500, 5_500]],
      'only approved categories carry realized value'
    );

    /* ------------------------------------------------------------ Finance dashboard */
    response = await request(app).get('/api/v1/admin/finance/dashboard').set(auth);
    assert.equal(response.status, 200);
    const dashboard = response.body.data;
    // §43: every figure below is the shared formula, not a dashboard-local one.
    assert.equal(dashboard.revenue.grossSales, 110_000, 'gross sales is every order in the window regardless of status');
    // §46/§47: the cancelled order and the delivered-but-uncollected COD order both
    // contribute to gross sales and to neither realized revenue nor profit.
    assert.equal(dashboard.revenue.realizedRevenue, 62_500);
    assert.equal(dashboard.revenue.refunds, 2_500, 'completed and pending refunds count; the failed one never does');
    assert.equal(dashboard.revenue.netSales, 107_500);
    assert.equal(dashboard.revenue.netRealizedRevenue, 60_000);
    assert.equal(dashboard.revenue.averageOrderValue, 27_500);
    assert.equal(dashboard.orders.total, 4);
    assert.equal(dashboard.orders.realized, 2);
    assert.equal(dashboard.orders.cancelled, 1);
    assert.equal(dashboard.orders.paid, 2);
    assert.equal(dashboard.orders.unpaid, 2);
    assert.equal(dashboard.orders.unpaidCodOrders, 1, 'delivered but uncollected');
    assert.equal(dashboard.orders.unpaidCodValue, 30_000);
    // Partially and fully refunded paid orders remain realized; accepted refunds
    // reduce revenue exactly once instead of making the original sale disappear.
    assert.deepEqual(
      dashboard.orders.byPaymentStatus.map((row: any) => [row.paymentStatus, row.orders, row.value]),
      [
        ['PARTIALLY_REFUNDED', 1, 52_500],
        ['REFUNDED', 1, 10_000],
        ['UNPAID', 2, 47_500],
      ]
    );
    // §14: the documented single cost method, from the immutable order-line snapshot.
    assert.equal(dashboard.cost.costOfGoodsSold, 30_000);
    assert.equal(dashboard.cost.basis, 'LATEST_PURCHASE_COST');
    assert.equal(dashboard.cost.snapshot.linesTotal, 2);
    assert.equal(dashboard.cost.snapshot.linesWithCostSnapshot, 1);
    assert.equal(dashboard.cost.snapshot.coverage, 50, 'the legacy line has no cost snapshot and is reported as missing, not as zero cost');
    assert.equal(dashboard.cost.snapshot.complete, false);
    assert.equal(dashboard.profit.grossProfit, 30_000);
    assert.equal(dashboard.profit.grossMargin, 50);
    assert.equal(dashboard.profit.operatingExpenses, 5_500, 'only the APPROVED expense is realized');
    assert.equal(dashboard.profit.operatingProfit, 24_500);
    assert.equal(dashboard.profit.operatingMargin, 40.83);
    assert.equal(dashboard.tax.collectedOnSales, 2_000);
    assert.equal(dashboard.tax.paidOnExpenses, 500);
    assert.equal(dashboard.basis, 'MANAGEMENT_REPORTING_NOT_STATUTORY_ACCOUNTING');
    assert.deepEqual(dashboard.refundsByStatus.pending, { count: 1, amount: 1_000 });
    assert.deepEqual(dashboard.refundsByStatus.completed, { count: 1, amount: 1_500 });
    assert.deepEqual(dashboard.refundsByStatus.failed, { count: 1, amount: 9_999 });
    assert.deepEqual(dashboard.refundsByStatus.counted, { count: 2, amount: 2_500 });
    assert.equal(dashboard.refundsByStatus.basis, 'ALL_REFUNDS_EXCEPT_FAILED_REDUCE_REVENUE');

    /* ------------------------------------- Purchasing is never an operating expense */
    // §13/§34/§48: ordered and received purchase value are reported beside the profit
    // figures and are absent from every one of them.
    assert.equal(dashboard.purchasing.orderedValue, 150_000, 'the DRAFT purchase order is not a commitment');
    assert.equal(dashboard.purchasing.orderedCount, 1);
    assert.equal(dashboard.purchasing.receivedValue, 60_000);
    assert.equal(dashboard.purchasing.receivedUnits, 4);
    assert.equal(dashboard.purchasing.receiptCount, 1);
    assert.equal(dashboard.purchasing.outstandingQuantity, 6);
    assert.equal(dashboard.purchasing.outstandingValue, 90_000);
    assert.equal(dashboard.purchasing.basis, 'PURCHASE_COMMITMENT_NOT_OPERATING_EXPENSE');
    assert.deepEqual(
      dashboard.purchasing.purchaseOrders.map((row: any) => [row.status, row.count, row.value]),
      [
        ['APPROVED', 1, 150_000],
        ['DRAFT', 1, 50_000],
      ]
    );
    // The 150,000 commitment and the 60,000 of goods received appear nowhere in the
    // realized expense or profit arithmetic.
    assert.equal(dashboard.profit.operatingExpenses, 5_500);
    assert.equal(dashboard.profit.operatingProfit, 24_500);
    assert.equal(
      dashboard.expensesByCategory.reduce((sum: number, row: any) => sum + row.totalAmount, 0),
      5_500,
      'no purchase order or goods receipt leaked into an expense category'
    );

    /* ------------------------------------------------- Period-over-period comparison */
    // §20: real arithmetic over a second bounded query. The preceding window is empty,
    // so the honest answer to "how much did this grow" is null, not a fabricated number.
    assert.ok(dashboard.comparison.previous.from < dashboard.comparison.previous.to);
    assert.equal(dashboard.comparison.grossSales.value, 0);
    assert.equal(dashboard.comparison.grossSales.change, null);
    assert.equal(dashboard.comparison.realizedRevenue.change, null);
    assert.equal(dashboard.comparison.netSales.change, null);
    assert.equal(dashboard.comparison.grossProfit.change, null);
    assert.equal(dashboard.comparison.operatingProfit.change, null);

    /* -------------------------------------------------------------- Range contract */
    // §40: one owner of the range rules, so every endpoint answers with the same code.
    // `/expenses` is excluded here because it is a filtered list with its own
    // independent `from`/`to` pair rather than a single reporting window.
    const rangedPaths = financePaths.filter(path => path !== '/expenses');
    for (const path of rangedPaths) {
      const url = `/api/v1/admin${path}`;
      for (const query of [
        { range: '7d', from: '2026-01-01', to: '2026-02-01' },
        { from: '2026-02-01' },
        { to: '2026-02-01' },
        { from: '2026-06-01', to: '2026-01-01' },
      ]) {
        const probe = await request(app).get(url).set(auth).query(query);
        assert.equal(probe.status, 400, `${url} must reject ${JSON.stringify(query)}`);
        assert.equal(probe.body.error.code, 'RANGE_INVALID', `${url} ${JSON.stringify(query)}`);
        assertSafeError(probe, `${url} range`);
      }
      // Unparseable bounds are refused by the schema before the resolver runs, which is
      // a different stable code for the same outcome: no query is ever executed.
      const unparseable = await request(app).get(url).set(auth).query({ from: 'nonsense', to: 'nonsense' });
      assert.equal(unparseable.status, 400);
      assertSafeError(unparseable, `${url} unparseable range`);
      const tooLarge = await request(app).get(url).set(auth).query({ from: '2020-01-01', to: '2026-01-01' });
      assert.equal(tooLarge.status, 400, `${url} must bound the window`);
      assert.equal(tooLarge.body.error.code, 'RANGE_TOO_LARGE');
      for (const query of [{ range: '400d' }, { range: '1d' }, { unknown: '1' }, { 'from[$gt]': '2026-01-01' }]) {
        const probe = await request(app).get(url).set(auth).query(query);
        assert.equal(probe.status, 400, `${url} must reject ${JSON.stringify(query)}`);
        assertSafeError(probe, `${url} strict query`);
      }
      // The 366-day boundary itself is accepted, so the limit is a real bound.
      assert.equal(
        (await request(app).get(url).set(auth).query({ from: '2026-01-01', to: '2026-12-31' })).status,
        200,
        `${url} must accept the maximum window`
      );
    }

    /* ------------------------------------------------------------ Finance analytics */
    response = await request(app).get('/api/v1/admin/finance/analytics').set(auth);
    assert.equal(response.status, 200);
    const analytics = response.body.data;
    assert.equal(analytics.maxRangeDays, 366);
    // §35/§37: the series are derived from the same formulas, so summing a series
    // reproduces the headline total exactly.
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(
      analytics.revenueByDate.reduce((sum: number, row: any) => sum + row.grossSales, 0),
      110_000
    );
    assert.equal(
      analytics.revenueByDate.reduce((sum: number, row: any) => sum + row.realizedRevenue, 0),
      62_500
    );
    assert.equal(
      analytics.revenueByDate.reduce((sum: number, row: any) => sum + row.costOfGoodsSold, 0),
      30_000
    );
    assert.equal(
      analytics.revenueByDate.reduce((sum: number, row: any) => sum + row.orders, 0),
      4
    );
    assert.ok(analytics.revenueByDate.some((row: any) => row.date === day));
    assert.equal(
      analytics.refundsByDate.reduce((sum: number, row: any) => sum + row.value, 0),
      2_500
    );
    assert.equal(
      analytics.refundsByDate.reduce((sum: number, row: any) => sum + row.refunds, 0),
      2
    );
    assert.equal(
      analytics.expensesByDate.reduce((sum: number, row: any) => sum + row.totalAmount, 0),
      5_500
    );
    assert.equal(
      analytics.expensesByDate.reduce((sum: number, row: any) => sum + row.taxAmount, 0),
      500
    );
    assert.equal(
      analytics.taxByDate.reduce((sum: number, row: any) => sum + row.taxCollected, 0),
      2_000
    );
    // The totals block agrees with the dashboard for the same window, figure for figure.
    assert.equal(analytics.totals.grossSales, dashboard.revenue.grossSales);
    assert.equal(analytics.totals.realizedRevenue, dashboard.revenue.realizedRevenue);
    assert.equal(analytics.totals.refunds, dashboard.revenue.refunds);
    assert.equal(analytics.totals.netSales, dashboard.revenue.netSales);
    assert.equal(analytics.totals.costOfGoodsSold, dashboard.cost.costOfGoodsSold);
    assert.equal(analytics.totals.grossProfit, dashboard.profit.grossProfit);
    assert.equal(analytics.totals.operatingExpenses, dashboard.profit.operatingExpenses);
    assert.equal(analytics.totals.operatingProfit, dashboard.profit.operatingProfit);
    assert.equal(analytics.totals.taxCollected, dashboard.tax.collectedOnSales);

    /* --------------------------------------------------------- Profit and loss (§18) */
    response = await request(app).get('/api/v1/admin/finance/profit-loss').set(auth);
    assert.equal(response.status, 200);
    const pl = response.body.data;
    assert.equal(pl.revenue.grossSales, 110_000);
    assert.equal(pl.revenue.realizedRevenue, 62_500);
    assert.equal(pl.revenue.refunds, 2_500);
    assert.equal(pl.revenue.netSales, 107_500);
    assert.equal(pl.revenue.netRevenue, 60_000);
    assert.equal(pl.costOfGoodsSold, 30_000);
    assert.equal(pl.grossProfit, 30_000);
    assert.equal(pl.grossMargin, 50);
    assert.equal(pl.operatingExpenses.total, 5_500);
    assert.equal(pl.operatingProfit, 24_500);
    assert.equal(pl.operatingMargin, 40.83);
    assert.equal(pl.salesTaxCollected, 2_000);
    assert.equal(pl.expenseTaxPaid, 500);
    assert.equal(pl.costBasis, 'LATEST_PURCHASE_COST');
    // The arithmetic is internally closed: net revenue − COGS − expenses = the bottom line.
    assert.equal(pl.revenue.netRevenue - pl.costOfGoodsSold - pl.operatingExpenses.total, pl.operatingProfit);
    // §18/§22: the bottom line is never presented as audited net income.
    const serialized = JSON.stringify(pl);
    for (const forbidden of ['netIncome', 'NET_INCOME', 'GAAP_COMPLIANT', 'IFRS_COMPLIANT', 'auditedNetIncome'])
      assert.ok(!serialized.includes(forbidden), `profit and loss must not claim ${forbidden}`);
    assert.equal(pl.basis, 'MANAGEMENT_PROFIT_AND_LOSS_SUMMARY');
    assert.match(pl.disclaimer, /not a GAAP or IFRS financial statement/i);
    assert.match(pl.disclaimer, /not audited net income/i);
    for (const exclusion of [
      'CORPORATE_INCOME_TAX',
      'DEPRECIATION_AND_AMORTISATION',
      'FINANCING_COSTS_AND_INTEREST',
      'ACCRUALS_AND_PERIOD_CUT_OFF_ADJUSTMENTS',
      'REFUND_COST_REVERSAL',
    ])
      assert.ok(pl.excludes.includes(exclusion), `profit and loss must disclose that it excludes ${exclusion}`);
    // §14: no cost method other than the documented one is ever claimed.
    for (const method of ['FIFO', 'LIFO', 'WEIGHTED_AVERAGE', 'STANDARD_COST']) assert.ok(!serialized.includes(method), `no ${method} costing may be claimed`);

    /* ------------------------- §43: the Phase D sales dashboard must still agree */
    // Phase F reuses the Phase D semantics rather than redefining them, so the same
    // window read through the older endpoint returns the same money.
    const sales = (await request(app).get('/api/v1/admin/sales/dashboard').set(auth).query({ range: '30d' })).body.data;
    const financeSame = (await request(app).get('/api/v1/admin/finance/dashboard').set(auth).query({ range: '30d' })).body.data;
    assert.equal(sales.grossSales, financeSame.revenue.grossSales, 'grossSales must agree across dashboards');
    assert.equal(sales.realizedRevenue, financeSame.revenue.realizedRevenue, 'realizedRevenue must agree across dashboards');
    assert.equal(sales.refunds, financeSame.revenue.refunds, 'refunds must agree across dashboards');
    assert.equal(sales.netSales, financeSame.revenue.netSales, 'netSales must agree across dashboards');
    assert.equal(sales.orders, financeSame.orders.total);
    assert.equal(sales.cancelledOrders, financeSame.orders.cancelled);
    assert.equal(Number(sales.averageOrderValue.toFixed(2)), financeSame.revenue.averageOrderValue);

    /* ------------------------------------------- §15: historical COGS is immutable */
    // The cost snapshot lives on the order line. Repricing the product now must not
    // move a single historical figure.
    await Product.updateOne({ _id: widget._id }, { $set: { costPrice: 99_000 } });
    await Product.updateOne({ _id: legacy._id }, { $set: { costPrice: 4_000 } });
    const afterRepricing = (await request(app).get('/api/v1/admin/finance/profit-loss').set(auth)).body.data;
    assert.equal(afterRepricing.costOfGoodsSold, 30_000, 'a later costPrice change must not rewrite historical COGS');
    assert.equal(afterRepricing.grossProfit, 30_000);
    assert.equal(afterRepricing.grossMargin, 50);
    assert.equal(afterRepricing.operatingProfit, 24_500);
    // The legacy line still has no snapshot: giving the product a cost today does not
    // retroactively invent a cost for an order placed before one was recorded.
    assert.equal(afterRepricing.cogsCoverage.linesWithCostSnapshot, 1);
    assert.equal(afterRepricing.cogsCoverage.coverage, 50);
    assert.equal(afterRepricing.cogsCoverage.complete, false);
    const untouched = await Order.findById(realizedOrder._id).lean();
    assert.equal(untouched.items[0].unitCost, 15_000);
    assert.equal(untouched.items[0].lineCost, 30_000);

    /* ------------------------------ §11/§47: COD collection is confirmed, never inferred */
    // The delivered COD order has been sitting outside revenue the whole time. Only an
    // explicit payment-status transition moves it in.
    const beforeCollection = (await request(app).get('/api/v1/admin/finance/dashboard').set(auth)).body.data;
    assert.equal(beforeCollection.revenue.realizedRevenue, 62_500);
    assert.equal(beforeCollection.orders.unpaidCodOrders, 1);
    const collected = await request(app).patch(`/api/v1/admin/orders/${unpaidCod._id}/payment-status`).set(auth).send({ paymentStatus: 'PAID' });
    assert.equal(collected.status, 200, `confirming COD collection: ${JSON.stringify(collected.body)}`);
    const afterCollection = (await request(app).get('/api/v1/admin/finance/dashboard').set(auth)).body.data;
    assert.equal(afterCollection.revenue.grossSales, 110_000, 'collecting cash does not change gross sales');
    assert.equal(afterCollection.revenue.realizedRevenue, 92_500, 'the collected COD order is now realized');
    assert.equal(afterCollection.revenue.netRealizedRevenue, 90_000);
    assert.equal(afterCollection.orders.realized, 3);
    assert.equal(afterCollection.orders.unpaidCodOrders, 0);
    assert.equal(afterCollection.orders.unpaidCodValue, 0);
    // Its cost snapshot enters COGS at the same moment, from the order line.
    assert.equal(afterCollection.cost.costOfGoodsSold, 45_000);
    assert.equal(afterCollection.cost.snapshot.linesTotal, 3);
    assert.equal(afterCollection.cost.snapshot.linesWithCostSnapshot, 2);
    assert.equal(afterCollection.cost.snapshot.coverage, 66.67);
    assert.equal(afterCollection.profit.grossProfit, 45_000);
    assert.equal(afterCollection.profit.operatingProfit, 39_500);
    // The cancelled order never joins revenue no matter what else changes.
    assert.equal(afterCollection.orders.cancelled, 1);

    /* ------------------------------------------------------------- Audit trail (§24) */
    assert.equal(await AuditLog.countDocuments({ resourceType: 'Expense', action: 'EXPENSE_CREATED' }), 5);
    assert.equal(await AuditLog.countDocuments({ resourceType: 'Expense', action: 'EXPENSE_UPDATED' }), 1);
    assert.equal(await AuditLog.countDocuments({ resourceType: 'Expense', action: 'EXPENSE_VOIDED' }), 3);
    assert.ok((await AuditLog.countDocuments({ resourceType: 'Expense', action: 'EXPENSE_APPROVED' })) >= 2);
    assert.equal(await AuditLog.countDocuments({ action: 'ORDER_PAYMENT_UPDATED' }), 1, 'confirming COD collection is auditable');
    const approvalAudit = await AuditLog.findOne({ resourceId: String(shippingExpense), action: 'EXPENSE_APPROVED' }).lean();
    assert.equal(String(approvalAudit.actor), String(admin._id));
    assert.equal(approvalAudit.metadata.totalAmount, 5_500);
    const voidAudit = await AuditLog.findOne({ resourceId: String(voided), action: 'EXPENSE_VOIDED' }).lean();
    assert.equal(voidAudit.metadata.from, 'DRAFT');
    assert.equal(voidAudit.metadata.reason, 'Charged twice by the vendor');
    // Rejected writes leave no audit trail, because nothing happened.
    assert.equal(await AuditLog.countDocuments({ 'metadata.description': 'Mass assignment probe' }), 0);
    // Reporting is read-only: reading money never writes history.
    const auditsBeforeReads = await AuditLog.countDocuments({});
    for (const path of financePaths) await request(app).get(`/api/v1/admin${path}`).set(auth);
    assert.equal(await AuditLog.countDocuments({}), auditsBeforeReads, 'reading a finance endpoint must not write an audit row');

    /* ------------------------------------------------- No internals ever reach a client */
    // §25/§50: every failure shape above already went through assertSafeError; these are
    // the remaining shapes that most easily leak a driver message.
    for (const probe of [
      request(app).get('/api/v1/admin/expenses/../../etc/passwd').set(auth),
      request(app)
        .get(`/api/v1/admin/expenses/${String(admin._id)}zz`)
        .set(auth),
      request(app).patch(`/api/v1/admin/expenses/nope/status`).set(auth).send({ status: 'APPROVED' }),
      request(app).patch(`/api/v1/admin/expenses/${missing}/status`).set(auth).send({ status: 'APPROVED' }),
      request(app).patch(`/api/v1/admin/expenses/${missing}`).set(auth).send({ amount: 5 }),
      request(app)
        .post('/api/v1/admin/expenses')
        .set(auth)
        .send({ category: { $ne: null }, description: 'op', amount: 5, expenseDate: today }),
      request(app).post('/api/v1/admin/expenses').set(auth).send('not json').set('Content-Type', 'application/json'),
    ]) {
      const attempt = await probe;
      assert.ok(attempt.status >= 400 && attempt.status < 500, `expected a client error, got ${attempt.status}`);
      assertSafeError(attempt, 'finance failure shape');
    }
    // A duplicate expense number can never be forced, because a client cannot set one.
    assert.equal(new Set((await Expense.find({}).select('expenseNumber').lean()).map((row: any) => row.expenseNumber)).size, 5);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
