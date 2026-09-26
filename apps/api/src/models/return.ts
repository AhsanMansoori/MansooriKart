import { model, models, Schema, type Model } from 'mongoose';

const item = new Schema({ productId: { type: Schema.Types.ObjectId, required: true }, quantity: { type: Number, required: true, min: 1 } }, { _id: false });
const schema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'V1Order', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [item], required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED'], default: 'REQUESTED', index: true },
    history: {
      type: [
        {
          from: String,
          to: String,
          reason: String,
          actor: { type: Schema.Types.ObjectId, ref: 'User' },
          requestId: String,
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    reviewedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolution: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'returns' }
);
schema.index({ order: 1, createdAt: -1 });
export const ReturnRequest: any = (models.ReturnRequest as Model<any>) || model('ReturnRequest', schema);
