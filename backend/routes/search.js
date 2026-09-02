const express = require('express');
const router = express.Router();
const Product = require('../models/product');

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Search for products
 *     description: Retrieve a list of products that match the provided search query in their name or description. If no query is provided, it returns all products.
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: false
 *         description: The search query to match against product names or descriptions.
 *     responses:
 *       200:
 *         description: A list of products matching the search query.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                     description: The unique identifier for the product.
 *                   name:
 *                     type: string
 *                     description: The name of the product.
 *                   description:
 *                     type: string
 *                     description: The description of the product.
 *                   price:
 *                     type: number
 *                     format: float
 *                     description: The price of the product.
 *                   category:
 *                     type: string
 *                     description: The category of the product.
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     description: The date the product was created.
 *                   updatedAt:
 *                     type: string
 *                     format: date-time
 *                     description: The date the product was last updated.
 *       500:
 *         description: An internal server error occurred.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: A message describing the error.
 */
router.get('/', async (req, res) => {
  try {
    const query = String(req.query.q || '')
      .trim()
      .slice(0, 80);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const products = await Product.find({
      $or: [{ name: { $regex: escapedQuery, $options: 'i' } }, { description: { $regex: escapedQuery, $options: 'i' } }],
    })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json(products);
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ error: 'An error occurred during the search.' });
  }
});

module.exports = router;
