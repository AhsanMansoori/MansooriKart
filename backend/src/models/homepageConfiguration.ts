import { Schema, model, models, type Model } from 'mongoose';
import { HOMEPAGE_SECTION_TYPES, TRUST_FEATURE_ICONS } from '../config/storefront.js';

/**
 * Curated homepage layout — a singleton ordered list of typed sections.
 *
 * This is not a page builder. `type` comes from a closed vocabulary, each section's
 * settings are declared fields rather than free-form data, and no section can carry
 * HTML, script or a raw template. An operator chooses which of the supported
 * sections appear, in what order, with which references; the server decides how each
 * one resolves.
 *
 * Product and category references are resolved at read time against the public
 * catalog filter, so a DRAFT supplier-import product placed in a FEATURED_PRODUCTS
 * section simply does not appear on the storefront until it is published.
 */
const trustFeatureSchema = new Schema(
  {
    icon: { type: String, enum: TRUST_FEATURE_ICONS as string[], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

/**
 * Per-section settings. Every field is optional because which ones are meaningful
 * depends on `type`; the route layer validates the correct combination with a
 * discriminated schema before a section is persisted.
 */
const sectionSettingsSchema = new Schema(
  {
    limit: { type: Number, min: 1, max: 24 },
    products: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: undefined },
    categories: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: undefined },
    promotion: { type: Schema.Types.ObjectId, ref: 'Promotion' },
    placement: { type: String, trim: true, maxlength: 40 },
    features: { type: [trustFeatureSchema], default: undefined },
  },
  { _id: false }
);

const homepageSectionSchema = new Schema(
  {
    /** Stable operator-facing handle, unique within the configuration. */
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
    type: { type: String, enum: HOMEPAGE_SECTION_TYPES as string[], required: true },
    title: { type: String, trim: true, maxlength: 200 },
    subtitle: { type: String, trim: true, maxlength: 300 },
    enabled: { type: Boolean, default: true },
    position: { type: Number, default: 0, min: 0, max: 1_000 },
    settings: { type: sectionSettingsSchema, default: () => ({}) },
  },
  { _id: false }
);

const homepageConfigurationSchema = new Schema(
  {
    /** Fixed discriminator; the unique index on it enforces the singleton. */
    key: { type: String, required: true, unique: true, default: 'HOME', enum: ['HOME'] },
    sections: { type: [homepageSectionSchema], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'homepageconfigurations', minimize: false }
);

export const HomepageConfiguration: any = (models.HomepageConfiguration as Model<any>) || model('HomepageConfiguration', homepageConfigurationSchema);
