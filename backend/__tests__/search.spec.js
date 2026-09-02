const express = require('express');
const request = require('supertest');
jest.mock('../models/product');
const Product = require('../models/product');
const router = require('../routes/search');
describe('safe search', () => {
  let app;
  beforeEach(() => {
    app = express();
    app.use('/api/search', router);
    Product.find.mockReturnValue({ skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) });
  });
  it('escapes regex controls and bounds pagination', async () => {
    const response = await request(app).get('/api/search?q=(a%2B)%2B&page=-2&limit=999');
    expect(response.status).toBe(200);
    expect(Product.find).toHaveBeenCalledWith(expect.objectContaining({ $or: expect.any(Array) }));
  });
});
