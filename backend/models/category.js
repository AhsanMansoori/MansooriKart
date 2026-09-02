const mongoose = require('mongoose');

const seoSchema = new mongoose.Schema(
  { title: { type: String, trim: true, maxlength: 160 }, description: { type: String, trim: true, maxlength: 320 } },
  { _id: false }
);
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    image: { type: String, trim: true, maxlength: 2048 },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
    sortOrder: { type: Number, default: 0 },
    seo: { type: seoSchema, default: () => ({}) },
  },
  { timestamps: true }
);
categorySchema.index({ parent: 1, status: 1, sortOrder: 1 });
module.exports = mongoose.model('Category', categorySchema);
