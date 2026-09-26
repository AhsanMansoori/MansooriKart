import { model, models, Schema, type Model } from 'mongoose';

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    type: { type: String, enum: ['PERCENTAGE', 'FIXED'], required: true },
    value: { type: Number, required: true, min: 0 },
    minimumOrderAmount: { type: Number, default: 0, min: 0 },
    maximumDiscount: { type: Number, min: 0 },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    usageLimit: { type: Number, min: 0 },
    usageCount: { type: Number, default: 0, min: 0 },
    perCustomerLimit: { type: Number, min: 0 },
    enabled: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: 'coupons' }
);
/**
 * The admin list is filtered by lifecycle state and sorted newest-first, so one
 * compound covering `enabled` + `expiresAt` serves the status filters and a plain
 * `createdAt` index serves the default sort. `code` already has its own unique index.
 */
couponSchema.index({ enabled: 1, expiresAt: 1 });
couponSchema.index({ createdAt: -1 });
export const Coupon: any = (models.Coupon as Model<any>) || model('Coupon', couponSchema);
