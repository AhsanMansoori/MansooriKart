import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
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
import { createPurchaseOrder, receiveGoods, returnToSupplier, transitionPurchaseOrder } from '../src/services/purchasingService.js';

process.env.JWT_SECRET ||= 'v1-test-secret';

const onHand = async (productId: string) =>
  (await InventoryBalance.find({ product: productId }).lean()).reduce((sum: number, balance: any) => sum + balance.quantityOnHand, 0);

/**
 * The audit failures below are real database failures, not stubs: a partial unique
 * index makes the second write of a given audit action genuinely violate a
 * constraint, exactly as a storage fault would.
 */
test('purchasing compensates inventory when a receipt or return cannot be audited', async () => {
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
    const admin = await User.create({ name: 'Admin', email: 'compensation-admin@test.local', password: 'Secret123!', role: 'SUPER_ADMIN' });
    const supplier = await Supplier.create({ name: 'Compensation Supplier', code: 'COMP-1' });
    const product = await Product.create({
      name: 'Compensation stock',
      slug: 'compensation-stock',
      sku: 'COMP-001',
      description: 'x',
      category: 'x',
      image: 'https://e.test/x',
      price: 100,
      costPrice: 40,
      stock: 2,
      status: 'ACTIVE',
    });
    await ensureBalance(String(product._id));
    const context = { actor: String(admin._id), requestId: 'compensation-request' };

    const purchaseOrder = await createPurchaseOrder({
      supplierId: String(supplier._id),
      items: [{ productId: String(product._id), quantity: 10, unitCost: 50 }],
      ...context,
    });
    await transitionPurchaseOrder(String(purchaseOrder._id), 'APPROVED', context);
    const lineId = String(purchaseOrder.items[0]._id);

    /* ------------------------------------------------- Successful baseline */
    await receiveGoods(
      String(purchaseOrder._id),
      { items: [{ purchaseOrderItemId: lineId, quantityAccepted: 3 }] },
      { ...context, idempotencyKey: 'baseline-receipt-key' }
    );
    assert.equal(await onHand(String(product._id)), 5);
    assert.equal((await Product.findById(product._id).lean()).stock, 5);
    assert.equal(await GoodsReceipt.countDocuments({}), 1);

    /* ----------------------------------------- Receipt audit made to fail */
    await AuditLog.collection.createIndex({ action: 1 }, { unique: true, partialFilterExpression: { action: 'PURCHASE_GOODS_RECEIVED' } });
    const receiptsBefore = await GoodsReceipt.countDocuments({});
    await assert.rejects(
      () =>
        receiveGoods(
          String(purchaseOrder._id),
          { items: [{ purchaseOrderItemId: lineId, quantityAccepted: 4 }] },
          { ...context, idempotencyKey: 'unauditable-receipt-key' }
        ),
      (error: any) => error.code === 'PURCHASE_RECEIPT_AUDIT_FAILED' && error.status === 500
    );
    // No phantom inventory: the balance, the mirror and the order counters are all back.
    assert.equal(await onHand(String(product._id)), 5, 'an unauditable receipt must not leave stock behind');
    assert.equal((await Product.findById(product._id).lean()).stock, 5, 'the Product.stock mirror must be compensated too');
    assert.equal(await GoodsReceipt.countDocuments({}), receiptsBefore, 'the receipt document must be removed');
    let stored = await PurchaseOrder.findById(purchaseOrder._id).lean();
    assert.equal(stored.items[0].quantityReceived, 3, 'the reserved receiving capacity must be released');
    assert.equal(stored.items[0].quantityAccepted, 3);
    assert.equal(stored.status, 'PARTIALLY_RECEIVED');
    // The ledger keeps both the application and its reversal, and they net to zero.
    const movements = await InventoryMovement.find({ product: product._id }).lean();
    assert.equal(
      movements.reduce((sum: number, movement: any) => sum + movement.quantityDelta, 0),
      3,
      'the movement ledger must reconcile with the balance'
    );
    assert.ok(
      movements.some((movement: any) => movement.quantityDelta === -4),
      'the compensating reversal must be recorded, not hidden'
    );
    // The same key is free to be retried once auditing works again.
    await AuditLog.collection.dropIndex('action_1');
    const retried = await receiveGoods(
      String(purchaseOrder._id),
      { items: [{ purchaseOrderItemId: lineId, quantityAccepted: 4 }] },
      { ...context, idempotencyKey: 'unauditable-receipt-key' }
    );
    assert.equal(retried.totalAccepted, 4);
    assert.equal(await onHand(String(product._id)), 9);
    assert.equal((await Product.findById(product._id).lean()).stock, 9);

    /* ------------------------------------------ Return audit made to fail */
    await returnToSupplier(
      String(purchaseOrder._id),
      { items: [{ purchaseOrderItemId: lineId, quantity: 1 }], reason: 'Baseline return' },
      { ...context, idempotencyKey: 'baseline-return-key' }
    );
    assert.equal(await onHand(String(product._id)), 8);
    await AuditLog.collection.createIndex({ action: 1 }, { unique: true, partialFilterExpression: { action: 'PURCHASE_RETURN_CREATED' } });
    await assert.rejects(
      () =>
        returnToSupplier(
          String(purchaseOrder._id),
          { items: [{ purchaseOrderItemId: lineId, quantity: 2 }], reason: 'Unauditable return' },
          { ...context, idempotencyKey: 'unauditable-return-key' }
        ),
      (error: any) => error.code === 'PURCHASE_RETURN_AUDIT_FAILED' && error.status === 500
    );
    assert.equal(await onHand(String(product._id)), 8, 'an unauditable return must not remove stock');
    assert.equal((await Product.findById(product._id).lean()).stock, 8);
    assert.equal(await PurchaseReturn.countDocuments({}), 1, 'the return document must be removed');
    stored = await PurchaseOrder.findById(purchaseOrder._id).lean();
    assert.equal(stored.items[0].quantityReturned, 1, 'the reserved return capacity must be released');

    /* ------------------------------- Inventory failure before any document */
    // Returning more than the warehouse physically holds is refused by the
    // inventory service itself; nothing is persisted and no counter moves.
    await InventoryBalance.updateMany({ product: product._id }, { $set: { quantityOnHand: 1 } });
    await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
    await assert.rejects(
      () =>
        returnToSupplier(
          String(purchaseOrder._id),
          { items: [{ purchaseOrderItemId: lineId, quantity: 3 }], reason: 'More than held' },
          { ...context, idempotencyKey: 'insufficient-return-key' }
        ),
      (error: any) => error.code === 'INSUFFICIENT_STOCK'
    );
    assert.equal(await onHand(String(product._id)), 1);
    assert.equal(await PurchaseReturn.countDocuments({}), 1);
    stored = await PurchaseOrder.findById(purchaseOrder._id).lean();
    assert.equal(stored.items[0].quantityReturned, 1, 'a failed return must not consume return capacity');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
