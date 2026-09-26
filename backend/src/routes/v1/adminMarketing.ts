import express from 'express';
import { z } from 'zod';
import { BANNER_PLACEMENTS, BANNER_STATUSES, CONTENT_LIMITS, PROMOTION_STATUSES, TRUST_FEATURE_ICONS } from '../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Banner } from '../../models/banner.js';
import { Promotion } from '../../models/promotion.js';
import { adminBanner, adminHomepage, adminPromotion } from '../../serializers/marketingAdmin.js';
import { ensureHomepageConfiguration, missingReferences, orderedSections } from '../../services/cmsService.js';
import { defaultHomepageSections } from '../../services/storefrontService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import {
  httpUrl,
  internalPath,
  objectIdField,
  optionalPlainText,
  plainText,
  refineDateRange,
  refineLink,
  refineWindow,
  slugField,
} from '../../utils/contentSchemas.js';
import { escapeRegex, isObjectId, normalizeCouponCode, slugify } from '../../utils/sanitize.js';

/**
 * Super-Admin merchandising API: promotions, banners and the curated homepage layout.
 *
 * Nothing in this router can change what a customer pays. Promotions are announcements
 * and banners are images with a destination; the discount authority is `Coupon`, applied
 * once at checkout by `orderService` (§7). A promotion's `couponCode` is advertising
 * text — checkout still resolves and validates that code itself.
 *
 * Visibility is not stored as a boolean an operator can flip incorrectly. It is derived
 * from `status` plus the `[startAt, endAt)` window every time a record is read, so a
 * scheduled campaign appears and expires on its own with no cron job in the system.
 *
 * Every operator-authored string arrives through `plainText`, which strips markup during
 * validation, and every URL through `httpUrl`/`internalPath`, which reject anything that
 * is not `http:`/`https:` or a single-slash relative path. `javascript:`, `data:` and
 * `file:` URLs are 400s, and no URL is ever fetched server-side.
 */
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const audit = (r: any, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}) =>
  AuditLog.create({ actor: r.auth!.userId, action, resourceType, resourceId, requestId: r.requestId, metadata });
const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};
const missing = (r: any, s: any, code: string, message: string) => sendFailure(s, 404, code, message, r.requestId);
/** Reports which reference could not be resolved, without revealing anything about it. */
const badReferences = (r: any, s: any, refs: string[]) => sendFailure(s, 400, 'REFERENCE_NOT_FOUND', `Unknown reference: ${refs.join(', ')}`, r.requestId);
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(CONTENT_LIMITS.defaultPageSize),
});
/** Sort orders are selected from a fixed map, so no caller-supplied field reaches Mongo. */
const sorts: Record<string, Record<string, 1 | -1>> = {
  priority: { priority: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  title: { title: 1 },
};
/**
 * Promotion write fields.
 *
 * There is deliberately no discount, stacking or eligibility field: adding one would
 * make this a second pricing authority. `couponCode` is normalised with the same
 * function the coupon API uses so the advertised text matches a real code's stored form.
 */
const promotionFields = z
  .object({
    name: plainText(CONTENT_LIMITS.maxTitleLength).optional(),
    slug: slugField.optional(),
    headline: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    description: optionalPlainText(2_000),
    badgeText: optionalPlainText(40),
    couponCode: z
      .string()
      .trim()
      .max(64)
      .transform(value => normalizeCouponCode(value))
      .optional(),
    imageUrl: httpUrl.optional(),
    linkType: z.enum(['NONE', 'INTERNAL_PATH', 'PRODUCT', 'CATEGORY', 'EXTERNAL_URL']).optional(),
    linkPath: internalPath.optional(),
    linkProduct: objectIdField.optional(),
    linkCategory: objectIdField.optional(),
    linkUrl: httpUrl.optional(),
    status: z.enum(PROMOTION_STATUSES as [string, ...string[]]).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
const promotionCreate = promotionFields.superRefine((value, context) => {
  if (!value.name) context.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'name is required.' });
  refineWindow(value, context);
  refineLink(value, context);
});
const promotionQuery = pagination
  .extend({
    status: z.enum(PROMOTION_STATUSES as [string, ...string[]]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['priority', 'newest', 'oldest', 'name']).default('priority'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .superRefine(refineDateRange);
/**
 * Cross-field checks applied to the *merged* record on update, so a patch cannot build
 * an invalid combination one field at a time — for example switching `linkType` to
 * PRODUCT in one request without ever supplying a product.
 */
const REQUIRED_LINK: Record<string, string> = {
  INTERNAL_PATH: 'linkPath',
  PRODUCT: 'linkProduct',
  CATEGORY: 'linkCategory',
  PROMOTION: 'linkPromotion',
  EXTERNAL_URL: 'linkUrl',
};
function coherenceError(merged: any): string | null {
  if (merged.startAt && merged.endAt && new Date(merged.startAt).getTime() >= new Date(merged.endAt).getTime()) return '`endAt` must be after `startAt`.';
  const field = REQUIRED_LINK[String(merged.linkType ?? 'NONE')];
  if (field && (merged[field] === undefined || merged[field] === null)) return `${field} is required when linkType is ${merged.linkType}.`;
  return null;
}
const searchFilter = (search: string | undefined, fields: string[]) =>
  search ? { $or: fields.map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } })) } : {};

