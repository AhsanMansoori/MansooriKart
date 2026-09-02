const express = require('express');
const request = require('supertest');
jest.mock('../models/product');
jest.mock('../models/order');
const Product = require('../models/product');
const Order = require('../models/order');
const checkoutRouter = require('../routes/checkout');

describe('Phase 1 checkout contracts', () => {
  let app;
  const id = '507f1f77bcf86cd799439011';
  const product = { _id: id, name: 'Product', price: 99, stock: 3, image: '' };
  const payload = () => ({
    name: 'A',
    email: 'a@example.com',
    shippingAddress: 'Address',
    paymentMethod: 'COD',
    items: [{ productId: id, quantity: 2, price: 1 }],
  });
  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/checkout', checkoutRouter);
    Product.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([product]) });
    Product.findOneAndUpdate.mockResolvedValue(product);
    Product.updateOne.mockResolvedValue({});
    Order.mockImplementation(data => ({ ...data, ensureInitialStatus: jest.fn(), save: jest.fn().mockResolvedValue() }));
  });
  it('uses authoritative price and decrements stock', async () => {
    const response = await request(app).post('/api/checkout/create-order').send(payload());
    expect(response.status).toBe(201);
    expect(response.body.data.total).toBe(198);
    expect(Product.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ stock: { $gte: 2 } }), { $inc: { stock: -2 } }, { new: true });
  });
  it('rejects online payment and raw card data', async () => {
    const online = await request(app)
      .post('/api/checkout/create-order')
      .send({ ...payload(), paymentMethod: 'ONLINE' });
    const card = await request(app)
      .post('/api/checkout/create-order')
      .send({ ...payload(), cardNumber: '4111111111111111', cvc: '123' });
    expect(online.body.error.code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
    expect(card.body.error.code).toBe('PAYMENT_CARD_DATA_FORBIDDEN');
  });
  it('rejects unavailable stock and compensates previously decremented items', async () => {
    const second = { ...product, _id: '507f191e810c19729de860ea', stock: 0 };
    Product.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([product, second]) });
    Product.findOneAndUpdate.mockResolvedValueOnce(product).mockResolvedValueOnce(null);
    const response = await request(app)
      .post('/api/checkout/create-order')
      .send({
        ...payload(),
        items: [
          { productId: id, quantity: 1 },
          { productId: second._id, quantity: 1 },
        ],
      });
    expect(response.status).toBe(409);
    expect(Product.updateOne).toHaveBeenCalledWith({ _id: id }, { $inc: { stock: 1 } });
  });
});
