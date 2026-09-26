import { Schema, model, models, type Model } from 'mongoose';
import { LINK_TYPES, PROMOTION_STATUSES } from '../config/storefront.js';

/**
 * Merchandising promotion: a storefront announcement, not a discount rule.
 *
 * There is deliberately no percentage, amount, stacking rule or eligibility field
 * here. Discounts have exactly one authority in MansooriKart — the `Coupon` model
 * validated at checkout — and a promotion cannot change what a customer pays.
 * `couponCode` is a *display* reference only: it advertises a code the customer may
 * type, and checkout still resolves and validates that code against `Coupon` as it
 * always has. See `docs/MARKETING_ARCHITECTURE.md`.
 *
 * Visibility is derived at read time from `status` plus the `startAt`/`endAt`
 * window, so no scheduler is required and a client cannot request a promotion the
 * window excludes.
 */
const promotionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 120 },
    headline: { type: String, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 2000 },
    badgeText: { type: String, trim: true, maxlength: 40 },
    /** Display-only advertisement of an existing coupon code. Never a discount authority. */
    couponCode: { type: String, trim: true, uppercase: true, maxlength: 64 },
    imageUrl: { type: String, trim: true, maxlength: 2048 },
    linkType: { type: String, enum: LINK_TYPES as string[], default: 'NONE' },
    linkPath: { type: String, trim: true, maxlength: 2048 },
    linkProduct: { type: Schema.Types.ObjectId, ref: 'Product' },
    linkCategory: { type: Schema.Types.ObjectId, ref: 'Category' },
    linkUrl: { type: String, trim: true, maxlength: 2048 },
    status: { type: String, enum: PROMOTION_STATUSES as string[], default: 'DRAFT' },
    startAt: { type: Date },
    endAt: { type: Date },
    priority: { type: Number, default: 0, min: 0, max: 10_000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'promotions' }
);
/**
 * Supports the public visibility query (status + window) and the admin priority
 * listing. A single-field `status` index would be redundant: it is the prefix of the
 * first compound index below.
 */
promotionSchema.index({ status: 1, startAt: 1, endAt: 1 });
promotionSchema.index({ priority: -1, createdAt: -1 });
export const Promotion: any = (models.Promotion as Model<any>) || model('Promotion', promotionSchema);
