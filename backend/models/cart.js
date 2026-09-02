const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: {
      type: [
        {
          product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
          quantity: { type: Number, required: true, min: 1, max: 99 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model('Cart', cartSchema);
