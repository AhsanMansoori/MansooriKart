const express = require('express');
const request = require('supertest');
jest.mock('../models/order');
const Order = require('../models/order');
const router = require('../routes/orders');

describe('order tracking is read-only', () => {
  it('returns the existing status without saving or advancing it', async () => {
    const order = {
      orderNumber: 'FE-1',
      email: 'a@example.com',
      status: 'PENDING',
      statusHistory: [{ code: 'ORDER_PLACED' }],
      items: [],
      total: 10,
      ensureInitialStatus: jest.fn(),
    };
    Order.findOne.mockResolvedValue(order);
    Order.STATUS_FLOW = [];
    const app = express();
    app.use(express.json());
    app.use('/api/orders', router);
    const first = await request(app).post('/api/orders/track').send({ orderNumber: 'FE-1', email: 'a@example.com' });
    const second = await request(app).post('/api/orders/track').send({ orderNumber: 'FE-1', email: 'a@example.com' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.currentStatus.code).toBe('ORDER_PLACED');
    expect(second.body.currentStatus.code).toBe('ORDER_PLACED');
    expect(order.save).toBeUndefined();
  });
});