router.get('/promotions', validate(promotionQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof promotionQuery>;
    const now = new Date();
    const filter: Record<string, unknown> = { ...searchFilter(query.search, ['name', 'slug', 'headline']) };
    if (query.status) filter.status = query.status;
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      Promotion.find(filter)
        .sort(sorts[query.sort] ?? sorts.priority)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Promotion.countDocuments(filter),
    ]);
    return sendSuccess(
      s,
      data.map((record: any) => adminPromotion(record, now)),
      200,
      meta(query.page, query.limit, total)
    );
  } catch (e) {
    return n(e);
  }
});

router.post('/promotions', validate(promotionCreate), async (r, s, n) => {
  try {
    // The 409 below comes from the `slug` unique index, so its build is awaited first.
    await Promotion.init();
    const body = r.body as Record<string, any>;
    const slug = body.slug ?? slugify(String(body.name));
    if (!slug) return sendFailure(s, 400, 'PROMOTION_INVALID', 'A URL slug could not be derived from the name; supply `slug`.', r.requestId);
    const refs = await missingReferences({ products: body.linkProduct ? [body.linkProduct] : [], categories: body.linkCategory ? [body.linkCategory] : [] });
    if (refs.length) return badReferences(r, s, refs);
    const record = await Promotion.create({ ...body, slug, createdBy: r.auth!.userId, updatedBy: r.auth!.userId });
    await audit(r, 'PROMOTION_CREATED', 'Promotion', String(record._id), { slug, status: record.status });
    return sendSuccess(s, adminPromotion(record.toObject()), 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'PROMOTION_SLUG_EXISTS', 'A promotion with that slug already exists.', r.requestId);
    return n(e);
  }
});
router.get('/promotions/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const record = await Promotion.findById(r.params.id).lean();
    return record ? sendSuccess(s, adminPromotion(record)) : missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
  } catch (e) {
    return n(e);
  }
});

router.patch('/promotions/:id', validate(promotionFields), async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const existing = await Promotion.findById(r.params.id);
    if (!existing) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const patch = r.body as Record<string, any>;
    const error = coherenceError({ ...existing.toObject(), ...patch });
    if (error) return sendFailure(s, 400, 'PROMOTION_INVALID', error, r.requestId);
    const refs = await missingReferences({
      products: patch.linkProduct ? [patch.linkProduct] : [],
      categories: patch.linkCategory ? [patch.linkCategory] : [],
    });
    if (refs.length) return badReferences(r, s, refs);
    const changed = Object.keys(patch).filter(key => String((existing as any)[key] ?? '') !== String(patch[key] ?? ''));
    Object.assign(existing, patch, { updatedBy: r.auth!.userId });
    await existing.save();
    // A patch that changes nothing writes no audit entry: the trail records decisions (§59).
    if (changed.length) await audit(r, 'PROMOTION_UPDATED', 'Promotion', String(existing._id), { slug: existing.slug, fields: changed });
    return sendSuccess(s, adminPromotion(existing.toObject()));
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'PROMOTION_SLUG_EXISTS', 'A promotion with that slug already exists.', r.requestId);
    return n(e);
  }
});

