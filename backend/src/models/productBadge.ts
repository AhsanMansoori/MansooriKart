import { Schema, model, models, type Model } from 'mongoose';

const productBadgeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 400 },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'productbadges' }
);

export const ProductBadge: any = (models.ProductBadge as Model<any>) || model('ProductBadge', productBadgeSchema);
