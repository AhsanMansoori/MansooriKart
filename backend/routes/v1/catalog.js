const express = require('express');
const Product = require('../../models/product');
const Category = require('../../models/category');
const Brand = require('../../models/brand');
const { failure, success } = require('../../utils/apiResponse');
const { parsePagination, paginationMeta } = require('../../utils/pagination');
const { serializeProduct } = require('../../utils/serializers');

const router = express.Router();
const publicProductFilter = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
const SORTS = {
  newest: { createdAt: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: 1 },
  rating: { ratingAverage: -1, rating: -1, _id: 1 },
};

function escapedRegex(value) {
  return String(value)
    .trim()
    .slice(0, 80)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find({ status: 'ACTIVE' }).sort({ sortOrder: 1, name: 1 }).lean();
    return success(
      res,
      categories.map(category => ({ ...category, id: String(category._id) }))
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/categories/:slug', async (req, res, next) => {
  try {
    const category = await Category.findOne({ slug: String(req.params.slug).toLowerCase(), status: 'ACTIVE' }).lean();
    if (!category) return failure(res, 404, 'CATEGORY_NOT_FOUND', 'Category not found', req.requestId);
    return success(res, { ...category, id: String(category._id) });
  } catch (error) {
    return next(error);
  }
});

router.get('/brands', async (req, res, next) => {
  try {
    const brands = await Brand.find({ status: 'ACTIVE' }).sort({ name: 1 }).lean();
    return success(
      res,
      brands.map(brand => ({ ...brand, id: String(brand._id) }))
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/brands/:slug', async (req, res, next) => {
  try {
    const brand = await Brand.findOne({ slug: String(req.params.slug).toLowerCase(), status: 'ACTIVE' }).lean();
    if (!brand) return failure(res, 404, 'BRAND_NOT_FOUND', 'Brand not found', req.requestId);
    return success(res, { ...brand, id: String(brand._id) });
  } catch (error) {
    return next(error);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { ...publicProductFilter };
    const search = String(req.query.search || '').trim();
    if (search) {
      const pattern = escapedRegex(search);
      filter.$and = [{ $or: [{ name: { $regex: pattern, $options: 'i' } }, { description: { $regex: pattern, $options: 'i' } }] }];
    }
    if (req.query.category) filter.category = String(req.query.category).trim().slice(0, 120);
    if (req.query.brand) filter.brand = String(req.query.brand).trim().slice(0, 120);
    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      filter.price = {};
      if (Number.isFinite(minPrice) && minPrice >= 0) filter.price.$gte = minPrice;
      if (Number.isFinite(maxPrice) && maxPrice >= 0) filter.price.$lte = maxPrice;
      if (filter.price.$gte !== undefined && filter.price.$lte !== undefined && filter.price.$gte > filter.price.$lte)
        return failure(res, 400, 'PRICE_RANGE_INVALID', 'Minimum price cannot exceed maximum price', req.requestId);
    }
    if (req.query.featured !== undefined) filter.featured = String(req.query.featured) === 'true';
    const sort = SORTS[req.query.sort] || SORTS.newest;
    const [products, total] = await Promise.all([Product.find(filter).sort(sort).skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);
    return success(res, products.map(serializeProduct), paginationMeta({ page, limit, total }));
  } catch (error) {
    return next(error);
  }
});

router.get('/products/:identifier', async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier).trim();
    const filter = {
      ...publicProductFilter,
      $and: [{ $or: [{ slug: identifier.toLowerCase() }, { _id: identifier.match(/^[a-f\d]{24}$/i) ? identifier : null }] }],
    };
    filter.$and[0].$or = filter.$and[0].$or.filter(clause => clause._id !== null);
    const product = await Product.findOne(filter).lean();
    if (!product) return failure(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found', req.requestId);
    return success(res, serializeProduct(product));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