/** Explicit lifecycle moves. Idempotent: re-issuing the same status writes no audit entry. */
for (const [path, status, action] of [
  ['activate', 'ACTIVE', 'PROMOTION_ACTIVATED'],
  ['archive', 'ARCHIVED', 'PROMOTION_ARCHIVED'],
] as const) {
  router.post(`/promotions/:id/${path}`, async (r, s, n) => {
    try {
      if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
      const record = await Promotion.findById(r.params.id);
      if (!record) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
      if (record.status !== status) {
        record.status = status;
        record.updatedBy = r.auth!.userId;
        await record.save();
        await audit(r, action, 'Promotion', String(record._id), { slug: record.slug, status });
      }
      return sendSuccess(s, adminPromotion(record.toObject()));
    } catch (e) {
      return n(e);
    }
  });
}
/**
 * Soft archive. A promotion is never deleted: banners and homepage sections may
 * reference it, and archiving is what removes it from the storefront.
 */
router.delete('/promotions/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const record = await Promotion.findById(r.params.id);
    if (!record) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    record.status = 'ARCHIVED';
    record.updatedBy = r.auth!.userId;
    await record.save();
    await audit(r, 'PROMOTION_ARCHIVED', 'Promotion', String(record._id), { slug: record.slug });
    return sendSuccess(s, { id: String(record._id), archived: true });
  } catch (e) {
    return n(e);
  }
});
/**
 * Banner write fields.
 *
 * `imageUrl` and `mobileImageUrl` are validated structurally and stored as given. The
 * server never requests them: fetching an operator-supplied URL server-side would turn
 * this endpoint into an SSRF primitive, so images are only ever loaded by the browser
 * that renders the storefront (§11).
 */
const bannerFields = z
  .object({
    title: plainText(CONTENT_LIMITS.maxTitleLength).optional(),
    subtitle: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]).optional(),
    imageUrl: httpUrl.optional(),
    mobileImageUrl: httpUrl.optional(),
    altText: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    ctaLabel: optionalPlainText(60),
    linkType: z.enum(['NONE', 'INTERNAL_PATH', 'PRODUCT', 'CATEGORY', 'PROMOTION', 'EXTERNAL_URL']).optional(),
    linkPath: internalPath.optional(),
    linkProduct: objectIdField.optional(),
    linkCategory: objectIdField.optional(),
    linkPromotion: objectIdField.optional(),
    linkUrl: httpUrl.optional(),
    category: objectIdField.optional(),
    status: z.enum(BANNER_STATUSES as [string, ...string[]]).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
const bannerCreate = bannerFields.superRefine((value, context) => {
  if (!value.title) context.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'title is required.' });
  if (!value.placement) context.addIssue({ code: z.ZodIssueCode.custom, path: ['placement'], message: 'placement is required.' });
  if (!value.imageUrl) context.addIssue({ code: z.ZodIssueCode.custom, path: ['imageUrl'], message: 'imageUrl is required.' });
  if (value.placement === 'CATEGORY_HERO' && !value.category)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'category is required for a CATEGORY_HERO banner.' });
  refineWindow(value, context);
  refineLink(value, context);
});
const bannerQuery = pagination
  .extend({
    status: z.enum(BANNER_STATUSES as [string, ...string[]]).optional(),
    placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['priority', 'newest', 'oldest', 'title']).default('priority'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .superRefine(refineDateRange);
const bannerRefs = (body: Record<string, any>) => ({
  products: body.linkProduct ? [body.linkProduct] : [],
  categories: [body.linkCategory, body.category].filter(Boolean),
  promotions: body.linkPromotion ? [body.linkPromotion] : [],
});
router.get('/banners', validate(bannerQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof bannerQuery>;
    const now = new Date();
    const filter: Record<string, unknown> = { ...searchFilter(query.search, ['title', 'subtitle']) };
    if (query.status) filter.status = query.status;
    if (query.placement) filter.placement = query.placement;
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      Banner.find(filter)
        .sort(sorts[query.sort] ?? sorts.priority)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Banner.countDocuments(filter),
    ]);
    return sendSuccess(
      s,
      data.map((record: any) => adminBanner(record, now)),
      200,
      meta(query.page, query.limit, total)
    );
  } catch (e) {
    return n(e);
  }
});

