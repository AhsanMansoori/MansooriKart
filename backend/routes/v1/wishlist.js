const express = require('express');
const mongoose = require('mongoose');
const Wishlist = require('../../models/wishlist');
const Product = require('../../models/product');
const { requireAuth } = require('../../middleware/auth');
const { failure, success } = require('../../utils/apiResponse');
const { serializeProduct } = require('../../utils/serializers');

const router = express.Router();
const activeFilter = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
const serializeWishlist = wishlist => ({
  id: wishlist?._id ? String(wishlist._id) : undefined,
  products: (wishlist?.products || []).filter(Boolean).map(serializeProduct),
});

router.use(requireAuth);
router.get('/', async (req, res, next) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user.id }).populate('products');
    return success(res, serializeWishlist(wishlist));
  } catch (error) {
    return next(error);
  }
});
router.post('/:productId', async (req, res, next) => {
  try {
    const productId = String(req.params.productId);
    if (!mongoose.Types.ObjectId.isValid(productId)) return failure(res, 400, 'PRODUCT_ID_INVALID', 'A valid product is required', req.requestId);
    const product = await Product.findOne({ _id: productId, ...activeFilter });
    if (!product) return failure(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found', req.requestId);
    let wishlist = await Wishlist.findOne({ user: req.user.id });
    if (!wishlist) wishlist = new Wishlist({ user: req.user.id, products: [] });
    if (!wishlist.products.some(id => String(id) === productId)) {
      wishlist.products.push(product._id);
      await wishlist.save();
    }
    return success(res, serializeWishlist(await Wishlist.findById(wishlist._id).populate('products')), undefined, 201);
  } catch (error) {
    return next(error);
  }
});
router.delete('/:productId', async (req, res, next) => {
  try {
    const productId = String(req.params.productId);
    if (!mongoose.Types.ObjectId.isValid(productId)) return failure(res, 400, 'PRODUCT_ID_INVALID', 'A valid product is required', req.requestId);
    const wishlist = await Wishlist.findOne({ user: req.user.id });
    if (!wishlist || !wishlist.products.some(id => String(id) === productId))
      return failure(res, 404, 'WISHLIST_ITEM_NOT_FOUND', 'Wishlist item not found', req.requestId);
    wishlist.products = wishlist.products.filter(id => String(id) !== productId);
    await wishlist.save();
    return success(res, serializeWishlist(await Wishlist.findById(wishlist._id).populate('products')));
  } catch (error) {
    return next(error);
  }
});
module.exports = router;
