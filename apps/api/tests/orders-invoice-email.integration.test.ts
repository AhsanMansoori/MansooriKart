import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from './helpers/mongo.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Address } from '../src/models/address.js';
import { Cart } from '../src/models/cart.js';
import { InventoryBalance } from '../src/models/inventoryBalance.js';
import { InventoryMovement } from '../src/models/inventoryMovement.js';
import { Order } from '../src/models/order.js';
import { Product } from '../src/models/product.js';
import { User } from '../src/models/user.js';
import {
  buildOrderConfirmationContent,
  clearEmailFailures,
  flushEmailDeliveries,
  getEmailFailures,
  resetEmailAdapter,
  setEmailAdapter,
  type EmailMessage,
} from '../src/services/transactionalEmail.js';
process.env.JWT_SECRET ||= 'v1-test-secret';
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/mansoorikart_v1_test';
const app = createApp();
const PASSWORD_MATERIAL = '$2b$10$fakehashfakehashfakehashfake';

const binary = (url: string, token?: string) => {
  const pending = request(app).get(url);
  if (token) pending.set('Authorization', `Bearer ${token}`);
  return pending.buffer(true).parse((response: any, callback: any) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  });
};

/**
 * Reconstructs the visible text of an uncompressed PDF. pdfkit emits kerned hex runs such as
 * `[<4d616e...> -20 <74> 0] TJ`, so each run is decoded and the kerning offsets dropped.
 */
const decodePdfText = (buffer: Buffer): string => {
  const raw = buffer.toString('latin1');
  let text = '';
  for (const run of raw.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
    const body = run[1] ?? run[2] ?? '';
    for (const hex of body.matchAll(/<([0-9a-fA-F]*)>/g)) text += Buffer.from(hex[1]!, 'hex').toString('latin1');
    if (run[2]) text += Buffer.from(run[2], 'hex').toString('latin1');
    text += '\n';
  }
  return text;
};

