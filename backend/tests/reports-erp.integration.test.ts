import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Expense } from '../src/models/expense.js';
import { GoodsReceipt, PurchaseReturn } from '../src/models/goodsReceipt.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { PurchaseOrder } from '../src/models/purchaseOrder.js';
import { Refund } from '../src/models/refund.js';
import { ReturnRequest } from '../src/models/return.js';
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

const DAY = 86_400_000;
const HOUR = 3_600_000;
const today = new Date().toISOString().slice(0, 10);
/** Every report is keyed by name so a row assertion never depends on ObjectId ordering. */
const byKey = <T extends Record<string, any>>(rows: T[], key: string) => new Map(rows.map(row => [String(row[key]), row]));

test('report ERP serves bounded, authorized, mutually consistent aggregates', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([
      User.init(),
      Order.init(),
      Product.init(),
      Expense.init(),
      Refund.init(),
      ReturnRequest.init(),
      Supplier.init(),
      PurchaseOrder.init(),
      GoodsReceipt.init(),
      PurchaseReturn.init(),
      InventoryBalance.init(),
      InventoryMovement.init(),
    ]);
    const [admin, buyerA, buyerB] = await User.create([
      { name: 'Admin', email: 'rep-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' },
      { name: 'Buyer A', email: 'rep-a@test.local', password: 'Secret123!', role: 'CUSTOMER' },
      { name: 'Buyer B', email: 'rep-b@test.local', password: 'Secret123!', role: 'CUSTOMER' },
    ]);
    const token = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const customerToken = jwt.sign({ sub: String(buyerA._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${token}` };
    const get = (path: string, query?: Record<string, unknown>) =>
      request(app)
        .get(`/api/v1/admin${path}`)
        .query(query ?? {})
        .set(auth);

    // `alpha` and `beta` share a category so category profit can be reconciled
    // against product profit; `gamma` is never sold, so it exercises the stock
    // reports without touching a revenue figure.
    const [alpha, beta, gamma] = await Product.create([
      {
        name: 'Report alpha',
        slug: 'report-alpha',
        sku: 'RPT-A',
        description: 'x',
        category: 'Audio',
        image: 'https://e.test/x',
        price: 20_000,
        costPrice: 12_000,
        stock: 8,
        lowStockThreshold: 3,
      },
      {
        name: 'Report beta',
        slug: 'report-beta',
        sku: 'RPT-B',
        description: 'x',
        category: 'Audio',
        image: 'https://e.test/x',
        price: 5_000,
        costPrice: 3_000,
        stock: 0,
        lowStockThreshold: 5,
      },
      {
        name: 'Report gamma',
        slug: 'report-gamma',
        sku: 'RPT-G',
        description: 'x',
        category: 'Video',
        image: 'https://e.test/x',
        price: 2_000,
        costPrice: 1_000,
        stock: 4,
        lowStockThreshold: 5,
      },
    ]);
    const supplier = await Supplier.create({ name: 'Report Supplier', code: 'RSUP-1', createdBy: admin._id });
    const warehouse = await Warehouse.create({ name: 'Report WH', code: 'RWH' });
    const [bayOne, bayTwo] = await StockLocation.create([
      { warehouse: warehouse._id, name: 'Bay 1', code: 'BAY-R1' },
      { warehouse: warehouse._id, name: 'Bay 2', code: 'BAY-R2' },
    ]);

    /* --------------------------------------------------------------------- Orders */
    // Four orders covering every revenue case the reports must keep apart:
    // realized, delivered-but-uncollected COD, cancelled, and a legacy line with
    // no cost snapshot.
    const [realized, unpaidCod, cancelled, legacyOrder] = await Order.create([
      {
        customer: buyerA._id,
        orderNumber: 'MK-R-1',
        idempotencyKey: 'r1',
        items: [
          { productId: alpha._id, name: alpha.name, sku: alpha.sku, unitPrice: 20_000, quantity: 2, lineSubtotal: 40_000, unitCost: 12_000, lineCost: 24_000 },
        ],
        shippingAddress: address,
        subtotal: 40_000,
        discount: 0,
        shipping: 300,
        tax: 700,
        total: 41_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: buyerA._id,
        orderNumber: 'MK-R-2',
        idempotencyKey: 'r2',
        items: [{ productId: beta._id, name: beta.name, sku: beta.sku, unitPrice: 5_000, quantity: 1, lineSubtotal: 5_000, unitCost: 3_000, lineCost: 3_000 }],
        shippingAddress: address,
        subtotal: 5_000,
        total: 5_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: buyerB._id,
        orderNumber: 'MK-R-3',
        idempotencyKey: 'r3',
        items: [
          { productId: alpha._id, name: alpha.name, sku: alpha.sku, unitPrice: 20_000, quantity: 1, lineSubtotal: 20_000, unitCost: 12_000, lineCost: 12_000 },
        ],
        shippingAddress: address,
        subtotal: 20_000,
        total: 20_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'CANCELLED',
      },
      {
        customer: buyerB._id,
        orderNumber: 'MK-R-4',
        idempotencyKey: 'r4',
        // Pre-snapshot shape: revenue with no recorded cost. It must lower the
        // reported COGS coverage rather than silently cost zero.
        items: [{ productId: beta._id, name: beta.name, sku: beta.sku, unitPrice: 5_000, quantity: 2, lineSubtotal: 10_000 }],
        shippingAddress: address,
        subtotal: 10_000,
        total: 10_000,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PAID',
        orderStatus: 'DELIVERED',
      },
    ]);

    // Fulfilment timing is read from the order's own status history, so only this
    // order can contribute to the averages. The offsets are relative to the row's
    // real `createdAt`, which makes the expected hours exact rather than drifting.
    const placedAt = (await Order.findById(realized._id).lean()).createdAt.getTime();
    await Order.updateOne(
      { _id: realized._id },
      {
        $set: {
          statusHistory: [
            { from: 'PROCESSING', to: 'SHIPPED', at: new Date(placedAt + 2 * HOUR) },
            { from: 'SHIPPED', to: 'DELIVERED', at: new Date(placedAt + 5 * HOUR) },
          ],
        },
      }
    );

    await Refund.create({
      refundNumber: 'RF-R-1',
      order: realized._id,
      amount: 1_200,
      currency: 'PKR',
      status: 'COMPLETED',
      reason: 'Damaged',
      paymentMethod: 'CASH_ON_DELIVERY',
      processedBy: admin._id,
      idempotencyKey: 'rr1',
    });
    await ReturnRequest.create({
      returnNumber: 'RTN-R-1',
      order: realized._id,
      customer: buyerA._id,
      items: [{ productId: alpha._id, quantity: 1 }],
      reason: 'Wrong colour',
      status: 'APPROVED',
    });

    /* ----------------------------------------------------------------- Procurement */
    // A live commitment partly received, plus a draft that is not a commitment at
    // all. Neither may ever surface as an operating expense.
    const [livePo] = await PurchaseOrder.create([
      {
        poNumber: 'PO-R-1',
        supplier: supplier._id,
        warehouse: warehouse._id,
        location: bayOne._id,
        status: 'APPROVED',
        items: [
          {
            product: alpha._id,
            name: alpha.name,
            sku: alpha.sku,
            quantityOrdered: 10,
            unitCost: 10_000,
            lineSubtotal: 100_000,
            quantityReceived: 3,
            quantityAccepted: 3,
          },
        ],
        subtotal: 100_000,
        total: 100_000,
        createdBy: admin._id,
      },
      {
        poNumber: 'PO-R-2',
        supplier: supplier._id,
        warehouse: warehouse._id,
        location: bayOne._id,
        status: 'DRAFT',
        items: [{ product: beta._id, name: beta.name, sku: beta.sku, quantityOrdered: 20, unitCost: 2_000, lineSubtotal: 40_000 }],
        subtotal: 40_000,
        total: 40_000,
        createdBy: admin._id,
      },
    ]);
    await GoodsReceipt.create({
      receiptNumber: 'GRN-R-1',
      purchaseOrder: livePo._id,
      supplier: supplier._id,
      warehouse: warehouse._id,
      location: bayOne._id,
      items: [{ purchaseOrderItem: livePo.items[0]._id, product: alpha._id, name: alpha.name, unitCost: 10_000, quantityAccepted: 3, quantityRejected: 1 }],
      totalAccepted: 3,
      totalRejected: 1,
      acceptedValue: 30_000,
      receivedBy: admin._id,
      idempotencyKey: 'grr1',
    });
    await PurchaseReturn.create({
      returnNumber: 'PRT-R-1',
      purchaseOrder: livePo._id,
      supplier: supplier._id,
      warehouse: warehouse._id,
      location: bayOne._id,
      items: [{ purchaseOrderItem: livePo.items[0]._id, product: alpha._id, name: alpha.name, unitCost: 10_000, quantity: 1 }],
      totalQuantity: 1,
      returnedValue: 10_000,
      reason: 'Faulty batch',
      createdBy: admin._id,
      idempotencyKey: 'prr1',
    });

    /* -------------------------------------------------------------------- Inventory */
    // `alpha` is stocked across two locations so the report has to aggregate the
    // ledger rather than read a single row; `beta` is fully reserved, and `gamma`
    // sits on its low-stock threshold.
    await InventoryBalance.create([
      { product: alpha._id, warehouse: warehouse._id, location: bayOne._id, quantityOnHand: 6, quantityReserved: 1 },
      { product: alpha._id, warehouse: warehouse._id, location: bayTwo._id, quantityOnHand: 4, quantityReserved: 1 },
      { product: beta._id, warehouse: warehouse._id, location: bayOne._id, quantityOnHand: 3, quantityReserved: 3 },
      { product: gamma._id, warehouse: warehouse._id, location: bayOne._id, quantityOnHand: 4, quantityReserved: 0 },
    ]);
    await InventoryMovement.create([
      { product: alpha._id, warehouse: warehouse._id, location: bayOne._id, type: 'INITIAL', quantityDelta: 10 },
      { product: alpha._id, warehouse: warehouse._id, location: bayOne._id, type: 'ORDER', quantityDelta: -2 },
      { product: alpha._id, warehouse: warehouse._id, location: bayOne._id, type: 'RETURN', quantityDelta: 1 },
      { product: beta._id, warehouse: warehouse._id, location: bayOne._id, type: 'INITIAL', quantityDelta: 3 },
      { product: gamma._id, warehouse: warehouse._id, location: bayOne._id, type: 'INITIAL', quantityDelta: 5 },
      { product: gamma._id, warehouse: warehouse._id, location: bayOne._id, type: 'ADJUSTMENT', quantityDelta: -1 },
    ]);

    /* --------------------------------------------------------------------- Expenses */
    // Recorded through the API so the reports read exactly what the expense
    // module writes. Only the approved one may ever reach an operating total.
    const expense = async (body: Record<string, unknown>) => (await request(app).post('/api/v1/admin/expenses').set(auth).send(body)).body.data.id;
    const approvedExpense = await expense({
      category: 'SHIPPING',
      description: 'Courier settlement',
      amount: 2_000,
      taxAmount: 200,
      expenseDate: new Date().toISOString(),
    });
    const draftExpense = await expense({ category: 'MARKETING', description: 'Ad spend, still draft', amount: 900, expenseDate: new Date().toISOString() });
    const voidedExpense = await expense({ category: 'SOFTWARE', description: 'Cancelled subscription', amount: 3_000, expenseDate: new Date().toISOString() });
    assert.equal((await request(app).patch(`/api/v1/admin/expenses/${approvedExpense}/status`).set(auth).send({ status: 'APPROVED' })).status, 200);
    assert.equal(
      (await request(app).patch(`/api/v1/admin/expenses/${voidedExpense}/status`).set(auth).send({ status: 'VOIDED', reason: 'Never incurred' })).status,
      200
    );
    assert.equal((await Expense.findById(draftExpense).lean()).status, 'DRAFT');

    /* ---------------------------------------------------------------- Authorization */
    const reportPaths = [
      '/reports',
      '/reports/sales',
      '/reports/products',
      '/reports/inventory',
      '/reports/inventory-movements',
      '/reports/customers',
      '/reports/orders',
      '/reports/purchases',
      '/reports/finance',
      '/reports/profit',
      '/reports/tax',
    ];
    for (const path of reportPaths) {
      assert.equal((await request(app).get(`/api/v1/admin${path}`)).status, 401, `${path} must reject anonymous access`);
      assert.equal(
        (await request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${customerToken}`)).status,
        403,
        `${path} must reject a customer`
      );
      assert.equal((await request(app).get(`/api/v1/admin${path}`).set(auth)).status, 200, `${path} must serve a Super Admin`);
    }

    /* ------------------------------------------------------------------ Report index */
    let response = await get('/reports');
    assert.equal(response.body.data.reports.length, 10);
    assert.deepEqual(
      response.body.data.reports.map((row: any) => row.key),
      ['sales', 'products', 'inventory', 'inventory-movements', 'customers', 'orders', 'purchases', 'finance', 'profit', 'tax']
    );
    // Every advertised path must actually be mounted, so the index cannot drift
    // from the router.
    for (const entry of response.body.data.reports) {
      assert.ok(entry.path.startsWith('/api/v1/admin/reports'), `${entry.key} must live under the reports namespace`);
      assert.equal((await request(app).get(entry.path).set(auth)).status, 200, `${entry.path} must resolve`);
    }
    assert.equal(response.body.data.maxRangeDays, 366);
    // §42: export is deliberately absent rather than half-built.
    assert.equal(response.body.data.export.available, false);
    assert.match(response.body.data.export.reason, /deferred/i);
    assert.equal((await get('/reports', { range: '7d' })).status, 400, 'the index takes no parameters');

    /* ------------------------------------------------------------------ Sales report */
    response = await get('/reports/sales');
    const sales = response.body.data;
    assert.deepEqual(sales.totals, {
      orders: 4,
      realizedOrders: 2,
      cancelledOrders: 1,
      // §46: a cancelled order stays in placed-order value and is excluded from
      // realized revenue.
      grossSales: 76_000,
      // §47: the delivered-but-unpaid COD order contributes nothing here.
      realizedRevenue: 51_000,
      refunds: 1_200,
      netSales: 74_800,
      averageOrderValue: 19_000,
      discountsGiven: 0,
      shippingCharged: 300,
      taxCollected: 700,
      unitsSold: 6,
      realizedUnitsSold: 4,
    });
    assert.deepEqual(sales.byOrderStatus, [
      { status: 'CANCELLED', orders: 1, value: 20_000 },
      { status: 'DELIVERED', orders: 3, value: 56_000 },
    ]);
    assert.deepEqual(sales.byPaymentStatus, [
      { status: 'PAID', orders: 2, value: 51_000 },
      { status: 'UNPAID', orders: 2, value: 25_000 },
    ]);
    assert.deepEqual(sales.byDate, [{ date: today, orders: 4, grossSales: 76_000, realizedRevenue: 51_000, costOfGoodsSold: 24_000, grossProfit: 27_000 }]);
    // The per-day series sums back to the headline, so the trend and the total
    // cannot tell different stories.
    assert.equal(
      sales.byDate.reduce((sum: number, row: any) => sum + row.realizedRevenue, 0),
      sales.totals.realizedRevenue
    );
    const topProducts = byKey(sales.topProducts, 'product');
    assert.equal(sales.topProducts.length, 2, 'gamma was never ordered');
    assert.deepEqual(topProducts.get(String(alpha._id)), {
      product: String(alpha._id),
      name: 'Report alpha',
      sku: 'RPT-A',
      unitsSold: 3,
      grossRevenue: 60_000,
      realizedRevenue: 40_000,
    });
    assert.deepEqual(topProducts.get(String(beta._id)), {
      product: String(beta._id),
      name: 'Report beta',
      sku: 'RPT-B',
      unitsSold: 3,
      grossRevenue: 15_000,
      realizedRevenue: 10_000,
    });
    assert.equal(sales.currency, 'PKR');
    assert.equal(response.body.meta.days, 30);
    assert.equal(response.body.meta.maxRangeDays, 366);

    /* ---------------------------------------------------------------- Product report */
    response = await get('/reports/products');
    assert.equal(response.body.meta.total, 2);
    assert.equal(response.body.data.length, 2);
    // Default sort is realized revenue, descending.
    assert.deepEqual(
      response.body.data.map((row: any) => row.name),
      ['Report alpha', 'Report beta']
    );
    assert.deepEqual(response.body.data[0], {
      product: String(alpha._id),
      name: 'Report alpha',
      sku: 'RPT-A',
      orders: 2,
      unitsSold: 3,
      grossRevenue: 60_000,
      realizedUnits: 2,
      realizedRevenue: 40_000,
      costOfGoodsSold: 24_000,
      grossProfit: 16_000,
      grossMargin: 40,
      returnedQuantity: 1,
      // §30: availability is aggregated across both stock locations from the
      // InventoryBalance ledger. `Product.stock` is a mirror and is not read.
      onHand: 10,
      reserved: 2,
      available: 8,
      lowStockThreshold: 3,
      stockStatus: 'IN_STOCK',
      rating: 0,
      reviews: 0,
    });
    assert.deepEqual(response.body.data[1], {
      product: String(beta._id),
      name: 'Report beta',
      sku: 'RPT-B',
      orders: 2,
      unitsSold: 3,
      grossRevenue: 15_000,
      realizedUnits: 2,
      realizedRevenue: 10_000,
      // The order line carried no cost snapshot, so this product reports no cost
      // rather than a guessed one.
      costOfGoodsSold: 0,
      grossProfit: 10_000,
      grossMargin: 100,
      returnedQuantity: 0,
      onHand: 3,
      reserved: 3,
      available: 0,
      lowStockThreshold: 5,
      stockStatus: 'OUT_OF_STOCK',
      rating: 0,
      reviews: 0,
    });
    // §43: per-product cost sums back to the single finance COGS figure.
    assert.equal(
      response.body.data.reduce((sum: number, row: any) => sum + row.costOfGoodsSold, 0),
      sales.byDate[0].costOfGoodsSold
    );

    /* ------------------------------------- Product report sorting, paging, searching */
    for (const [direction, expected] of [
      ['desc', ['Report alpha', 'Report beta']],
      ['asc', ['Report beta', 'Report alpha']],
    ] as const) {
      response = await get('/reports/products', { sort: 'grossRevenue', direction });
      assert.deepEqual(
        response.body.data.map((row: any) => row.name),
        expected,
        `grossRevenue ${direction} must order the rows`
      );
    }
    response = await get('/reports/products', { limit: 1, page: 1, sort: 'grossRevenue' });
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].name, 'Report alpha');
    assert.deepEqual(response.body.meta.page, 1);
    assert.equal(response.body.meta.limit, 1);
    assert.equal(response.body.meta.total, 2);
    assert.equal(response.body.meta.totalPages, 2);
    assert.equal(response.body.meta.hasNextPage, true);
    assert.equal(response.body.meta.hasPreviousPage, false);
    response = await get('/reports/products', { limit: 1, page: 2, sort: 'grossRevenue' });
    assert.equal(response.body.data[0].name, 'Report beta');
    assert.equal(response.body.meta.hasNextPage, false);
    assert.equal(response.body.meta.hasPreviousPage, true);
    // A page past the end is an empty page, not an error and not a wrapped result.
    response = await get('/reports/products', { limit: 1, page: 9 });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.meta.total, 2);

    response = await get('/reports/products', { search: 'RPT-A' });
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].sku, 'RPT-A');
    // §41: search is escaped before it reaches Mongo, so regex metacharacters can
    // only ever match literally instead of selecting every row.
    for (const probe of ['.*', '^Report', 'Report.*alpha', '.+', 'RPT-[AB]', '(alpha|beta)', '\\w+']) {
      response = await get('/reports/products', { search: probe });
      assert.equal(response.status, 200, `search ${probe} must be handled`);
      assert.deepEqual(response.body.data, [], `search ${probe} must be treated as a literal`);
    }

    /* -------------------------------------------------------------- Inventory report */
    response = await get('/reports/inventory');
    const inventory = response.body.data;
    assert.deepEqual(inventory.totals, { products: 3, units: 12, stockValue: 100_000, retailValue: 168_000 });
    assert.equal(inventory.valuationBasis, 'LATEST_PURCHASE_COST');
    // §30 stated in the payload itself, not just in the docs.
    assert.equal(inventory.stockAuthority, 'INVENTORY_BALANCE');
    assert.equal(inventory.currency, 'PKR');
    assert.ok(Date.parse(inventory.asOf) > 0, 'a point-in-time report must say when it was taken');
    // Default sort is stock value, descending.
    assert.deepEqual(
      inventory.rows.map((row: any) => row.name),
      ['Report alpha', 'Report gamma', 'Report beta']
    );
    const stockRows = byKey(inventory.rows, 'name');
    assert.deepEqual(stockRows.get('Report alpha'), {
      product: String(alpha._id),
      name: 'Report alpha',
      sku: 'RPT-A',
      category: 'Audio',
      brand: null,
      status: 'ACTIVE',
      // Both bays are folded into one product row.
      locations: 2,
      onHand: 10,
      reserved: 2,
      available: 8,
      lowStockThreshold: 3,
      costPrice: 12_000,
      stockValue: 96_000,
      retailValue: 160_000,
    });
    // Fully reserved stock is not available stock, so it values at nothing.
    assert.equal(stockRows.get('Report beta').available, 0);
    assert.equal(stockRows.get('Report beta').stockValue, 0);
    assert.equal(stockRows.get('Report beta').retailValue, 0);
    assert.equal(stockRows.get('Report gamma').available, 4);
    assert.equal(stockRows.get('Report gamma').stockValue, 4_000);
    // The ledger totals must equal the sum of the rows on a single page.
    assert.equal(
      inventory.rows.reduce((sum: number, row: any) => sum + row.stockValue, 0),
      inventory.totals.stockValue
    );
    assert.equal(
      inventory.rows.reduce((sum: number, row: any) => sum + row.available, 0),
      inventory.totals.units
    );

    /* --------------------------------------------- Inventory filters, sorting, search */
    response = await get('/reports/inventory', { filter: 'out-of-stock' });
    assert.deepEqual(
      response.body.data.rows.map((row: any) => row.name),
      ['Report beta']
    );
    assert.equal(response.body.meta.total, 1);
    // The totals block follows the filter, so a filtered view never reports the
    // unfiltered valuation.
    assert.equal(response.body.data.totals.products, 1);
    assert.equal(response.body.data.totals.stockValue, 0);
    response = await get('/reports/inventory', { filter: 'low-stock' });
    assert.deepEqual(
      response.body.data.rows.map((row: any) => row.name),
      ['Report gamma'],
      'low stock is above zero and at or below the threshold'
    );
    response = await get('/reports/inventory', { sort: 'name', direction: 'asc' });
    assert.deepEqual(
      response.body.data.rows.map((row: any) => row.name),
      ['Report alpha', 'Report beta', 'Report gamma']
    );
    response = await get('/reports/inventory', { sort: 'available', direction: 'asc' });
    assert.deepEqual(
      response.body.data.rows.map((row: any) => row.available),
      [0, 4, 8]
    );
    response = await get('/reports/inventory', { search: 'gamma' });
    assert.equal(response.body.data.rows.length, 1);
    assert.equal(response.body.data.rows[0].sku, 'RPT-G');
    for (const probe of ['.*', 'Report.+', '[a-z]+']) {
      response = await get('/reports/inventory', { search: probe });
      assert.deepEqual(response.body.data.rows, [], `inventory search ${probe} must be literal`);
      assert.equal(response.body.data.totals.products, 0);
    }
    // Stock on hand is a point-in-time fact, so this report deliberately takes no
    // window: a range parameter is a client error, not a silently ignored key.
    for (const query of [{ range: '7d' }, { from: '2026-01-01', to: '2026-02-01' }, { groupBy: 'type' }]) {
      response = await get('/reports/inventory', query);
      assert.equal(response.status, 400, `inventory must reject ${JSON.stringify(query)}`);
      assertSafeError(response, 'inventory range rejection');
    }

    /* ----------------------------------------------------- Inventory movement report */
    response = await get('/reports/inventory-movements');
    assert.equal(response.body.data.groupBy, 'type');
    assert.equal(response.body.meta.total, 4);
    assert.deepEqual(response.body.data.rows, [
      { key: 'INITIAL', movements: 3, unitsIn: 18, unitsOut: 0, netChange: 18 },
      { key: 'ADJUSTMENT', movements: 1, unitsIn: 0, unitsOut: 1, netChange: -1 },
      { key: 'ORDER', movements: 1, unitsIn: 0, unitsOut: 2, netChange: -2 },
      { key: 'RETURN', movements: 1, unitsIn: 1, unitsOut: 0, netChange: 1 },
    ]);
    response = await get('/reports/inventory-movements', { groupBy: 'date' });
    assert.deepEqual(response.body.data.rows, [{ key: today, movements: 6, unitsIn: 19, unitsOut: 3, netChange: 16 }]);
    response = await get('/reports/inventory-movements', { groupBy: 'product' });
    assert.equal(response.body.data.groupBy, 'product');
    assert.equal(response.body.meta.total, 3);
    const movementRows = byKey(response.body.data.rows, 'key');
    assert.deepEqual(movementRows.get(String(alpha._id)), { key: String(alpha._id), movements: 3, unitsIn: 11, unitsOut: 2, netChange: 9 });
    assert.deepEqual(movementRows.get(String(gamma._id)), { key: String(gamma._id), movements: 2, unitsIn: 5, unitsOut: 1, netChange: 4 });
    assert.deepEqual(movementRows.get(String(beta._id)), { key: String(beta._id), movements: 1, unitsIn: 3, unitsOut: 0, netChange: 3 });
    // Every grouping must describe the same ledger.
    for (const groupBy of ['type', 'date', 'product']) {
      const rows = (await get('/reports/inventory-movements', { groupBy, limit: 100 })).body.data.rows;
      assert.equal(
        rows.reduce((sum: number, row: any) => sum + row.movements, 0),
        6,
        `groupBy=${groupBy} must account for every movement`
      );
      assert.equal(
        rows.reduce((sum: number, row: any) => sum + row.netChange, 0),
        16,
        `groupBy=${groupBy} must preserve the net change`
      );
    }
    assert.equal((await get('/reports/inventory-movements', { groupBy: 'warehouse' })).status, 400, 'groupBy is a whitelist');

    /* --------------------------------------------------------------- Customer report */
    response = await get('/reports/customers');
    const customers = response.body.data;
    assert.deepEqual(customers.totals, {
      customers: 2,
      newCustomers: 2,
      purchasingCustomers: 2,
      repeatCustomers: 2,
      repeatRate: 100,
      orders: 4,
      grossSpend: 76_000,
      realizedSpend: 51_000,
      averageRealizedSpend: 25_500,
      averageOrderValue: 19_000,
    });
    // The Super Admin is a SUPER_ADMIN, so the customer count must not include them.
    assert.equal(await User.countDocuments({}), 3);
    // Default sort is realized spend, descending.
    assert.deepEqual(
      customers.rows.map((row: any) => row.email),
      ['rep-a@test.local', 'rep-b@test.local']
    );
    const buyers = byKey(customers.rows, 'email');
    const rowA = buyers.get('rep-a@test.local');
    assert.equal(rowA.customer, String(buyerA._id));
    assert.equal(rowA.name, 'Buyer A');
    assert.equal(rowA.status, 'ACTIVE');
    assert.equal(rowA.orders, 2);
    assert.equal(rowA.realizedOrders, 1);
    assert.equal(rowA.grossSpend, 46_000);
    assert.equal(rowA.realizedSpend, 41_000);
    assert.equal(rowA.acquiredInPeriod, true);
    assert.ok(Date.parse(rowA.firstOrderAt) <= Date.parse(rowA.lastOrderAt));
    const rowB = buyers.get('rep-b@test.local');
    // Two orders placed, one realized: the cancelled order is spend that never became revenue.
    assert.equal(rowB.orders, 2);
    assert.equal(rowB.realizedOrders, 1);
    assert.equal(rowB.grossSpend, 30_000);
    assert.equal(rowB.realizedSpend, 10_000);
    // §32: an inclusive projection means no credential material can appear at all.
    const customerBody = JSON.stringify(customers);
    for (const secret of ['password', '$2a$', '$2b$', 'passwordResetTokenHash', 'passwordResetExpiresAt', 'passwordChangedAt']) {
      assert.ok(!customerBody.includes(secret), `the customer report must not expose ${secret}`);
    }
    assert.deepEqual(Object.keys(rowA).sort(), [
      'acquiredInPeriod',
      'customer',
      'email',
      'firstOrderAt',
      'grossSpend',
      'lastOrderAt',
      'name',
      'orders',
      'realizedOrders',
      'realizedSpend',
      'status',
    ]);
    response = await get('/reports/customers', { sort: 'orders', direction: 'asc', limit: 1 });
    assert.equal(response.body.data.rows.length, 1);
    assert.equal(response.body.meta.total, 2);
    assert.equal(response.body.meta.totalPages, 2);

    /* ------------------------------------------------------------------ Order report */
    response = await get('/reports/orders');
    const orders = response.body.data;
    assert.deepEqual(orders.totals, {
      orders: 4,
      units: 6,
      shipped: 3,
      delivered: 3,
      cancelled: 1,
      realizedOrders: 2,
      // §47: delivered COD cash that was never collected is a collection risk, not revenue.
      deliveredAwaitingPayment: 1,
      grossSales: 76_000,
      realizedRevenue: 51_000,
      refunds: 1_200,
      netSales: 74_800,
    });
    assert.deepEqual(orders.byOrderStatus, [
      { status: 'CANCELLED', orders: 1 },
      { status: 'DELIVERED', orders: 3 },
    ]);
    assert.deepEqual(orders.returnsByStatus, [{ status: 'APPROVED', count: 1 }]);
    assert.deepEqual(orders.refundsByStatus, [{ status: 'COMPLETED', count: 1, value: 1_200 }]);
    assert.equal(orders.fulfilmentRate, 75);
    assert.equal(orders.cancellationRate, 25);
    // §33: timing comes from the status history that exists, and the sample size is
    // reported rather than presented as a confident average over all four orders.
    assert.deepEqual(orders.timing, {
      averageHoursToShip: 2,
      averageHoursToDeliver: 5,
      sampled: { shipments: 1, deliveries: 1 },
      basis: 'ORDER_STATUS_HISTORY_TIMESTAMPS',
    });
    assert.equal(orders.currency, 'PKR');
    // The status breakdown must account for every order in the window.
    assert.equal(
      orders.byOrderStatus.reduce((sum: number, row: any) => sum + row.orders, 0),
      orders.totals.orders
    );

    /* --------------------------------------------------------------- Purchase report */
    response = await get('/reports/purchases');
    const purchases = response.body.data;
    // §34: the draft is counted as a document but contributes no commitment value.
    assert.equal(purchases.purchaseOrders.total, 2);
    assert.equal(purchases.purchaseOrders.committedValue, 100_000);
    assert.deepEqual(purchases.purchaseOrders.byStatus, [
      { status: 'APPROVED', count: 1, value: 100_000 },
      { status: 'DRAFT', count: 1, value: 40_000 },
    ]);
    assert.deepEqual(purchases.receiving, { receipts: 1, unitsAccepted: 3, unitsRejected: 1, receivedValue: 30_000, acceptanceRate: 75 });
    assert.deepEqual(purchases.outstanding, { quantity: 7, value: 70_000 });
    assert.deepEqual(purchases.supplierReturns, { count: 1, units: 1, value: 10_000 });
    assert.equal(purchases.topSuppliers.length, 1);
    assert.deepEqual(purchases.topSuppliers[0], {
      supplier: { id: String(supplier._id), name: 'Report Supplier', code: 'RSUP-1' },
      orders: 2,
      committedValue: 140_000,
    });
    assert.equal(purchases.basis, 'PROCUREMENT_COMMITMENT_AND_GOODS_IN');
    assert.match(purchases.note, /neither is an operating expense/i);

    /* ------------------------------------------- §34 / §48 purchase is not an expense */
    // Procurement money is large and entirely absent from the operating figures:
    // 100,000 committed and 30,000 received against 2,200 of approved expenses.
    const financeReport = (await get('/reports/finance')).body.data;
    assert.equal(financeReport.totals.operatingExpenses, 2_200);
    assert.notEqual(financeReport.totals.operatingExpenses, purchases.purchaseOrders.committedValue);
    assert.notEqual(financeReport.totals.operatingExpenses, purchases.receiving.receivedValue);
    const financeBody = JSON.stringify(financeReport);
    for (const procurement of [100_000, 140_000, 70_000, 40_000]) {
      assert.ok(!financeBody.includes(String(procurement)), `procurement value ${procurement} must not appear in the finance report`);
    }
    // Approving a purchase order created no stock movement and no expense record.
    assert.equal(await Expense.countDocuments({ purchaseOrder: livePo._id }), 0);
    assert.equal(await InventoryMovement.countDocuments({ referenceType: 'PurchaseOrder' }), 0);

    /* ---------------------------------------------------------------- Finance report */
    assert.deepEqual(financeReport.totals, {
      grossSales: 76_000,
      realizedRevenue: 51_000,
      refunds: 1_200,
      netSales: 74_800,
      netRealizedRevenue: 49_800,
      costOfGoodsSold: 24_000,
      grossProfit: 25_800,
      grossMargin: 51.81,
      operatingExpenses: 2_200,
      operatingProfit: 23_600,
      operatingMargin: 47.39,
      taxCollected: 700,
    });
    // §17: only the approved expense is realized. The draft and the void are not.
    assert.deepEqual(financeReport.expensesByCategory, [{ category: 'SHIPPING', count: 1, amount: 2_000, taxAmount: 200, totalAmount: 2_200 }]);
    assert.deepEqual(financeReport.refundsByDate, [{ date: today, refunds: 1, value: 1_200 }]);
    assert.equal(financeReport.costBasis, 'LATEST_PURCHASE_COST');
    // §14: the cost basis is stated and the unimplemented methods are never claimed.
    for (const method of ['FIFO', 'LIFO', 'WEIGHTED_AVERAGE', 'STANDARD_COST', 'GAAP', 'IFRS', 'netIncome']) {
      assert.ok(!financeBody.includes(method), `the finance report must not claim ${method}`);
    }
    // Cost coverage is reported rather than hidden: one of the two realized lines
    // carries a snapshot.
    assert.deepEqual(financeReport.cogsCoverage, { linesTotal: 2, linesWithCostSnapshot: 1, coverage: 50, complete: false });
    assert.equal(financeReport.basis, 'MANAGEMENT_REPORTING_NOT_STATUTORY_ACCOUNTING');
    // §35: the report and the dashboard read the same service, so the overlapping
    // figures are identical rather than merely close.
    const dashboard = (await get('/finance/dashboard')).body.data;
    assert.equal(dashboard.revenue.realizedRevenue, financeReport.totals.realizedRevenue);
    assert.equal(dashboard.revenue.refunds, financeReport.totals.refunds);
    assert.equal(dashboard.revenue.netSales, financeReport.totals.netSales);
    assert.equal(dashboard.cost.costOfGoodsSold, financeReport.totals.costOfGoodsSold);
    assert.equal(dashboard.profit.grossProfit, financeReport.totals.grossProfit);
    assert.equal(dashboard.profit.operatingExpenses, financeReport.totals.operatingExpenses);
    assert.equal(dashboard.profit.operatingProfit, financeReport.totals.operatingProfit);
    assert.equal(dashboard.tax.collectedOnSales, financeReport.totals.taxCollected);
    assert.equal(dashboard.orders.unpaidCodOrders, 1);
    assert.equal(dashboard.orders.unpaidCodValue, 5_000);
    assert.equal(dashboard.purchasing.orderedValue, purchases.purchaseOrders.committedValue);
    assert.equal(dashboard.purchasing.receivedValue, purchases.receiving.receivedValue);

    /* ----------------------------------------------------------------- Profit report */
    response = await get('/reports/profit');
    const profitSummary = response.body.data;
    assert.equal(profitSummary.groupBy, 'summary');
    assert.equal(profitSummary.realizedRevenue, 51_000);
    assert.equal(profitSummary.refunds, 1_200);
    assert.equal(profitSummary.netRealizedRevenue, 49_800);
    assert.equal(profitSummary.costOfGoodsSold, 24_000);
    assert.equal(profitSummary.grossProfit, 25_800);
    assert.equal(profitSummary.grossMargin, 51.81);
    assert.equal(profitSummary.operatingExpenses, 2_200);
    assert.equal(profitSummary.operatingProfit, 23_600);
    assert.equal(profitSummary.operatingMargin, 47.39);
    assert.equal(profitSummary.costBasis, 'LATEST_PURCHASE_COST');

    response = await get('/reports/profit', { groupBy: 'date' });
    // The per-day series carries realized revenue less cost. Refunds and operating
    // expenses are period facts and are subtracted once at the summary level, which
    // is why the daily figure is the higher one.
    assert.deepEqual(response.body.data.rows, [
      { date: today, orders: 4, grossSales: 76_000, realizedRevenue: 51_000, costOfGoodsSold: 24_000, grossProfit: 27_000 },
    ]);
    assert.deepEqual(response.body.data.rows, sales.byDate, 'the profit and sales series must be the same series');

    response = await get('/reports/profit', { groupBy: 'product' });
    assert.equal(response.body.meta.total, 2);
    assert.deepEqual(response.body.data.rows, [
      {
        key: String(alpha._id),
        name: 'Report alpha',
        sku: 'RPT-A',
        units: 2,
        realizedRevenue: 40_000,
        costOfGoodsSold: 24_000,
        grossProfit: 16_000,
        grossMargin: 40,
      },
      {
        key: String(beta._id),
        name: 'Report beta',
        sku: 'RPT-B',
        units: 2,
        realizedRevenue: 10_000,
        costOfGoodsSold: 0,
        grossProfit: 10_000,
        grossMargin: 100,
      },
    ]);
    const productProfit = response.body.data.rows;

    response = await get('/reports/profit', { groupBy: 'category' });
    assert.equal(response.body.meta.total, 1, 'both sold products share a category');
    assert.deepEqual(response.body.data.rows, [
      { key: 'Audio', name: 'Audio', units: 4, realizedRevenue: 50_000, costOfGoodsSold: 24_000, grossProfit: 26_000, grossMargin: 52 },
    ]);
    // §37: the groupings are rollups of one calculation, so they reconcile exactly.
    for (const field of ['units', 'realizedRevenue', 'costOfGoodsSold', 'grossProfit'] as const) {
      assert.equal(
        productProfit.reduce((sum: number, row: any) => sum + row[field], 0),
        response.body.data.rows[0][field],
        `${field} must reconcile between the product and category groupings`
      );
    }
    // Line-level revenue excludes shipping and tax, so it is deliberately lower than
    // order-level realized revenue; the cost figure is the one that must agree.
    assert.equal(response.body.data.rows[0].costOfGoodsSold, profitSummary.costOfGoodsSold);
    assert.ok(response.body.data.rows[0].realizedRevenue < profitSummary.realizedRevenue);
    assert.equal((await get('/reports/profit', { groupBy: 'supplier' })).status, 400, 'groupBy is a whitelist');

    /* -------------------------------------------------------------------- Tax report */
    response = await get('/reports/tax');
    const tax = response.body.data;
    assert.deepEqual(tax.salesTax, {
      // §19: only what checkout actually recorded. The unpaid COD order's tax is not
      // collected tax, so it is absent.
      collectedOnSales: 700,
      realizedOrders: 2,
      realizedRevenue: 51_000,
      byDate: [{ date: today, orders: 2, taxableBase: 50_000, tax: 700 }],
    });
    assert.deepEqual(tax.expenseTax, { total: 200, byCategory: [{ category: 'SHIPPING', tax: 200 }] });
    assert.equal(tax.netTaxPosition, 500);
    assert.equal(tax.basis, 'RECORDED_TAX_AMOUNTS_ONLY');
    // §19/§36: no jurisdictions are invented and no compliance is claimed.
    assert.match(tax.disclaimer, /not tax advice or a tax return/i);
    // The only dimensions present are date and expense category — there is no rate,
    // jurisdiction or filing dimension anywhere in the payload.
    assert.deepEqual(Object.keys(tax).sort(), ['basis', 'currency', 'disclaimer', 'expenseTax', 'netTaxPosition', 'salesTax']);
    assert.deepEqual(Object.keys(tax.salesTax.byDate[0]).sort(), ['date', 'orders', 'tax', 'taxableBase']);
    assert.deepEqual(Object.keys(tax.expenseTax.byCategory[0]).sort(), ['category', 'tax']);
    for (const fabricated of ['jurisdiction', 'taxRate', 'ratePercent', 'exemption', 'filingPeriod', 'compliant', 'GST', 'VAT']) {
      assert.ok(!Object.keys(tax).includes(fabricated), `the tax report must not carry a ${fabricated} dimension`);
    }
    assert.equal(
      tax.salesTax.byDate.reduce((sum: number, row: any) => sum + row.tax, 0),
      tax.salesTax.collectedOnSales
    );
    assert.equal(tax.salesTax.collectedOnSales - tax.expenseTax.total, tax.netTaxPosition);

    /* ---------------------------------------------------------------- Date filtering */
    const now = Date.now();
    const explicit = { from: new Date(now - 2 * DAY).toISOString(), to: new Date(now + DAY).toISOString() };
    // An explicit window that still contains everything must reproduce the named-range
    // figures exactly.
    response = await get('/reports/sales', explicit);
    assert.deepEqual(response.body.data.totals, sales.totals);
    assert.equal(response.body.meta.days, 3);
    assert.equal(response.body.meta.from, new Date(explicit.from).toISOString());

    // A window that predates every record must report real zeroes, not a fallback to
    // the default range.
    const past = { from: new Date(now - 200 * DAY).toISOString(), to: new Date(now - 100 * DAY).toISOString() };
    response = await get('/reports/sales', past);
    assert.deepEqual(response.body.data.totals, {
      orders: 0,
      realizedOrders: 0,
      cancelledOrders: 0,
      grossSales: 0,
      realizedRevenue: 0,
      refunds: 0,
      netSales: 0,
      averageOrderValue: 0,
      discountsGiven: 0,
      shippingCharged: 0,
      taxCollected: 0,
      unitsSold: 0,
      realizedUnitsSold: 0,
    });
    assert.deepEqual(response.body.data.byDate, []);
    assert.deepEqual(response.body.data.topProducts, []);
    const emptyFinance = (await get('/reports/finance', past)).body.data;
    assert.equal(emptyFinance.totals.operatingExpenses, 0);
    // A margin on nothing is not zero percent — it is undefined, and it is reported as such.
    assert.equal(emptyFinance.totals.grossMargin, null);
    assert.equal(emptyFinance.totals.operatingMargin, null);
    assert.equal((await get('/reports/profit', past)).body.data.grossMargin, null);
    assert.deepEqual((await get('/reports/customers', past)).body.data.totals.purchasingCustomers, 0);
    assert.equal((await get('/reports/customers', past)).body.data.totals.repeatRate, null);
    assert.equal((await get('/reports/orders', past)).body.data.fulfilmentRate, null);
    assert.equal((await get('/reports/purchases', past)).body.data.receiving.acceptanceRate, null);
    assert.equal((await get('/reports/inventory-movements', past)).body.meta.total, 0);
    assert.equal((await get('/reports/products', past)).body.meta.total, 0);

    /* -------------------------------------------------------- §40 date range security */
    // Every windowed report shares one resolver, so each of these violations must
    // produce the same code on every path rather than a per-endpoint variation.
    const windowed = reportPaths.filter(path => path !== '/reports' && path !== '/reports/inventory');
    const rangeViolations: [Record<string, string>, string][] = [
      [{ range: '30d', from: explicit.from, to: explicit.to }, 'RANGE_INVALID'],
      [{ from: explicit.from }, 'RANGE_INVALID'],
      [{ to: explicit.to }, 'RANGE_INVALID'],
      [{ from: explicit.to, to: explicit.from }, 'RANGE_INVALID'],
      [{ from: new Date(now - 400 * DAY).toISOString(), to: new Date(now).toISOString() }, 'RANGE_TOO_LARGE'],
    ];
    for (const path of windowed) {
      for (const [query, code] of rangeViolations) {
        response = await get(path, query);
        assert.equal(response.status, 400, `${path} must reject ${JSON.stringify(query)}`);
        assert.equal(response.body.error.code, code, `${path} must answer ${code} for ${JSON.stringify(query)}`);
        assertSafeError(response, `${path} ${code}`);
      }
      // A window exactly on the limit is allowed, so the boundary is inclusive rather
      // than off by a day.
      const boundary = await get(path, { from: new Date(now - 366 * DAY).toISOString(), to: new Date(now).toISOString() });
      assert.equal(boundary.status, 200, `${path} must accept a ${366}-day window`);
      assert.equal((await get(path, { range: '365d' })).status, 200, `${path} must accept every named range`);
      // Unparseable bounds are stopped at the schema boundary, before any query runs.
      for (const bad of [{ from: 'nonsense', to: 'nonsense' }, { from: '2026-13-45', to: '2026-01-01' }, { range: '48h' }, { range: '1y' }]) {
        response = await get(path, bad);
        assert.equal(response.status, 400, `${path} must reject ${JSON.stringify(bad)}`);
        assertSafeError(response, `${path} malformed range`);
      }
    }

    /* --------------------------------------------------------- §39 sort key whitelist */
    // Sortable reports accept a fixed vocabulary. A real Mongo field name that is not
    // on the list is rejected exactly like nonsense, so the sort key can never become
    // an arbitrary database path.
    const sortable = ['/reports/products', '/reports/inventory', '/reports/customers'];
    for (const path of sortable) {
      for (const sort of ['_id', 'createdAt', 'price', 'costPrice', 'name.first', '$natural', 'password', '__proto__', 'nonsense']) {
        response = await get(path, { sort });
        assert.equal(response.status, 400, `${path} must reject sort=${sort}`);
        assertSafeError(response, `${path} sort=${sort}`);
      }
      for (const direction of ['ascending', 'DESC', '1', '-1', '']) {
        response = await get(path, { direction });
        assert.equal(response.status, 400, `${path} must reject direction=${direction}`);
        assertSafeError(response, `${path} direction=${direction}`);
      }
    }
    // Grouped reports whitelist their grouping dimension the same way.
    for (const [path, bad] of [
      ['/reports/inventory-movements', ['warehouse', 'location', 'reason', 'actor', '_id']],
      ['/reports/profit', ['supplier', 'customer', 'brand', 'month', '_id']],
    ] as const) {
      for (const groupBy of bad) {
        response = await get(path, { groupBy });
        assert.equal(response.status, 400, `${path} must reject groupBy=${groupBy}`);
        assertSafeError(response, `${path} groupBy=${groupBy}`);
      }
    }

    /* ------------------------------------------------- §38 pagination bounds and shape */
    // Every row-style report is bounded by the same envelope, so a client never has to
    // guess whether a report can return an unbounded result set. `profit` is only
    // row-style once it is grouped; its summary and date views are single documents.
    const paginated: [string, Record<string, unknown>][] = [
      ['/reports/products', {}],
      ['/reports/inventory', {}],
      ['/reports/customers', {}],
      ['/reports/inventory-movements', {}],
      ['/reports/profit', { groupBy: 'product' }],
    ];
    for (const [path, base] of paginated) {
      response = await get(path, base);
      const rows = Array.isArray(response.body.data) ? response.body.data : response.body.data.rows;
      assert.ok(Array.isArray(rows), `${path} must return a bounded row array`);
      assert.deepEqual(
        ['hasNextPage', 'hasPreviousPage', 'limit', 'page', 'total', 'totalPages'].filter(key => !(key in response.body.meta)),
        [],
        `${path} must expose the shared pagination envelope`
      );
      assert.equal(response.body.meta.limit, 20, `${path} must default to a bounded page size`);
      assert.ok(rows.length <= 20, `${path} must never exceed its page size`);
      assert.equal((await get(path, { ...base, limit: 100 })).body.meta.limit, 100, `${path} must allow the maximum page size`);
      for (const query of [
        { limit: 0 },
        { limit: 101 },
        { limit: 5000 },
        { limit: -1 },
        { limit: 'all' },
        { limit: 1.5 },
        { page: 0 },
        { page: -3 },
        { page: 'first' },
        { page: 2.5 },
      ]) {
        response = await get(path, { ...base, ...query });
        assert.equal(response.status, 400, `${path} must reject ${JSON.stringify(query)}`);
        assertSafeError(response, `${path} ${JSON.stringify(query)}`);
      }
    }
    // The ungrouped profit views are single documents, so they carry the range meta
    // instead of a page meta rather than pretending to be paginated.
    for (const groupBy of ['summary', 'date']) {
      const meta = (await get('/reports/profit', { groupBy })).body.meta;
      assert.equal(meta.maxRangeDays, 366);
      assert.ok(!('page' in meta), `profit groupBy=${groupBy} must not advertise pagination`);
    }

    /* ------------------------------------------ §41 §50 operator and unknown-key safety */
    // Nested query syntax reaches Express as a real object. Every report must refuse it
    // at the boundary so it can never arrive inside a `$match` as an operator.
    const operatorProbes: Record<string, unknown>[] = [
      { from: { $gt: '2020-01-01' } },
      { to: { $ne: null } },
      { range: { $ne: '30d' } },
      { page: { $gt: 0 } },
      { limit: { $gt: 1 } },
      { sort: { $ne: 'name' } },
      { direction: { $in: ['asc'] } },
      { search: { $ne: '' } },
      { groupBy: { $ne: 'type' } },
      { filter: { $ne: 'all' } },
    ];
    for (const path of reportPaths) {
      for (const probe of operatorProbes) {
        response = await get(path, probe);
        assert.equal(response.status, 400, `${path} must reject the operator object ${JSON.stringify(probe)}`);
        assertSafeError(response, `${path} ${JSON.stringify(probe)}`);
      }
      // Unknown keys are rejected rather than ignored, so a typo can never silently
      // widen a report.
      for (const unknown of [
        { status: 'PAID' },
        { customer: String(buyerA._id) },
        { warehouse: String(warehouse._id) },
        { fields: 'password' },
        { select: 'password' },
        { sortBy: 'total' },
        { order: 'asc' },
        { skip: 5 },
        { perPage: 10 },
      ]) {
        response = await get(path, unknown);
        assert.equal(response.status, 400, `${path} must reject the unknown key ${JSON.stringify(unknown)}`);
        assertSafeError(response, `${path} ${JSON.stringify(unknown)}`);
      }
    }

    /* ---------------------------------------- §15 §44 historical immutability of money */
    // Snapshot every money-bearing report, then move the current catalogue and
    // supplier records underneath them.
    const before: Record<string, unknown> = {
      sales: (await get('/reports/sales')).body.data,
      products: (await get('/reports/products', { sort: 'grossRevenue' })).body.data,
      orders: (await get('/reports/orders')).body.data,
      customers: (await get('/reports/customers')).body.data,
      finance: (await get('/reports/finance')).body.data,
      tax: (await get('/reports/tax')).body.data,
      'profit:summary': (await get('/reports/profit')).body.data,
      'profit:date': (await get('/reports/profit', { groupBy: 'date' })).body.data,
      'profit:product': (await get('/reports/profit', { groupBy: 'product' })).body.data,
      'profit:category': (await get('/reports/profit', { groupBy: 'category' })).body.data,
    };
    const purchasesBefore = (await get('/reports/purchases')).body.data;
    const inventoryBefore = (await get('/reports/inventory')).body.data;

    await Product.updateOne({ _id: alpha._id }, { $set: { name: 'Renamed alpha', sku: 'RPT-A-V2', price: 99_999, costPrice: 77_777 } });
    await Supplier.updateOne({ _id: supplier._id }, { $set: { name: 'Renamed Supplier', code: 'RSUP-9', paymentTerms: 'NET_60', leadTimeDays: 45 } });

    const paths: Record<string, [string, Record<string, unknown>]> = {
      sales: ['/reports/sales', {}],
      products: ['/reports/products', { sort: 'grossRevenue' }],
      orders: ['/reports/orders', {}],
      customers: ['/reports/customers', {}],
      finance: ['/reports/finance', {}],
      tax: ['/reports/tax', {}],
      'profit:summary': ['/reports/profit', {}],
      'profit:date': ['/reports/profit', { groupBy: 'date' }],
      'profit:product': ['/reports/profit', { groupBy: 'product' }],
      'profit:category': ['/reports/profit', { groupBy: 'category' }],
    };
    for (const [label, [path, query]] of Object.entries(paths)) {
      const after = (await get(path, query)).body.data;
      assert.deepEqual(after, before[label], `${label} must be byte-identical after the catalogue changed`);
    }

    // The stored snapshots themselves are untouched, which is why the reports above
    // could not move: the reports read history, not the current catalogue.
    const historicOrder = await Order.findOne({ orderNumber: 'MK-R-1' }).lean();
    assert.equal(historicOrder!.items[0].name, 'Report alpha');
    assert.equal(historicOrder!.items[0].sku, 'RPT-A');
    assert.equal(historicOrder!.items[0].unitPrice, 20_000);
    assert.equal(historicOrder!.items[0].unitCost, 12_000);
    assert.equal(historicOrder!.items[0].lineCost, 24_000);
    assert.equal(historicOrder!.items[0].lineSubtotal, 40_000);
    assert.equal(historicOrder!.total, 41_000);
    const historicPo = await PurchaseOrder.findOne({ poNumber: 'PO-R-1' }).lean();
    assert.equal(historicPo!.items[0].unitCost, 10_000);
    assert.equal(historicPo!.total, 100_000);
    const historicReceipt = await GoodsReceipt.findOne({ receiptNumber: 'GRN-R-1' }).lean();
    assert.equal(historicReceipt!.items[0].unitCost, 10_000);
    assert.equal(historicReceipt!.acceptedValue, 30_000);

    // Procurement money is a stored commitment, so it does not move either — but the
    // supplier label is a current-attribute view and legitimately follows the rename.
    const purchasesAfter = (await get('/reports/purchases')).body.data;
    assert.equal(purchasesAfter.purchaseOrders.committedValue, purchasesBefore.purchaseOrders.committedValue);
    assert.equal(purchasesAfter.receiving.receivedValue, purchasesBefore.receiving.receivedValue);
    assert.equal(purchasesAfter.outstanding.value, purchasesBefore.outstanding.value);
    assert.equal(purchasesAfter.supplierReturns.value, purchasesBefore.supplierReturns.value);
    assert.equal(purchasesAfter.topSuppliers[0].committedValue, purchasesBefore.topSuppliers[0].committedValue);
    assert.equal(purchasesBefore.topSuppliers[0].supplier.name, 'Report Supplier');
    assert.equal(purchasesAfter.topSuppliers[0].supplier.name, 'Renamed Supplier');
    assert.equal(purchasesAfter.topSuppliers[0].supplier.code, 'RSUP-9');

    // Stock valuation is deliberately the opposite: it is a current replacement-cost
    // view of goods still on hand, so a new purchase cost must move it.
    const inventoryAfter = (await get('/reports/inventory')).body.data;
    assert.equal(inventoryBefore.totals.stockValue, 100_000);
    assert.equal(inventoryBefore.totals.retailValue, 168_000);
    assert.equal(inventoryAfter.totals.units, inventoryBefore.totals.units, 'revaluation must not invent or destroy units');
    assert.equal(inventoryAfter.totals.stockValue, 626_216);
    assert.equal(inventoryAfter.totals.retailValue, 807_992);
    const alphaStock = byKey(inventoryAfter.rows, 'product').get(String(alpha._id));
    assert.equal(alphaStock.name, 'Renamed alpha');
    assert.equal(alphaStock.costPrice, 77_777);
    assert.equal(alphaStock.stockValue, 622_216);
    assert.equal(inventoryAfter.valuationBasis, 'LATEST_PURCHASE_COST');

    /* ------------------------------------------------------ §41 prototype pollution */
    // The security property is that no query string can reach `Object.prototype`,
    // whether the parser drops the key or the schema rejects it.
    for (const raw of ['__proto__[polluted]=1', 'constructor[prototype][polluted]=1', 'a[__proto__][polluted]=1']) {
      const probe = await request(app).get(`/api/v1/admin/reports/sales?${raw}`).set(auth);
      assert.ok([200, 400].includes(probe.status), `${raw} must be handled deterministically`);
      assert.equal(({} as any).polluted, undefined, `${raw} must not pollute Object.prototype`);
    }
    // A normal request still works afterwards, so nothing was left in a poisoned state.
    assert.equal((await get('/reports/sales')).status, 200);

    /* ------------------------------------------------------------- §45 refund effect */
    // A FAILED refund never moved money, so it must not reduce revenue anywhere.
    const refundsBefore = (await get('/reports/finance')).body.data.totals.refunds;
    await Refund.create({
      refundNumber: 'RF-R-FAILED',
      order: realized._id,
      amount: 9_000,
      currency: 'PKR',
      status: 'FAILED',
      reason: 'Collection never completed',
      paymentMethod: 'CASH_ON_DELIVERY',
      processedBy: admin._id,
      idempotencyKey: 'rr-failed',
    });
    const afterFailed = (await get('/reports/finance')).body.data.totals;
    assert.equal(afterFailed.refunds, refundsBefore, 'a FAILED refund must not count as a refund');
    assert.equal(afterFailed.realizedRevenue, 51_000);
    assert.equal(afterFailed.netSales, 74_800);
    assert.equal(afterFailed.netRealizedRevenue, 49_800);
    assert.equal((await get('/reports/sales')).body.data.totals.refunds, refundsBefore);
    assert.equal((await get('/reports/profit')).body.data.refunds, refundsBefore);

    /* ------------------------------------------- §3 §43 cross-endpoint consistency */
    // The same window, read through six different endpoints, must produce one set of
    // numbers. This is the guard against every endpoint inventing its own formula.
    for (const named of ['7d', '30d', '90d'] as const) {
      const window = { range: named };
      const [financeDash, financeRpt, salesRpt, profitRpt, pnl, salesDash] = await Promise.all([
        get('/finance/dashboard', window),
        get('/reports/finance', window),
        get('/reports/sales', window),
        get('/reports/profit', window),
        get('/finance/profit-loss', window),
        get('/dashboard/sales', window),
      ]);
      const fd = financeDash.body.data;
      const fr = financeRpt.body.data.totals;
      const sr = salesRpt.body.data.totals;
      const pr = profitRpt.body.data;
      const pl = pnl.body.data;
      for (const [label, value] of [
        ['finance report', fr.realizedRevenue],
        ['sales report', sr.realizedRevenue],
        ['profit report', pr.realizedRevenue],
        ['profit and loss', pl.revenue.realizedRevenue],
      ] as const) {
        assert.equal(value, fd.revenue.realizedRevenue, `${named}: ${label} realizedRevenue must match the finance dashboard`);
      }
      for (const [label, value] of [
        ['finance report', fr.refunds],
        ['sales report', sr.refunds],
        ['profit report', pr.refunds],
        ['profit and loss', pl.revenue.refunds],
      ] as const) {
        assert.equal(value, fd.revenue.refunds, `${named}: ${label} refunds must match the finance dashboard`);
      }
      for (const [label, value] of [
        ['finance report', fr.netSales],
        ['sales report', sr.netSales],
        ['profit and loss', pl.revenue.netSales],
      ] as const) {
        assert.equal(value, fd.revenue.netSales, `${named}: ${label} netSales must match the finance dashboard`);
      }
      assert.equal(fr.grossSales, sr.grossSales, `${named}: grossSales must agree`);
      assert.equal(pl.costOfGoodsSold, fr.costOfGoodsSold, `${named}: COGS must agree`);
      assert.equal(pr.costOfGoodsSold, fr.costOfGoodsSold, `${named}: COGS must agree`);
      assert.equal(pl.grossProfit, fr.grossProfit, `${named}: grossProfit must agree`);
      assert.equal(pr.grossProfit, fr.grossProfit, `${named}: grossProfit must agree`);
      assert.equal(pl.operatingExpenses.total, fr.operatingExpenses, `${named}: operating expenses must agree`);
      assert.equal(pl.operatingProfit, fr.operatingProfit, `${named}: operatingProfit must agree`);
      assert.equal(pr.operatingProfit, fr.operatingProfit, `${named}: operatingProfit must agree`);
      assert.equal(pl.salesTaxCollected, (await get('/reports/tax', window)).body.data.salesTax.collectedOnSales, `${named}: sales tax must agree`);
      // §3: the Phase D sales dashboard is per-day realized revenue. Summing it must
      // land exactly on the finance definition, proving the old numbers were reused
      // rather than quietly redefined.
      const dashRows = salesDash.body.data as { revenue: number; orders: number }[];
      assert.equal(
        Number(dashRows.reduce((sum, row) => sum + row.revenue, 0).toFixed(2)),
        fd.revenue.realizedRevenue,
        `${named}: the Phase D sales dashboard must sum to the same realized revenue`
      );
      assert.equal(
        dashRows.reduce((sum, row) => sum + row.orders, 0),
        sr.realizedOrders,
        `${named}: realized order counts must agree`
      );
    }
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