router.post('/banners', validate(bannerCreate), async (r, s, n) => {
  try {
    const refs = await missingReferences(bannerRefs(r.body));
    if (refs.length) return badReferences(r, s, refs);
    const record = await Banner.create({ ...r.body, createdBy: r.auth!.userId, updatedBy: r.auth!.userId });
    await audit(r, 'BANNER_CREATED', 'Banner', String(record._id), { placement: record.placement, status: record.status });
    return sendSuccess(s, adminBanner(record.toObject()), 201);
  } catch (e) {
    return n(e);
  }
});

router.get('/banners/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const record = await Banner.findById(r.params.id).lean();
    return record ? sendSuccess(s, adminBanner(record)) : missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
  } catch (e) {
    return n(e);
  }
});
router.patch('/banners/:id', validate(bannerFields), async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const existing = await Banner.findById(r.params.id);
    if (!existing) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const patch = r.body as Record<string, any>;
    const merged = { ...existing.toObject(), ...patch };
    const error =
      coherenceError(merged) ?? (merged.placement === 'CATEGORY_HERO' && !merged.category ? 'category is required for a CATEGORY_HERO banner.' : null);
    if (error) return sendFailure(s, 400, 'BANNER_INVALID', error, r.requestId);
    const refs = await missingReferences(bannerRefs(patch));
    if (refs.length) return badReferences(r, s, refs);
    const changed = Object.keys(patch).filter(key => String((existing as any)[key] ?? '') !== String(patch[key] ?? ''));
    Object.assign(existing, patch, { updatedBy: r.auth!.userId });
    await existing.save();
    if (changed.length) await audit(r, 'BANNER_UPDATED', 'Banner', String(existing._id), { placement: existing.placement, fields: changed });
    return sendSuccess(s, adminBanner(existing.toObject()));
  } catch (e) {
    return n(e);
  }
});

for (const [path, status, action] of [
  ['activate', 'ACTIVE', 'BANNER_ACTIVATED'],
  ['archive', 'ARCHIVED', 'BANNER_ARCHIVED'],
] as const) {
  router.post(`/banners/:id/${path}`, async (r, s, n) => {
    try {
      if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
      const record = await Banner.findById(r.params.id);
      if (!record) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
      if (record.status !== status) {
        record.status = status;
        record.updatedBy = r.auth!.userId;
        await record.save();
        await audit(r, action, 'Banner', String(record._id), { placement: record.placement, status });
      }
      return sendSuccess(s, adminBanner(record.toObject()));
    } catch (e) {
      return n(e);
    }
  });
}

router.delete('/banners/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const record = await Banner.findById(r.params.id);
    if (!record) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    record.status = 'ARCHIVED';
    record.updatedBy = r.auth!.userId;
    await record.save();
    await audit(r, 'BANNER_ARCHIVED', 'Banner', String(record._id), { placement: record.placement });
    return sendSuccess(s, { id: String(record._id), archived: true });
  } catch (e) {
    return n(e);
  }
});
/**
 * Bulk reorder. Ordering is server-side data, not a client rendering concern: the
 * storefront reads banners already sorted by `priority`, so the operator's chosen order
 * is what every customer sees.
 *
 * Positions are assigned from the array index in descending priority, so the first entry
 * ranks highest. Ids not present in the request are untouched.
 */
