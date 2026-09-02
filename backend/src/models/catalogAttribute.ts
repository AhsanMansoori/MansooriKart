import { Schema, model, models, type Model } from 'mongoose';

const valueSchema = new Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 120 },
    label: { type: String, trim: true, maxlength: 120 },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  },
  { _id: true }
);

const catalogAttributeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    kind: { type: String, enum: ['TEXT', 'SELECT', 'COLOR', 'SIZE', 'STORAGE'], default: 'SELECT' },
    values: { type: [valueSchema], default: [] },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'catalogattributes' }
);

export const CatalogAttribute: any = (models.CatalogAttribute as Model<any>) || model('CatalogAttribute', catalogAttributeSchema);
