import { z } from 'zod';
import { BANNER_PLACEMENTS, BANNER_STATUSES, CONTENT_LIMITS, PROMOTION_STATUSES, TRUST_FEATURE_ICONS } from '../../../config/storefront.js';
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
} from '../../../utils/contentSchemas.js';
import { normalizeCouponCode } from '../../../utils/sanitize.js';

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(CONTENT_LIMITS.defaultPageSize),
});

export const promotionFields = z
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

export const promotionCreate = promotionFields.superRefine((value, context) => {
  if (!value.name) context.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'name is required.' });
  refineWindow(value, context);
  refineLink(value, context);
});

export const promotionQuery = pagination
  .extend({
    status: z.enum(PROMOTION_STATUSES as [string, ...string[]]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['priority', 'newest', 'oldest', 'name']).default('priority'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .superRefine(refineDateRange);

export const bannerFields = z
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

export const bannerCreate = bannerFields.superRefine((value, context) => {
  if (!value.title) context.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'title is required.' });
  if (!value.placement) context.addIssue({ code: z.ZodIssueCode.custom, path: ['placement'], message: 'placement is required.' });
  if (!value.imageUrl) context.addIssue({ code: z.ZodIssueCode.custom, path: ['imageUrl'], message: 'imageUrl is required.' });
  if (value.placement === 'CATEGORY_HERO' && !value.category)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'category is required for a CATEGORY_HERO banner.' });
  refineWindow(value, context);
  refineLink(value, context);
});

export const bannerQuery = pagination
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

export const reorderSchema = z.object({ ids: z.array(objectIdField).min(1).max(CONTENT_LIMITS.maxReorderItems) }).strict();

export const trustFeature = z
  .object({ icon: z.enum(TRUST_FEATURE_ICONS as [string, ...string[]]), title: plainText(120), subtitle: optionalPlainText(200) })
  .strict();

export const sectionCommon = {
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

export const limitSetting = z.number().int().min(1).max(CONTENT_LIMITS.maxSectionProducts).optional();

export const bannerSetting = z
  .object({
    placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]).optional(),
    limit: z.number().int().min(1).max(CONTENT_LIMITS.maxSectionBanners).optional(),
  })
  .strict()
  .default({});

export const sectionSchema = z.discriminatedUnion('type', [
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

export const homepageSchema = z
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

export const reorderHomepageSchema = z
  .object({ keys: z.array(z.string().trim().toLowerCase().min(1).max(60)).min(1).max(CONTENT_LIMITS.maxHomepageSections) })
  .strict();

export const sectionEnabledSchema = z.object({ enabled: z.boolean() }).strict();
