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
export const Coupon: any = (models.Coupon as Model<any>) || model('Coupon', couponSchema);
