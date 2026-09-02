import { Schema, model, models, type Model } from 'mongoose';

const warehouseSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    address: { type: String, trim: true, maxlength: 1000 },
    contactName: { type: String, trim: true, maxlength: 120 },
    contactPhone: { type: String, trim: true, maxlength: 30 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'warehouses' }
);
warehouseSchema.index({ isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });
export const Warehouse: any = (models.Warehouse as Model<any>) || model('Warehouse', warehouseSchema);
