import { withAvailability } from '../../services/productAvailability.js';
import express from 'express';
import { z } from 'zod';
import { Brand } from '../../models/brand.js';
import { Category } from '../../models/category.js';
import { Product } from '../../models/product.js';
import { validate } from '../../middleware/validate.js';
import * as serialize from '../../serializers/index.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const router = express.Router();
const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(80).optional(),
    category: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(120).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating']).default('newest'),
    featured: z.enum(['true', 'false']).optional(),
  })
  .strict();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicFilter = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
const sorts = { newest: { createdAt: -1 }, price_asc: { price: 1 }, price_desc: { price: -1 }, rating: { ratingAverage: -1, rating: -1 } };
router.get('/categories', async (_request, response, next) => {
  try {
    return sendSuccess(response, (await Category.find({ status: 'ACTIVE' }).sort({ sortOrder: 1, name: 1 }).lean()).map(serialize.category));
  } catch (error) {
    return next(error);
  }
});
router.get('/categories/:slug', async (request, response, next) => {
  try {
    const item = await Category.findOne({ slug: String(request.params.slug).toLowerCase(), status: 'ACTIVE' }).lean();
    return item ? sendSuccess(response, serialize.category(item)) : sendFailure(response, 404, 'CATEGORY_NOT_FOUND', 'Category not found', request.requestId);
  } catch (error) {
    return next(error);
  }
});
router.get('/brands', async (_request, response, next) => {
  try {
    return sendSuccess(response, (await Brand.find({ status: 'ACTIVE' }).sort({ name: 1 }).lean()).map(serialize.brand));
  } catch (error) {
    return next(error);
  }
});
router.get('/brands/:slug', async (request, response, next) => {
  try {
    const item = await Brand.findOne({ slug: String(request.params.slug).toLowerCase(), status: 'ACTIVE' }).lean();
    return item ? sendSuccess(response, serialize.brand(item)) : sendFailure(response, 404, 'BRAND_NOT_FOUND', 'Brand not found', request.requestId);
  } catch (error) {
    return next(error);
  }
});
router.get('/products', validate(querySchema, 'query'), async (request, response, next) => {
  try {
    const query = request.query as unknown as z.infer<typeof querySchema>;
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice)
      return sendFailure(response, 400, 'PRICE_RANGE_INVALID', 'Minimum price cannot exceed maximum price', request.requestId);
    const filter: Record<string, unknown> = { ...publicFilter };
    if (query.search)
      filter.$and = [
        { $or: [{ name: { $regex: escapeRegex(query.search), $options: 'i' } }, { description: { $regex: escapeRegex(query.search), $options: 'i' } }] },
      ];
    if (query.category) filter.category = query.category;
    if (query.brand) filter.brand = query.brand;
    if (query.featured) filter.featured = query.featured === 'true';
    if (query.minPrice !== undefined || query.maxPrice !== undefined)
      filter.price = { ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}), ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}) };
    const [data, total] = await Promise.all([
      Product.find(filter)
        .sort(sorts[query.sort])
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return sendSuccess(response, (await withAvailability(data)).map(serialize.product), 200, {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    });
  } catch (error) {
    return next(error);
  }
});
router.get('/products/:identifier', async (request, response, next) => {
  try {
    const identifier = String(request.params.identifier).trim();
    const isId = /^[a-f\d]{24}$/i.test(identifier);
    const item = await Product.findOne({
      ...publicFilter,
      $and: [{ $or: [{ slug: identifier.toLowerCase() }, ...(isId ? [{ _id: identifier }] : [])] }],
    }).lean();
    return item
      ? sendSuccess(response, serialize.product((await withAvailability([item]))[0]))
      : sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found', request.requestId);
  } catch (error) {
    return next(error);
  }
});
export default router;
