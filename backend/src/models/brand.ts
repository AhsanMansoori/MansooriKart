import { Schema, model, models, type Model } from 'mongoose';

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    logo: { type: String, trim: true, maxlength: 2048 },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'brands' }
);
export const Brand: any = (models.Brand as Model<any>) || model('Brand', brandSchema);
