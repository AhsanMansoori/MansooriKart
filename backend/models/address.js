const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, trim: true, maxlength: 50, default: 'Address' },
    fullName: { type: String, trim: true, required: true, maxlength: 120 },
    phone: { type: String, trim: true, required: true, maxlength: 30 },
    addressLine1: { type: String, trim: true, required: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, required: true, maxlength: 100 },
    stateProvince: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 30 },
    country: { type: String, trim: true, required: true, maxlength: 100 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

addressSchema.index({ user: 1, isDefault: 1 });
module.exports = mongoose.model('Address', addressSchema);
