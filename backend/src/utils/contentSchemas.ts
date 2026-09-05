/**
 * Reusable Zod fragments for every operator-authored content and link field.
 *
 * Two properties matter here. Text fields *transform* through `stripMarkup`, so what
 * reaches MongoDB is already plain text — validation and sanitisation are the same step
 * and cannot be forgotten by a route author. URL fields validate by scheme and reject
 * anything that is not `http:`/`https:`, so `javascript:`, `data:`, `file:` and
 * malformed values fail with a 400 rather than being stored and later rendered.
 *
 * Reference fields are 24-hex checks rather than casts, so a malformed identifier is a
 * validation error instead of a Mongo CastError with a driver stack trace.
 */

import { z } from 'zod';
import { CMS_BLOCK_TYPES, CONTENT_LIMITS, LINK_TYPES } from '../config/storefront.js';
import { isSlug, safeInternalPath, safeUrl, stripMarkup } from './sanitize.js';

/** Required plain text: markup is stripped, and a value that was *only* markup fails. */
export const plainText = (max: number, min = 1) =>
  z
    .string()
    .max(max * 2)
    .transform(stripMarkup)
    .refine(value => value.length >= min && value.length <= max, { message: `Text must be ${min}–${max} characters of plain text.` });

/** Optional plain text. An empty result becomes `undefined` rather than an empty string. */
export const optionalPlainText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(value => stripMarkup(value))
    .refine(value => value.length <= max, { message: `Text must be at most ${max} characters.` })
    .transform(value => (value.length ? value : undefined))
    .optional();

/** Absolute `http:`/`https:` URL, normalised. */
export const httpUrl = z
  .string()
  .trim()
  .max(CONTENT_LIMITS.maxUrlLength)
  .transform(value => safeUrl(value))
  .refine((value): value is string => typeof value === 'string', { message: 'URL must be an absolute http or https address.' });

/** Storefront-relative path such as `/shop`. Protocol-relative and absolute URLs fail. */
export const internalPath = z
  .string()
  .trim()
  .max(CONTENT_LIMITS.maxUrlLength)
  .transform(value => safeInternalPath(value))
  .refine((value): value is string => typeof value === 'string', { message: 'Path must be a storefront-relative path beginning with a single "/".' });

/** Lowercase URL slug. */
export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .max(CONTENT_LIMITS.maxSlugLength)
  .refine(isSlug, { message: 'Slug may contain only lowercase letters, digits and single hyphens.' });

/** 24-hex reference. Never a cast, so a malformed value is a 400 and not a CastError. */
export const objectIdField = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid identifier.');

/** Structured link fields shared by banners and promotions. */
export const linkFields = {
  linkType: z.enum(LINK_TYPES as [string, ...string[]]).optional(),
  linkPath: internalPath.optional(),
  linkProduct: objectIdField.optional(),
  linkCategory: objectIdField.optional(),
  linkPromotion: objectIdField.optional(),
  linkUrl: httpUrl.optional(),
};

/**
 * Requires the field that `linkType` selects to actually be present.
 *
 * Each link field is independently scheme-validated by its own schema, so this check is
 * about coherence rather than safety: it stops an operator from saving a PRODUCT link
 * with no product, which would render as a dead call to action.
 */
export function refineLink(value: any, context: z.RefinementCtx, existing: any = {}): void {
  const type = value.linkType ?? existing.linkType ?? 'NONE';
  const required: Record<string, string> = {
    INTERNAL_PATH: 'linkPath',
    PRODUCT: 'linkProduct',
    CATEGORY: 'linkCategory',
    PROMOTION: 'linkPromotion',
    EXTERNAL_URL: 'linkUrl',
  };
  const field = required[type];
  if (!field) return;
  const resolved = value[field] ?? existing[field];
  if (resolved === undefined || resolved === null)
    context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when linkType is ${type}.` });
}

/**
 * One CMS content block. A discriminated union rather than a free-form object, so the
 * only shapes that can be stored are the ones the storefront knows how to render.
 */
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('HEADING'), level: z.number().int().min(2).max(4).default(2), text: plainText(CONTENT_LIMITS.maxTitleLength) }).strict(),
  z.object({ type: z.literal('PARAGRAPH'), text: plainText(CONTENT_LIMITS.maxLongTextLength) }).strict(),
  z
    .object({
      type: z.literal('LIST'),
      style: z.enum(['BULLET', 'NUMBER']).default('BULLET'),
      items: z.array(plainText(500)).min(1).max(CONTENT_LIMITS.maxListItems),
    })
    .strict(),
  z.object({ type: z.literal('QUOTE'), text: plainText(1_000) }).strict(),
  z.object({ type: z.literal('IMAGE'), url: httpUrl, alt: optionalPlainText(CONTENT_LIMITS.maxShortTextLength) }).strict(),
  z.object({ type: z.literal('DIVIDER') }).strict(),
]);
/** Bounded block list. `CMS_BLOCK_TYPES` documents the same vocabulary for the schema layer. */
export const blocksField = z.array(blockSchema).max(CONTENT_LIMITS.maxBlocks);
export const supportedBlockTypes = CMS_BLOCK_TYPES;

/** Shared `from`/`to` guard: ordered, and no wider than the central day cap. */
export function refineDateRange(value: { from?: Date | undefined; to?: Date | undefined }, context: z.RefinementCtx): void {
  if (value.from && value.to && value.from.getTime() > value.to.getTime())
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: '`from` must not be after `to`.' });
  if (value.from && value.to && value.to.getTime() - value.from.getTime() > CONTENT_LIMITS.maxDateRangeDays * 86_400_000)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `Date range must not exceed ${CONTENT_LIMITS.maxDateRangeDays} days.` });
}

/** Shared visibility-window guard: `startAt` must precede `endAt` when both are given. */
export function refineWindow(value: { startAt?: Date | undefined; endAt?: Date | undefined }, context: z.RefinementCtx): void {
  if (value.startAt && value.endAt && value.startAt.getTime() >= value.endAt.getTime())
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: '`endAt` must be after `startAt`.' });
}
