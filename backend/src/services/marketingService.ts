/**
 * Promotion and banner visibility, resolved server-side.
 *
 * Visibility is never a client parameter and never a stored boolean that a forgotten
 * cron job has to flip. It is derived from `status` plus the `[startAt, endAt)` window
 * every time a record is read, which means a promotion scheduled for next week is
 * invisible today and an expired one disappears the moment its end time passes,
 * without any background scheduler existing at all.
 *
 * Neither this module nor anything it calls computes a discount. Promotions are
 * merchandising; `Coupon` remains the single discount authority (§7).
 */

import { Types } from 'mongoose';
import { CONTENT_LIMITS, PUBLISHABLE_PROMOTION_STATUSES } from '../config/storefront.js';
import { Banner } from '../models/banner.js';
import { Category } from '../models/category.js';
import { Product } from '../models/product.js';
import { Promotion } from '../models/promotion.js';

/**
 * Mongo filter selecting records a customer may see right now.
 *
 * A missing or null boundary means "unbounded on that side", which is why each side is
 * an `$or` against null: in MongoDB `{ startAt: null }` matches both an explicit null
 * and an absent field, so an open-ended promotion needs no sentinel dates.
 */
export const visibilityFilter = (now: Date = new Date(), statuses: readonly string[] = PUBLISHABLE_PROMOTION_STATUSES) => ({
  status: { $in: statuses as string[] },
  $and: [{ $or: [{ startAt: null }, { startAt: { $lte: now } }] }, { $or: [{ endAt: null }, { endAt: { $gt: now } }] }],
});

/** `true` when this loaded record is inside its window and in a publishable status. */
export function isVisible(record: any, now: Date = new Date(), statuses: readonly string[] = PUBLISHABLE_PROMOTION_STATUSES): boolean {
  if (!record || !statuses.includes(String(record.status))) return false;
  if (record.startAt && new Date(record.startAt).getTime() > now.getTime()) return false;
  if (record.endAt && new Date(record.endAt).getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Status as an operator should read it, with the clock applied.
 *
 * A record an admin left as ACTIVE whose window has closed reports EXPIRED, and one
 * whose window has not opened reports SCHEDULED. DRAFT and ARCHIVED are decisions, not
 * schedules, so the clock never overrides them.
 */
export function effectiveStatus(record: any, now: Date = new Date()): string {
  const status = String(record?.status ?? 'DRAFT');
  if (status === 'DRAFT' || status === 'ARCHIVED') return status;
  if (record?.endAt && new Date(record.endAt).getTime() <= now.getTime()) return 'EXPIRED';
  if (record?.startAt && new Date(record.startAt).getTime() > now.getTime()) return 'SCHEDULED';
  return status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
}

/** Currently visible promotions, highest priority first, hard-bounded. */
export async function listVisiblePromotions(limit: number = CONTENT_LIMITS.maxPublicPromotions, now: Date = new Date()) {
  return await Promotion.find(visibilityFilter(now)).sort({ priority: -1, createdAt: -1 }).limit(Math.min(limit, CONTENT_LIMITS.maxPublicPromotions)).lean();
}

/** Currently visible banners for one placement, highest priority first, hard-bounded. */
export async function listVisibleBanners(placement: string, limit: number = CONTENT_LIMITS.maxPublicBanners, categoryId?: string, now: Date = new Date()) {
  const filter: any = { ...visibilityFilter(now, ['ACTIVE']), placement };
  if (categoryId && Types.ObjectId.isValid(categoryId)) filter.category = categoryId;
  return await Banner.find(filter).sort({ priority: -1, createdAt: -1 }).limit(Math.min(limit, CONTENT_LIMITS.maxPublicBanners)).lean();
}

/**
 * Batch-resolves the referenced targets of a set of banners and promotions.
 *
 * Returned maps carry only *publicly eligible* targets: a product that is DRAFT or
 * ARCHIVED and a category that is not ACTIVE are absent, so the serializer downgrades
 * that link to `NONE` instead of publishing a dead or unauthorised destination.
 */
export async function resolveLinkTargets(records: any[]) {
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const promotionIds = new Set<string>();
  for (const record of records) {
    if (record?.linkProduct) productIds.add(String(record.linkProduct));
    if (record?.linkCategory) categoryIds.add(String(record.linkCategory));
    if (record?.category) categoryIds.add(String(record.category));
    if (record?.linkPromotion) promotionIds.add(String(record.linkPromotion));
  }
  const [products, categories, promotions] = await Promise.all([
    productIds.size
      ? Product.find({ _id: { $in: [...productIds] }, status: 'ACTIVE' })
          .select('slug name')
          .lean()
      : [],
    categoryIds.size
      ? Category.find({ _id: { $in: [...categoryIds] }, $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] })
          .select('slug name')
          .lean()
      : [],
    promotionIds.size
      ? Promotion.find({ _id: { $in: [...promotionIds] }, status: { $in: PUBLISHABLE_PROMOTION_STATUSES as string[] } })
          .select('slug name')
          .lean()
      : [],
  ]);
  const index = (rows: any[]) => new Map<string, any>(rows.map((row: any) => [String(row._id), row]));
  return { products: index(products), categories: index(categories), promotions: index(promotions) };
}
