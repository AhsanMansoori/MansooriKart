import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Product } from '../src/models/product.js';
import { adjustStock } from '../src/services/inventoryService.js';
test('inventory service compensates stock when real movement persistence validation fails', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const product = await Product.create({ name: 'Compensation product', description: 'x', price: 1, category: 'x', image: 'https://e.test/i.png', stock: 5 });
    await assert.rejects(() => adjustStock({ productId: String(product._id), quantityDelta: -1, reason: 'x'.repeat(501), type: 'ORDER' }));
    assert.equal((await Product.findById(product._id).lean()).stock, 5);
    assert.equal(await InventoryMovement.countDocuments({ product: product._id }), 0);
    await assert.rejects(() => adjustStock({ productId: '507f1f77bcf86cd799439011', quantityDelta: -1, reason: 'missing', type: 'ORDER' }));
    assert.equal(await InventoryMovement.countDocuments(), 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