test('invoices are immutable and ownership-scoped, PDFs render real documents, and email is a safe side effect', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { downloadDir: `${process.cwd()}/.cache/mongodb-binaries` } });
  await mongoose.connect(mongo.getUri());
  try {
    await Promise.all([Order.init(), InventoryBalance.init()]);
    const [owner, stranger, admin] = await User.create([
      { name: 'Invoice Owner', email: 'owner@d.test', password: PASSWORD_MATERIAL, role: 'CUSTOMER' },
      { name: 'Stranger', email: 'stranger@d.test', password: PASSWORD_MATERIAL, role: 'CUSTOMER' },
      { name: 'Admin', email: 'admin@d.test', password: PASSWORD_MATERIAL, role: 'SUPER_ADMIN' },
    ]);
    const token = (user: any, role: string) => jwt.sign({ sub: String(user._id), role }, process.env.JWT_SECRET!);
    const [ot, xt, st] = [token(owner, 'CUSTOMER'), token(stranger, 'CUSTOMER'), token(admin, 'SUPER_ADMIN')];
    const address = await Address.create({
      user: owner._id,
      fullName: 'Invoice Owner',
      phone: '03001234567',
      addressLine1: 'Flat 4, Nazimabad',
      city: 'Karachi',
      stateProvince: 'Sindh',
      postalCode: '74600',
      country: 'PK',
    });
    const product = await Product.create({
      name: 'Immutable item',
      sku: 'INVOICE-SKU',
      description: 'x',
      price: 1000,
      category: 'x',
      image: 'https://e/1',
      stock: 20,
      status: 'ACTIVE',
    });
    const emailProduct = await Product.create({
      name: 'Email item',
      sku: 'EMAIL-SKU',
      description: 'x',
      price: 1000,
      category: 'x',
      image: 'https://e/2',
      stock: 20,
      status: 'ACTIVE',
    });
    const placeOrder = async (key: string, item: any = product) => {
      await Cart.findOneAndUpdate({ user: owner._id }, { $set: { items: [{ product: item._id, quantity: 1 }] } }, { upsert: true });
      const response = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${ot}`)
        .set('Idempotency-Key', key)
        .send({ addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY' });
      assert.equal(response.status, 201);
      return response.body.data;
    };

    const order = await placeOrder('invoice-order-one');
    assert.equal(order.total, 1250);
    // The invoice number is server-generated, derived from the unique order number, and persisted.
    assert.equal(order.invoiceNumber, `INV-${order.orderNumber}`);
    assert.match(order.invoiceNumber, /^INV-MK-\d{8}-[0-9A-F]{6}$/);

    // Product edits after purchase must never reach a historical invoice.
    await Product.updateOne({ _id: product._id }, { $set: { name: 'Renamed after purchase', price: 9999, sku: 'CHANGED-SKU' } });

    // ---- Invoice JSON: content, immutability and ownership. ----
    let r = await request(app).get(`/api/v1/orders/${order._id}/invoice`).set('Authorization', `Bearer ${ot}`);
    assert.equal(r.status, 200);
    const invoice = r.body.data;
    assert.equal(invoice.storeName, 'MansooriKart');
    assert.equal(invoice.invoiceNumber, order.invoiceNumber);
    assert.equal(invoice.orderNumber, order.orderNumber);
    assert.equal(invoice.items[0].name, 'Immutable item');
    assert.equal(invoice.items[0].sku, 'INVOICE-SKU');
    assert.equal(invoice.items[0].unitPrice, 1000);
    assert.equal(invoice.items[0].quantity, 1);
    assert.equal(invoice.items[0].lineSubtotal, 1000);
    assert.equal(invoice.subtotal, 1000);
    assert.equal(invoice.discount, 0);
    assert.equal(invoice.shipping, 250);
    assert.equal(invoice.tax, 0);
    assert.equal(invoice.total, 1250);
    assert.equal(invoice.currency, 'PKR');
    assert.equal(invoice.paymentMethod, 'CASH_ON_DELIVERY');
    assert.equal(invoice.paymentStatus, 'UNPAID');
    assert.equal(invoice.shippingAddress.city, 'Karachi');
    assert.ok(invoice.orderDate);
    assert.equal((await request(app).get(`/api/v1/orders/${order._id}/invoice`).set('Authorization', `Bearer ${xt}`)).status, 404);
    assert.equal((await request(app).get(`/api/v1/orders/${order._id}/invoice`)).status, 401);

    // ---- Admin invoice: any order, but never for a customer token. ----
    r = await request(app).get(`/api/v1/admin/orders/${order._id}/invoice`).set('Authorization', `Bearer ${st}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.invoiceNumber, order.invoiceNumber);
    assert.equal(r.body.data.items[0].name, 'Immutable item');
    assert.equal(r.body.data.items[0].unitPrice, 1000);
    assert.equal(r.body.data.customer.email, 'owner@d.test');
    assert.deepEqual(Object.keys(r.body.data.customer).sort(), ['email', 'id', 'name']);
    assert.equal((await request(app).get(`/api/v1/admin/orders/${order._id}/invoice`).set('Authorization', `Bearer ${ot}`)).status, 403);
    assert.equal((await request(app).get(`/api/v1/admin/orders/${order._id}/invoice`)).status, 401);
    assert.equal((await request(app).get('/api/v1/admin/orders/not-an-id/invoice').set('Authorization', `Bearer ${st}`)).status, 400);
    assert.equal((await request(app).get(`/api/v1/admin/orders/${new mongoose.Types.ObjectId()}/invoice`).set('Authorization', `Bearer ${st}`)).status, 404);
    for (const payload of [JSON.stringify(invoice), JSON.stringify(r.body.data)]) {
      assert.ok(!payload.includes(PASSWORD_MATERIAL));
      assert.ok(!payload.toLowerCase().includes('password'));
      assert.ok(!payload.includes(ot));
    }

    // ---- PDF invoice: real bytes, snapshot content, ownership. ----
    r = await binary(`/api/v1/orders/${order._id}/invoice.pdf`, ot);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.equal(r.headers['content-disposition'], `attachment; filename="${order.invoiceNumber}.pdf"`);
    assert.equal(Number(r.headers['content-length']), r.body.length);
    assert.ok(Buffer.isBuffer(r.body));
    assert.equal(r.body.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(r.body.subarray(-1024).toString('latin1').includes('%%EOF'));
    assert.ok(r.body.length > 1000, 'a rendered invoice must be a real document, not a stub');
    const pdfText = decodePdfText(r.body);
    for (const expected of [
      'MansooriKart',
      order.invoiceNumber,
      order.orderNumber,
      'Immutable item',
      'INVOICE-SKU',
      '1000.00',
      'PKR 1250.00',
      'CASH_ON_DELIVERY',
      'UNPAID',
      'Karachi',
    ])
      assert.ok(pdfText.includes(expected), `PDF must contain ${expected}`);
    for (const forbidden of ['Renamed after purchase', 'CHANGED-SKU', '9999', PASSWORD_MATERIAL])
      assert.ok(!pdfText.includes(forbidden), `PDF must not contain ${forbidden}`);
    assert.ok(!r.body.toString('latin1').includes(PASSWORD_MATERIAL));

    assert.equal((await binary(`/api/v1/orders/${order._id}/invoice.pdf`, xt)).status, 404);
    assert.equal((await binary(`/api/v1/orders/${order._id}/invoice.pdf`)).status, 401);
    const adminPdf = await binary(`/api/v1/admin/orders/${order._id}/invoice.pdf`, st);
    assert.equal(adminPdf.status, 200);
    assert.equal(adminPdf.headers['content-type'], 'application/pdf');
    assert.equal(adminPdf.body.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(decodePdfText(adminPdf.body).includes('Immutable item'));
    assert.equal((await binary(`/api/v1/admin/orders/${order._id}/invoice.pdf`, ot)).status, 403);
    assert.equal((await binary(`/api/v1/admin/orders/${order._id}/invoice.pdf`)).status, 401);
    assert.equal((await binary('/api/v1/admin/orders/not-an-id/invoice.pdf', st)).status, 400);
    assert.equal((await binary(`/api/v1/admin/orders/${new mongoose.Types.ObjectId()}/invoice.pdf`, st)).status, 404);

    // ---- Invoice number is immutable and never client-controlled. ----
    for (const status of ['CONFIRMED', 'PROCESSING'])
      assert.equal(
        (
          await request(app)
            .patch(`/api/v1/admin/orders/${order._id}/status`)
            .set('Authorization', `Bearer ${st}`)
            .send({ status, reason: 'Invoice stability' })
        ).status,
        200
      );
    assert.equal((await Order.findById(order._id).lean())!.invoiceNumber, order.invoiceNumber);
    for (const body of [
      { addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY', invoiceNumber: 'INV-ATTACKER' },
      { addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY', orderNumber: 'MK-FORGED' },
      { addressId: String(address._id), paymentMethod: 'CASH_ON_DELIVERY', refundedTotal: -100 },
    ]) {
      const response = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${ot}`)
        .set('Idempotency-Key', `forged-${Math.random()}`)
        .send(body as any);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(await Order.countDocuments({ invoiceNumber: 'INV-ATTACKER' }), 0);

    // ---- Email failure must not damage a committed checkout. ----
    clearEmailFailures();
    setEmailAdapter({
      name: 'failing-test-adapter',
      async send() {
        throw new Error('provider unavailable');
      },
    });
    const beforeBalance = (await InventoryBalance.findOne({ product: product._id }).lean())!.quantityOnHand;
    const beforeMovements = await InventoryMovement.countDocuments({ product: product._id, type: 'ORDER' });
    const failedEmailOrder = await placeOrder('invoice-order-email-fail');
    await flushEmailDeliveries();
    assert.equal(await Order.countDocuments({ idempotencyKey: 'invoice-order-email-fail' }), 1, 'email failure must not duplicate or roll back the order');
    assert.equal((await Order.findById(failedEmailOrder._id).lean())!.orderStatus, 'PENDING');
    assert.equal((await InventoryBalance.findOne({ product: product._id }).lean())!.quantityOnHand, beforeBalance - 1);
    assert.equal((await Product.findById(product._id).lean())!.stock, beforeBalance - 1);
    assert.equal(await InventoryMovement.countDocuments({ product: product._id, type: 'ORDER' }), beforeMovements + 1);
    assert.equal((await Cart.findOne({ user: owner._id }).lean())!.items.length, 0, 'cart must still be cleared after an email failure');
    const failures = getEmailFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.orderNumber, failedEmailOrder.orderNumber);
    assert.equal(failures[0]!.adapter, 'failing-test-adapter');
    assert.equal(failures[0]!.reason, 'Provider delivery failed.');
    assert.ok(!JSON.stringify(failures).includes(PASSWORD_MATERIAL));

    // ---- Email content contract, built from the immutable order snapshot. ----
    const captured: EmailMessage[] = [];
    setEmailAdapter({
      name: 'capturing-test-adapter',
      async send(message) {
        captured.push(message);
      },
    });
    const emailedOrder = await placeOrder('invoice-order-email-ok', emailProduct);
    await flushEmailDeliveries();
    assert.equal(captured.length, 1);
    const message = captured[0]!;
    assert.equal(message.template, 'ORDER_CONFIRMATION');
    assert.equal(message.to, 'owner@d.test');
    assert.ok(message.subject.includes(emailedOrder.invoiceNumber));
    const content = message.data;
    assert.equal(content.orderNumber, emailedOrder.orderNumber);
    assert.equal(content.invoiceNumber, emailedOrder.invoiceNumber);
    assert.equal(content.customerName, 'Invoice Owner');
    assert.equal(content.items.length, 1);
    assert.equal(content.items[0]!.name, 'Email item');
    assert.equal(content.items[0]!.name, emailedOrder.items[0].name, 'content must mirror the order snapshot, not live catalog data');
    assert.equal(content.items[0]!.sku, 'EMAIL-SKU');
    assert.equal(content.items[0]!.quantity, 1);
    assert.equal(content.items[0]!.unitPrice, 1000);
    assert.equal(content.items[0]!.lineSubtotal, 1000);
    assert.equal(content.subtotal, 1000);
    assert.equal(content.discount, 0);
    assert.equal(content.shipping, 250);
    assert.equal(content.tax, 0);
    assert.equal(content.total, 1250);
    assert.equal(content.currency, 'PKR');
    assert.equal(content.paymentMethod, 'CASH_ON_DELIVERY');
    assert.equal(content.paymentStatus, 'UNPAID');
    assert.equal(content.shippingAddressSummary, 'Flat 4, Nazimabad, Karachi, Sindh, 74600, PK');
    assert.equal(content.orderReference, String(emailedOrder._id));
    assert.ok(content.orderDate);
    const serialised = JSON.stringify(message);
    for (const forbidden of ['password', 'passwordHash', 'resetToken', 'secret', 'jwt', PASSWORD_MATERIAL, ot])
      assert.ok(!serialised.toLowerCase().includes(forbidden.toLowerCase()), `email content leaked ${forbidden}`);
    assert.deepEqual(Object.keys(message).sort(), ['data', 'subject', 'template', 'to']);

    // Confirmation content is snapshot-derived: the first order still reports its purchase-time
    // item name and price even though that product has since been renamed and repriced.
    const historical = buildOrderConfirmationContent((await Order.findById(order._id).lean())!, { name: 'Invoice Owner', email: 'owner@d.test' });
    assert.equal(historical.items[0]!.name, 'Immutable item');
    assert.equal(historical.items[0]!.unitPrice, 1000);
    assert.equal(historical.total, 1250);
    assert.equal(historical.invoiceNumber, order.invoiceNumber);
  } finally {
    resetEmailAdapter();
    clearEmailFailures();
    await mongoose.disconnect();
    await mongo.stop();
  }
});
