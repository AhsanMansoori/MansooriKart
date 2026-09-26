import { model, models, Schema, type Model } from 'mongoose';
const schema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, required: true },
    orderedQuantity: { type: Number, required: true },
    requestedQuantity: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'returnallocations' }
);
schema.index({ order: 1, product: 1 }, { unique: true });
export const ReturnAllocation: any = (models.ReturnAllocation as Model<any>) || model('ReturnAllocation', schema);
