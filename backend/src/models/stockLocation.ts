import { Schema, model, models, type Model } from 'mongoose';

const stockLocationSchema = new Schema(
  {
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'stocklocations' }
);
stockLocationSchema.index({ warehouse: 1, code: 1 }, { unique: true });
export const StockLocation: any = (models.StockLocation as Model<any>) || model('StockLocation', stockLocationSchema);
