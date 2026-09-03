import { model, models, Schema, type Model } from 'mongoose';

const schema = new Schema(
  {
    refundNumber: { type: String, required: true, unique: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'V1Order', required: true, index: true },
    returnRequest: { type: Schema.Types.ObjectId, ref: 'ReturnRequest', default: null },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'COMPLETED', 'FAILED'], default: 'PENDING', index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    paymentMethod: { type: String, required: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true, collection: 'refunds' }
);
schema.index({ order: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ order: 1, createdAt: -1 });
// Finance windows refunds on `createdAt` and filters `status: { $ne: 'FAILED' }`,
// which no index can select on, so the date bound is what needs the index.
schema.index({ createdAt: -1 });
export const Refund: any = (models.Refund as Model<any>) || model('Refund', schema);