const reorderSchema = z.object({ ids: z.array(objectIdField).min(1).max(CONTENT_LIMITS.maxReorderItems) }).strict();
router.post('/banners/reorder', validate(reorderSchema), async (r, s, n) => {
  try {
    const ids: string[] = r.body.ids;
    const found = await Banner.find({ _id: { $in: ids } })
      .select('_id')
      .lean();
    if (found.length !== new Set(ids).size) return missing(r, s, 'BANNER_NOT_FOUND', 'One or more banners were not found.');
    await Banner.bulkWrite(
      ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { priority: ids.length - index, updatedBy: r.auth!.userId } } } }))
    );
    await audit(r, 'BANNER_REORDERED', 'Banner', 'collection', { count: ids.length });
    return sendSuccess(s, { reordered: ids.length });
  } catch (e) {
    return n(e);
  }
});
/**
 * The curated homepage layout.
 *
 * This is a discriminated union, not an object with a free-form `settings` bag: each
 * section type declares exactly which settings it accepts, and `.strict()` rejects
 * everything else. That is the structural reason MansooriKart has no page builder — there
 * is no field anywhere in this schema that can carry HTML, a script or a template, so no
 * request can put executable content on the homepage (§12).
 */
const trustFeature = z.object({ icon: z.enum(TRUST_FEATURE_ICONS as [string, ...string[]]), title: plainText(120), subtitle: optionalPlainText(200) }).strict();
const sectionCommon = {
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Section key may contain only lowercase letters, digits and hyphens.'),
  title: optionalPlainText(CONTENT_LIMITS.maxTitleLength),
  subtitle: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
  enabled: z.boolean().default(true),
  position: z.number().int().min(0).max(1_000).default(0),
};
const limitSetting = z.number().int().min(1).max(CONTENT_LIMITS.maxSectionProducts).optional();
const bannerSetting = z
  .object({
    placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]).optional(),
    limit: z.number().int().min(1).max(CONTENT_LIMITS.maxSectionBanners).optional(),
  })
  .strict()
  .default({});
const sectionSchema = z.discriminatedUnion('type', [
  z.object({ ...sectionCommon, type: z.literal('HERO'), settings: bannerSetting }).strict(),
  z.object({ ...sectionCommon, type: z.literal('BANNER'), settings: bannerSetting }).strict(),
  z
    .object({
      ...sectionCommon,
      type: z.literal('FEATURED_PRODUCTS'),
      settings: z
        .object({ limit: limitSetting, products: z.array(objectIdField).max(CONTENT_LIMITS.maxSectionProducts).optional() })
        .strict()
        .default({}),
    })
    .strict(),
  z.object({ ...sectionCommon, type: z.literal('NEW_ARRIVALS'), settings: z.object({ limit: limitSetting }).strict().default({}) }).strict(),
  z.object({ ...sectionCommon, type: z.literal('BEST_SELLERS'), settings: z.object({ limit: limitSetting }).strict().default({}) }).strict(),
  z
    .object({
      ...sectionCommon,
      type: z.literal('FEATURED_CATEGORIES'),
      settings: z
        .object({
          limit: z.number().int().min(1).max(CONTENT_LIMITS.maxSectionCategories).optional(),
          categories: z.array(objectIdField).max(CONTENT_LIMITS.maxSectionCategories).optional(),
        })
        .strict()
        .default({}),
    })
    .strict(),
  z.object({ ...sectionCommon, type: z.literal('PROMOTION'), settings: z.object({ promotion: objectIdField.optional() }).strict().default({}) }).strict(),
  z
    .object({
      ...sectionCommon,
      type: z.literal('TRUST_FEATURES'),
      settings: z.object({ features: z.array(trustFeature).min(1).max(CONTENT_LIMITS.maxTrustFeatures) }).strict(),
    })
    .strict(),
]);
const homepageSchema = z
  .object({ sections: z.array(sectionSchema).max(CONTENT_LIMITS.maxHomepageSections) })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.sections.forEach((section, index) => {
      if (seen.has(section.key))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', index, 'key'], message: `Duplicate section key "${section.key}".` });
      seen.add(section.key);
    });
  });

