import { Schema, model, models, type Model } from 'mongoose';
import { NAV_MENUS, NAV_TARGET_TYPES } from '../config/storefront.js';

/**
 * Header and footer navigation, one singleton document per menu.
 *
 * Depth is capped at one level of children rather than modelled as an unlimited
 * recursive tree: a storefront menu that nests deeper than that is a design problem,
 * and an unbounded tree makes the public serialization unbounded too.
 *
 * A target is structured — `type` selects which reference field applies — so public
 * serialization can resolve each entry and *drop* the ones a customer must not see:
 * a menu item pointing at a DRAFT product or an unpublished CMS page disappears from
 * the public menu instead of rendering a dead link. External URLs must be
 * `http:`/`https:`; internal paths must be single-slash relative.
 */
const navigationItemSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: NAV_TARGET_TYPES as string[], required: true },
    path: { type: String, trim: true, maxlength: 2048 },
    category: { type: Schema.Types.ObjectId, ref: 'Category' },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    page: { type: Schema.Types.ObjectId, ref: 'CmsPage' },
    url: { type: String, trim: true, maxlength: 2048 },
    enabled: { type: Boolean, default: true },
    position: { type: Number, default: 0, min: 0, max: 1_000 },
  },
  { _id: false }
);

const navigationGroupSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: NAV_TARGET_TYPES as string[], required: true },
    path: { type: String, trim: true, maxlength: 2048 },
    category: { type: Schema.Types.ObjectId, ref: 'Category' },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    page: { type: Schema.Types.ObjectId, ref: 'CmsPage' },
    url: { type: String, trim: true, maxlength: 2048 },
    enabled: { type: Boolean, default: true },
    position: { type: Number, default: 0, min: 0, max: 1_000 },
    /** One level only. Children may not carry children. */
    children: { type: [navigationItemSchema], default: [] },
  },
  { _id: false }
);

const navigationMenuSchema = new Schema(
  {
    menu: { type: String, enum: NAV_MENUS as string[], required: true, unique: true },
    items: { type: [navigationGroupSchema], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'navigationmenus', minimize: false }
);

export const NavigationMenu: any = (models.NavigationMenu as Model<any>) || model('NavigationMenu', navigationMenuSchema);
