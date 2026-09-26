import { Schema, model, models, type Model } from 'mongoose';

const productTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'producttypes' }
);

export const ProductType: any = (models.ProductType as Model<any>) || model('ProductType', productTypeSchema);
