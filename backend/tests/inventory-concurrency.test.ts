import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Product } from '../src/models/product.js';
import { adjustStock } from '../src/services/inventoryService.js';

test('two competing decrements of one unit yield one success and one failure', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const product = await Product.create({
      name: 'Concurrency product',
      description: 'isolated test product',
      price: 1,
      category: 'test',
      image: 'https://example.test/product.png',
      stock: 1,
    });
    const results = await Promise.allSettled([
      adjustStock({ productId: String(product._id), quantityDelta: -1, reason: 'concurrency A', type: 'ORDER' }),
      adjustStock({ productId: String(product._id), quantityDelta: -1, reason: 'concurrency B', type: 'ORDER' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await Product.findById(product._id).lean()).stock, 0);
    const movements = await InventoryMovement.find({ product: product._id, type: 'ORDER' }).lean();
    assert.equal(movements.length, 1);
    assert.equal(movements[0].previousStock, 1);
    assert.equal(movements[0].newStock, 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
