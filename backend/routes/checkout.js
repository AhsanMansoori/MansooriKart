const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/product');
const Order = require('../models/order');

const router = express.Router();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/create-order', async (req, res, next) => {
  try {
    const { items, name, email, shippingAddress, paymentMethod } = req.body || {};
    if (!Array.isArray(items) || !items.length || !name?.trim() || !emailRegex.test(String(email).trim()) || !shippingAddress?.trim())
      return res
        .status(400)
        .json({ success: false, error: { code: 'CHECKOUT_VALIDATION_ERROR', message: 'Valid customer, address, and order items are required.' } });
    if (!['COD', 'ONLINE'].includes(paymentMethod))
      return res.status(400).json({ success: false, error: { code: 'PAYMENT_METHOD_INVALID', message: 'Choose Cash on Delivery or Online payment.' } });
    if (paymentMethod === 'ONLINE')
      return res.status(409).json({ success: false, error: { code: 'ONLINE_PAYMENT_UNAVAILABLE', message: 'Online payment is not available yet.' } });
    if (['cardNumber', 'cvc', 'cardName', 'expiry'].some(key => Object.prototype.hasOwnProperty.call(req.body, key)))
      return res
        .status(400)
        .json({ success: false, error: { code: 'PAYMENT_CARD_DATA_FORBIDDEN', message: 'Card details must not be sent to MansooriKart.' } });

    const requested = new Map();
    for (const item of items) {
      const id = item?.productId || item?.id;
      const quantity = Number(item?.quantity);
      if (!mongoose.Types.ObjectId.isValid(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99)
        return res.status(400).json({ success: false, error: { code: 'ORDER_ITEM_INVALID', message: 'Each item needs a valid product and quantity.' } });
      requested.set(String(id), (requested.get(String(id)) || 0) + quantity);
    }

    const productIds = [...requested.keys()];
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    if (products.length !== productIds.length)
      return res.status(400).json({ success: false, error: { code: 'PRODUCT_UNAVAILABLE', message: 'One or more products are no longer available.' } });

    // Conditional updates make stock non-negative. Track successful updates for precise compensation.
    const decremented = [];
    for (const product of products) {
      const quantity = requested.get(String(product._id));
      const updated = await Product.findOneAndUpdate({ _id: product._id, stock: { $gte: quantity } }, { $inc: { stock: -quantity } }, { new: true });
      if (!updated) {
        await Promise.all(decremented.map(entry => Product.updateOne({ _id: entry.id }, { $inc: { stock: entry.quantity } })));
        return res.status(409).json({ success: false, error: { code: 'INSUFFICIENT_STOCK', message: `${product.name} no longer has enough stock.` } });
      }
      decremented.push({ id: product._id, quantity });
    }

    const orderItems = products.map(product => ({
      productId: product._id,
      name: product.name,
      price: product.price,
      quantity: requested.get(String(product._id)),
      image: product.image,
    }));
    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const order = new Order({
      orderNumber: `MK-${Date.now()}-${crypto.randomInt(100, 1000)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      shippingAddress: shippingAddress.trim(),
      items: orderItems,
      subtotal,
      total: subtotal,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      status: 'PENDING',
    });
    order.ensureInitialStatus();
    try {
      await order.save();
    } catch (saveError) {
      await Promise.all(decremented.map(entry => Product.updateOne({ _id: entry.id }, { $inc: { stock: entry.quantity } })));
      throw saveError;
    }
    return res.status(201).json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        items: order.items,
        subtotal: order.subtotal,
        total: order.total,
        paymentMethod: order.paymentMethod,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
