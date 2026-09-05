import { Schema, model, models, type Model } from 'mongoose';
import { BANNER_PLACEMENTS, BANNER_STATUSES, LINK_TYPES } from '../config/storefront.js';

/**
 * Storefront banner placed in one of a closed set of slots.
 *
 * The destination is structured rather than a free string: `linkType` selects which
 * of `linkPath` / `linkProduct` / `linkCategory` / `linkPromotion` / `linkUrl` is
 * meaningful, and the route layer validates the matching field. That is what keeps
 * `javascript:`, `data:` and `file:` URLs out of the storefront — an external link
 * must parse as `http:`/`https:` with a hostname, and an internal one must be a
 * single-slash relative path.
 *
 * The server never fetches `imageUrl`. It is validated structurally and handed to
 * the client as-is.
 */
const bannerSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    subtitle: { type: String, trim: true, maxlength: 300 },
    placement: { type: String, enum: BANNER_PLACEMENTS as string[], required: true },
    imageUrl: { type: String, required: true, trim: true, maxlength: 2048 },
    mobileImageUrl: { type: String, trim: true, maxlength: 2048 },
    altText: { type: String, trim: true, maxlength: 300 },
    ctaLabel: { type: String, trim: true, maxlength: 60 },
    linkType: { type: String, enum: LINK_TYPES as string[], default: 'NONE' },
    linkPath: { type: String, trim: true, maxlength: 2048 },
    linkProduct: { type: Schema.Types.ObjectId, ref: 'Product' },
    linkCategory: { type: Schema.Types.ObjectId, ref: 'Category' },
    linkPromotion: { type: Schema.Types.ObjectId, ref: 'Promotion' },
    linkUrl: { type: String, trim: true, maxlength: 2048 },
    /** Only used by CATEGORY_HERO placements; ignored elsewhere. */
    category: { type: Schema.Types.ObjectId, ref: 'Category' },
    status: { type: String, enum: BANNER_STATUSES as string[], default: 'DRAFT' },
    startAt: { type: Date },
    endAt: { type: Date },
    priority: { type: Number, default: 0, min: 0, max: 10_000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'banners' }
);
/**
 * The public read is always (placement, status, window) ordered by priority, and the
 * admin placement filter is served by the first index's `placement` prefix — there is
 * deliberately no separate single-field index on `placement` or `status`, because a
 * compound index already answers every query that would have used one.
 */
bannerSchema.index({ placement: 1, status: 1, priority: -1 });
bannerSchema.index({ status: 1, startAt: 1, endAt: 1 });
export const Banner: any = (models.Banner as Model<any>) || model('Banner', bannerSchema);