/** Every reference a layout curates, gathered for one existence check. */
function homepageReferences(sections: any[]) {
  const products: string[] = [];
  const categories: string[] = [];
  const promotions: string[] = [];
  for (const section of sections) {
    const settings = section.settings ?? {};
    if (Array.isArray(settings.products)) products.push(...settings.products);
    if (Array.isArray(settings.categories)) categories.push(...settings.categories);
    if (settings.promotion) promotions.push(String(settings.promotion));
  }
  return { products, categories, promotions };
}

router.get('/homepage', async (r, s, n) => {
  try {
    const config = await ensureHomepageConfiguration();
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
});

/**
 * Replaces the layout.
 *
 * A layout is a single ordered list, so it is saved as one document rather than patched
 * section by section: partial updates to an ordered collection race with each other, and
 * an operator who reorders while another edits should not be able to interleave halves of
 * two layouts. Sending an empty `sections` array restores the built-in default rather
 * than serving a blank homepage.
 */
router.put('/homepage', validate(homepageSchema), async (r, s, n) => {
  try {
    const submitted: any[] = r.body.sections;
    const sections = submitted.length ? submitted : defaultHomepageSections();
    const unknown = await missingReferences(homepageReferences(sections));
    if (unknown.length) return badReferences(r, s, unknown);
    const config = await ensureHomepageConfiguration();
    config.sections = sections;
    config.updatedBy = r.auth!.userId;
    await config.save();
    await audit(r, 'HOMEPAGE_UPDATED', 'HomepageConfiguration', String(config._id), {
      sections: sections.length,
      keys: sections.map((section: any) => section.key),
    });
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
});

/** Reorders sections by key. Positions are rewritten to match the submitted order. */
router.post(
  '/homepage/reorder',
  validate(z.object({ keys: z.array(z.string().trim().toLowerCase().min(1).max(60)).min(1).max(CONTENT_LIMITS.maxHomepageSections) }).strict()),
  async (r, s, n) => {
    try {
      const keys: string[] = r.body.keys;
      const config = await ensureHomepageConfiguration();
      const sections = orderedSections(config);
      const known = new Set(sections.map((section: any) => String(section.key)));
      const unknown = keys.filter(key => !known.has(key));
      if (unknown.length || new Set(keys).size !== keys.length) return missing(r, s, 'HOMEPAGE_SECTION_NOT_FOUND', 'One or more sections were not found.');
      // Keys the caller omitted keep their relative order and follow the ones supplied.
      const rank = new Map(keys.map((key, index) => [key, index]));
      config.sections = sections
        .slice()
        .sort((a: any, b: any) => (rank.get(String(a.key)) ?? keys.length + (a.position ?? 0)) - (rank.get(String(b.key)) ?? keys.length + (b.position ?? 0)))
        .map((section: any, index: number) => ({ ...(typeof section?.toObject === 'function' ? section.toObject() : section), position: index * 10 }));
      config.updatedBy = r.auth!.userId;
      await config.save();
      await audit(r, 'HOMEPAGE_REORDERED', 'HomepageConfiguration', String(config._id), { keys });
      return sendSuccess(s, adminHomepage(config));
    } catch (e) {
      return n(e);
    }
  }
);

/** Enable or disable one section without resubmitting the whole layout. */
router.patch('/homepage/sections/:key', validate(z.object({ enabled: z.boolean() }).strict()), async (r, s, n) => {
  try {
    const key = String(r.params.key).trim().toLowerCase();
    const config = await ensureHomepageConfiguration();
    const section = (config.sections ?? []).find((entry: any) => String(entry.key) === key);
    if (!section) return missing(r, s, 'HOMEPAGE_SECTION_NOT_FOUND', 'Section not found.');
    const changed = Boolean(section.enabled) !== r.body.enabled;
    if (changed) {
      section.enabled = r.body.enabled;
      config.updatedBy = r.auth!.userId;
      await config.save();
      await audit(r, 'HOMEPAGE_UPDATED', 'HomepageConfiguration', String(config._id), { section: key, enabled: r.body.enabled });
    }
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
});
export default router;
