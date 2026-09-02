const express = require('express');
const mongoose = require('mongoose');
const Cart = require('../../models/cart');
const Product = require('../../models/product');
const { requireAuth } = require('../../middleware/auth');
const { failure, success } = require('../../utils/apiResponse');
const { serializeProduct } = require('../../utils/serializers');

const router = express.Router();
const activeFilter = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };

function validQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

function serializeCart(cart) {
  const items = (cart?.items || []).filter(item => item.product).map(item => ({ product: serializeProduct(item.product), quantity: item.quantity }));
  return { id: cart?._id ? String(cart._id) : undefined, items, updatedAt: cart?.updatedAt };
}

async function loadCart(userId) {
  return Cart.findOne({ user: userId }).populate('items.product');
}

router.use(requireAuth);
router.get('/', async (req, res, next) => {
  try {
    return success(res, serializeCart(await loadCart(req.user.id)));
  } catch (error) {
    return next(error);
  }
});
router.post('/items', async (req, res, next) => {
  try {
    const productId = String(req.body?.productId || '');
    const quantity = validQuantity(req.body?.quantity);
    if (!mongoose.Types.ObjectId.isValid(productId) || !quantity)
      return failure(res, 400, 'CART_ITEM_INVALID', 'A valid product and quantity are required', req.requestId);
    const product = await Product.findOne({ _id: productId, ...activeFilter });
    if (!product) return failure(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found', req.requestId);
    if (product.stock < quantity) return failure(res, 409, 'INSUFFICIENT_STOCK', 'Requested quantity is not available', req.requestId);
    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });
    const item = cart.items.find(entry => String(entry.product) === productId);
    const nextQuantity = (item?.quantity || 0) + quantity;
    if (nextQuantity > 99 || nextQuantity > product.stock) return failure(res, 409, 'INSUFFICIENT_STOCK', 'Requested quantity is not available', req.requestId);
    if (item) item.quantity = nextQuantity;
    else cart.items.push({ product: product._id, quantity });
    await cart.save();
    return success(res, serializeCart(await loadCart(req.user.id)), undefined, 201);
  } catch (error) {
    return next(error);
  }
});
router.patch('/items/:productId', async (req, res, next) => {
  try {
    const productId = String(req.params.productId || '');
    const quantity = validQuantity(req.body?.quantity);
    if (!mongoose.Types.ObjectId.isValid(productId) || !quantity)
      return failure(res, 400, 'CART_ITEM_INVALID', 'A valid product and quantity are required', req.requestId);
    const product = await Product.findOne({ _id: productId, ...activeFilter });
    if (!product) return failure(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found', req.requestId);
    if (product.stock < quantity) return failure(res, 409, 'INSUFFICIENT_STOCK', 'Requested quantity is not available', req.requestId);
    const cart = await Cart.findOne({ user: req.user.id });
    const item = cart?.items.find(entry => String(entry.product) === productId);
    if (!item) return failure(res, 404, 'CART_ITEM_NOT_FOUND', 'Cart item not found', req.requestId);
    item.quantity = quantity;
    await cart.save();
    return success(res, serializeCart(await loadCart(req.user.id)));
  } catch (error) {
    return next(error);
  }
});
router.delete('/items/:productId', async (req, res, next) => {
  try {
    const productId = String(req.params.productId || '');
    if (!mongoose.Types.ObjectId.isValid(productId)) return failure(res, 400, 'CART_ITEM_INVALID', 'A valid product is required', req.requestId);
    const cart = await Cart.findOne({ user: req.user.id });
    const count = cart?.items.length || 0;
    if (!cart || !cart.items.some(item => String(item.product) === productId))
      return failure(res, 404, 'CART_ITEM_NOT_FOUND', 'Cart item not found', req.requestId);
    cart.items = cart.items.filter(item => String(item.product) !== productId);
    if (cart.items.length === count) return failure(res, 404, 'CART_ITEM_NOT_FOUND', 'Cart item not found', req.requestId);
    await cart.save();
    return success(res, serializeCart(await loadCart(req.user.id)));
  } catch (error) {
    return next(error);
  }
});
router.delete('/', async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate({ user: req.user.id }, { $set: { items: [] } }, { new: true });
    return success(res, { cleared: true });
  } catch (error) {
    return next(error);
  }
});
router.post('/merge', async (req, res, next) => {
  try {
    const guestItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : null;
    if (!guestItems) return failure(res, 400, 'CART_MERGE_INVALID', 'Items must be an array', req.requestId);
    for (const item of guestItems) {
      if (!mongoose.Types.ObjectId.isValid(item?.productId) || !validQuantity(item.quantity))
        return failure(res, 400, 'CART_MERGE_INVALID', 'Each item needs a valid product and quantity', req.requestId);
    }
    const products = await Product.find({ _id: { $in: guestItems.map(item => item.productId) }, ...activeFilter });
    const productById = new Map(products.map(product => [String(product._id), product]));
    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });
    for (const item of guestItems) {
      const product = productById.get(String(item.productId));
      if (!product) continue;
      const existing = cart.items.find(entry => String(entry.product) === String(product._id));
      const quantity = Math.min(99, Number(item.quantity) + (existing?.quantity || 0));
      if (quantity > product.stock) continue;
      if (existing) existing.quantity = quantity;
      else cart.items.push({ product: product._id, quantity });
    }
    await cart.save();
    return success(res, serializeCart(await loadCart(req.user.id)));
  } catch (error) {
    return next(error);
  }
});
module.exports = router;
