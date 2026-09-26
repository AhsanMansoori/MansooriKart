import { Schema, model, models, type Model } from 'mongoose';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    image: { type: String, trim: true, maxlength: 2048 },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'categories' }
);
export const Category: any = (models.Category as Model<any>) || model('Category', categorySchema);
