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
    // How this product reaches the customer. OWN_STOCK is MansooriKart-held inventory
    // and keeps the existing InventoryBalance authority untouched; DROPSHIP is shipped
    // by a supplier, so warehouse stock is never decremented for it. Defaulting to
    // OWN_STOCK preserves the behaviour of every product that existed before
    // dropshipping was introduced.
    fulfillmentType: { type: String, enum: ['OWN_STOCK', 'DROPSHIP'], default: 'OWN_STOCK', index: true },
    // Set only by the CSV catalog import so an admin can tell a supplier-sourced
    // record from a hand-created one. Never client-settable.
    sourceType: { type: String, enum: ['MANUAL', 'SUPPLIER_CSV'], default: 'MANUAL' },
    // True once an admin has set the selling price by hand or explicitly applied a
    // pricing suggestion. A later supplier cost import must never move the price of
    // such a product; see PRICING_ARCHITECTURE.md.
    sellingPriceOverridden: { type: Boolean, default: false },
    // Non-authoritative supplier-suggested retail price. Deliberately NOT `price`:
    // a supplier may inform, but never control, the MansooriKart selling price.
    supplierSuggestedRetailPrice: { type: Number, min: 0 },
    publishedAt: { type: Date },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
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
