import { model, models, Schema, type Model } from 'mongoose';
const schema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, required: true, index: true },
    order: { type: Schema.Types.ObjectId, required: true, unique: true },
  },
  { timestamps: true, collection: 'couponredemptions' }
);
schema.index({ coupon: 1, customer: 1 });
export const CouponRedemption: any = (models.CouponRedemption as Model<any>) || model('CouponRedemption', schema);
