import { model, models, Schema, type Model } from 'mongoose';
const schema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    title: { type: String, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, minlength: 3, maxlength: 2000 },
    status: { type: String, enum: ['PUBLISHED', 'HIDDEN'], default: 'PUBLISHED', index: true },
    verifiedPurchase: { type: Boolean, default: false },
    moderatedAt: Date,
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    moderationReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'reviews' }
);
schema.index({ product: 1, customer: 1 }, { unique: true });
export const Review: any = (models.Review as Model<any>) || model('Review', schema);
