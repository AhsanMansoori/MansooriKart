const express = require('express');
const catalogRoutes = require('./catalog');
const meRoutes = require('./me');
const cartRoutes = require('./cart');
const wishlistRoutes = require('./wishlist');

const router = express.Router();

router.use(catalogRoutes);
router.use('/me', meRoutes);
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);

module.exports = router;
