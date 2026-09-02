const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    logo: { type: String, trim: true, maxlength: 2048 },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 320 },
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model('Brand', brandSchema);
