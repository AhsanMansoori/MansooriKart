import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/auditLog.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';

process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();

test('Super Admin core and catalog routes use real data, strict contracts, archives, and safe public serialization', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    const [customer, admin] = await User.create([
      { name: 'Customer', email: 'customer@admin-phase.test', password: 'x', role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@admin-phase.test', password: 'x', role: 'SUPER_ADMIN' },
    ]);
    const customerToken = jwt.sign({ sub: String(customer._id), role: 'CUSTOMER' }, process.env.JWT_SECRET!);
    const adminToken = jwt.sign({ sub: String(admin._id), role: 'SUPER_ADMIN' }, process.env.JWT_SECRET!);
    const auth = { Authorization: `Bearer ${adminToken}` };
    let response = await request(app).get('/api/v1/admin/dashboard');
    assert.equal(response.status, 401);
    response = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${customerToken}`);
    assert.equal(response.status, 403);
    response = await request(app).get('/api/v1/admin/system/health').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.database, 'connected');
    assert.equal(JSON.stringify(response.body).match(/mongo_uri|jwt_secret|mongodb:\/\//i), null);

    response = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth)
      .send({ name: 'Phones', slug: 'phones', description: 'Phone category', status: 'ACTIVE' });
    assert.equal(response.status, 201);
    const category = response.body.data;
    response = await request(app).post('/api/v1/admin/brands').set(auth).send({ name: 'Mansoori', slug: 'mansoori', status: 'ACTIVE' });
    assert.equal(response.status, 201);
    response = await request(app).post('/api/v1/admin/product-types').set(auth).send({ name: 'Electronics', slug: 'electronics' });
    assert.equal(response.status, 201);
    const productType = response.body.data;
    response = await request(app).post('/api/v1/admin/badges').set(auth).send({ name: 'New', slug: 'new' });
    assert.equal(response.status, 201);
    const badge = response.body.data;
    response = await request(app)
      .post('/api/v1/admin/attributes')
      .set(auth)
      .send({ name: 'Color', slug: 'color', kind: 'COLOR', values: [{ value: 'black', label: 'Black' }] });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.values[0].value, 'black');

    const productPayload = {
      name: 'Mansoori Phone',
      slug: 'mansoori-phone',
      sku: 'MK-PHONE-001',
      description: 'A production test phone',
      shortDescription: 'Test phone',
      category: 'phones',
      brand: 'mansoori',
      image: 'https://example.test/phone.jpg',
      images: [{ url: 'https://example.test/phone.jpg', alt: 'Phone', position: 0, isPrimary: true }],
      price: 1000,
      compareAtPrice: 1200,
      costPrice: 700,
      stock: 2,
      lowStockThreshold: 2,
      status: 'ACTIVE',
      featured: true,
      tags: ['phone'],
      productType: productType.id,
      badges: [badge.id],
      seo: { title: 'Phone SEO' },
    };
    response = await request(app).post('/api/v1/admin/products').set(auth).set('x-request-id', 'admin-catalog-create').send(productPayload);
    assert.equal(response.status, 201);
    const product = response.body.data;
    assert.equal(product.costPrice, 700);
    response = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ ...productPayload, slug: 'mansoori-phone-sku-duplicate' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'PRODUCT_SKU_EXISTS');
    response = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ ...productPayload, sku: 'MK-PHONE-002' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'SLUG_EXISTS');
    response = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ ...productPayload, sku: 'MK-PHONE-003', slug: 'bad-product', price: -1 });
    assert.equal(response.status, 400);
    response = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send({ ...productPayload, sku: 'MK-PHONE-004', slug: 'unsafe-product', role: 'SUPER_ADMIN' });
    assert.equal(response.status, 400);

    response = await request(app).get('/api/v1/admin/products?page=1&limit=1&stockState=LOW_STOCK&search=Phone').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.limit, 1);
    assert.equal(response.body.meta.total, 1);
    response = await request(app).patch(`/api/v1/admin/products/${product.id}`).set(auth).send({ price: 1100, costPrice: 750, stock: 3 });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.price, 1100);
    response = await request(app).get(`/api/v1/admin/products/${product.id}`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ACTIVE');
    response = await request(app).get('/api/v1/products/mansoori-phone');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.costPrice, undefined);
    assert.equal(response.body.data.stock, undefined);

    await Product.create({
      name: 'Draft Product',
      slug: 'draft-product',
      sku: 'MK-DRAFT-001',
      description: 'Draft',
      category: 'phones',
      image: 'https://example.test/draft.jpg',
      price: 20,
      status: 'DRAFT',
    });
    await Order.create([
      {
        customer: customer._id,
        orderNumber: 'MK-PAID-001',
        idempotencyKey: 'paid-1',
        items: [],
        shippingAddress: {},
        total: 400,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'PAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: customer._id,
        orderNumber: 'MK-UNPAID-001',
        idempotencyKey: 'unpaid-1',
        items: [],
        shippingAddress: {},
        total: 900,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'DELIVERED',
      },
      {
        customer: customer._id,
        orderNumber: 'MK-CANCEL-001',
        idempotencyKey: 'cancel-1',
        items: [],
        shippingAddress: {},
        total: 500,
        paymentMethod: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
        orderStatus: 'CANCELLED',
      },
    ]);
    response = await request(app).get('/api/v1/admin/dashboard').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.totalProducts, 2);
    assert.equal(response.body.data.activeProducts, 1);
    assert.equal(response.body.data.draftProducts, 1);
    assert.equal(response.body.data.totalOrders, 3);
    assert.equal(response.body.data.deliveredOrders, 2);
    assert.equal(response.body.data.cancelledOrders, 1);
    assert.equal(response.body.data.totalRevenue, 400, 'only paid delivered COD is realized revenue');
    assert.equal(response.body.data.lowStockProducts, 1);
    response = await request(app).get('/api/v1/admin/dashboard/sales?range=7d').set(auth);
    assert.equal(response.status, 200);
    assert.equal(
      response.body.data.reduce((total: number, item: any) => total + item.revenue, 0),
      400
    );

    response = await request(app).get('/api/v1/admin/audit-logs?action=PRODUCT_CREATED&page=1&limit=10').set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].requestId, 'admin-catalog-create');
    assert.equal(JSON.stringify(response.body).match(/password|authorization|bearer|secret/i), null);
    assert.equal(await AuditLog.countDocuments({ action: 'PRODUCT_CREATED', resourceId: product.id }), 1);

    response = await request(app).delete(`/api/v1/admin/products/${product.id}`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ARCHIVED');
    response = await request(app).get('/api/v1/products/mansoori-phone');
    assert.equal(response.status, 404);
    response = await request(app).get(`/api/v1/admin/products/${product.id}`).set(auth);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'ARCHIVED');

    response = await request(app).delete(`/api/v1/admin/categories/${category.id}`).set(auth);
    assert.equal(response.status, 200);
    response = await request(app).get('/api/v1/categories/phones');
    assert.equal(response.status, 404);
    response = await request(app).get('/api/v1/admin/products/not-an-id').set(auth);
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).match(/casterror|mongoose|stack/i), null);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
});
