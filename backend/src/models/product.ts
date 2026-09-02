import { Schema, model, models, type Model } from 'mongoose';

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    alt: { type: String, maxlength: 240 },
    position: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true, unique: true, sparse: true, index: true },
    sku: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },
    description: { type: String, required: true },
    shortDescription: { type: String, trim: true, maxlength: 500 },
    category: { type: String, required: true },
    brand: { type: String },
    image: { type: String, required: true },
    images: { type: [imageSchema], default: undefined },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    costPrice: { type: Number, min: 0 },
    currency: { type: String, default: 'PKR', uppercase: true },
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
    featured: { type: Boolean, default: false, index: true },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    numReviews: { type: Number, default: 0, min: 0 },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    tags: { type: [String], default: [] },
    productType: { type: Schema.Types.ObjectId, ref: 'ProductType', default: null },
    badges: { type: [{ type: Schema.Types.ObjectId, ref: 'ProductBadge' }], default: [] },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 320 },
    },
  },
  { timestamps: true, collection: 'products' }
);
export const Product: any = (models.Product as Model<any>) || model('Product', productSchema);
