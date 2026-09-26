import { Schema, model, models, type Model } from 'mongoose';
import { CMS_BLOCK_TYPES, CONTENT_STATUSES, FAQ_STATUSES } from '../config/storefront.js';

/**
 * CMS page content is a closed set of structured blocks, never HTML.
 *
 * `text` and `items` are plain text: markup is stripped on the way in by
 * `utils/sanitize.stripMarkup`, so there is no stored `<script>`, no inline event
 * handler and nothing executable for a client to run. An IMAGE block's `url` is
 * validated by scheme and never fetched server-side.
 */
const contentBlockSchema = new Schema(
  {
    type: { type: String, enum: CMS_BLOCK_TYPES as string[], required: true },
    /** HEADING only: 2–4, mapping to h2–h4. h1 belongs to the page title. */
    level: { type: Number, min: 2, max: 4 },
    text: { type: String, trim: true, maxlength: 5000 },
    items: { type: [String], default: undefined },
    /** LIST only. */
    style: { type: String, enum: ['BULLET', 'NUMBER'] },
    /** IMAGE only. */
    url: { type: String, trim: true, maxlength: 2048 },
    alt: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const pageSeoSchema = new Schema(
  {
    metaTitle: { type: String, trim: true, maxlength: 200 },
    metaDescription: { type: String, trim: true, maxlength: 300 },
    canonicalUrl: { type: String, trim: true, maxlength: 2048 },
    robots: { type: String, trim: true, maxlength: 40 },
  },
  { _id: false }
);

/**
 * A CMS page represents the store's **current** policy or informational text.
 *
 * There is no legal versioning here by design: an order's terms are captured in that
 * order's own immutable snapshot at checkout, so editing the returns page never
 * rewrites what a past customer agreed to and never touches a historical order.
 * See `docs/CMS_ARCHITECTURE.md`.
 */
const cmsPageSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 120 },
    excerpt: { type: String, trim: true, maxlength: 300 },
    blocks: { type: [contentBlockSchema], default: [] },
    seo: { type: pageSeoSchema, default: () => ({}) },
    status: { type: String, enum: CONTENT_STATUSES as string[], default: 'DRAFT' },
    publishedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'cmspages' }
);
/** `status` is the prefix of this index, so no separate single-field index is declared. */
cmsPageSchema.index({ status: 1, publishedAt: -1 });
export const CmsPage: any = (models.CmsPage as Model<any>) || model('CmsPage', cmsPageSchema);

/** Storefront FAQ entry. Ordered by `position` within an optional category grouping. */
const faqSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 5000 },
    category: { type: String, trim: true, maxlength: 120, default: 'General' },
    position: { type: Number, default: 0, min: 0, max: 10_000 },
    status: { type: String, enum: FAQ_STATUSES as string[], default: 'DRAFT' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'faqs' }
);
/** Both public and admin reads are (status | category) ordered by position. */
faqSchema.index({ status: 1, position: 1 });
faqSchema.index({ category: 1, position: 1 });
export const Faq: any = (models.Faq as Model<any>) || model('Faq', faqSchema);
