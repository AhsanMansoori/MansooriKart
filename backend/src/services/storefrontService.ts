/**
 * The public homepage assembly: one request, a fixed number of bounded queries.
 *
 * The important property is that cost does not grow with the layout. However many
 * sections an operator configures, this module issues at most one query per *kind* of
 * data (curated products, featured products, new arrivals, best sellers, categories,
 * banners, promotions, link targets) because it first walks the section list to collect
 * what is needed and then fetches each kind once, in parallel, with a hard limit. Twenty
 * FEATURED_PRODUCTS sections therefore cost the same as one (§45).
 *
 * Every product and category is fetched through the public eligibility filter, so a
 * DRAFT supplier-import product curated into a section is absent from the response
 * rather than filtered out afterwards — there is no code path on which it could be
 * serialized (§13, §63). The response contains no supplier, cost, authorship or
 * scheduling field: sections are rendered through the storefront serializers only.
 *
 * A public read never writes. An unconfigured store falls back to the default layout
 * below instead of creating the singleton, so `GET /store/home` stays a read.
 */

import { CONTENT_LIMITS } from '../config/storefront.js';
import { Banner } from '../models/banner.js';
import { Category } from '../models/category.js';
import { HomepageConfiguration } from '../models/homepageConfiguration.js';
import { Order } from '../models/order.js';
import { Product } from '../models/product.js';
import { Promotion } from '../models/promotion.js';
import * as serialize from '../serializers/index.js';
import { publicBanner, publicPromotion } from '../serializers/storefront.js';
import { orderedSections } from './cmsService.js';
import { resolveLinkTargets, visibilityFilter } from './marketingService.js';

/** Public catalog filter, matching `routes/v1/catalog.ts`: legacy rows have no status. */
const PUBLIC_PRODUCT = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
const PUBLIC_CATEGORY = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
/** Best sellers are computed from recent orders only, so the list reflects the season. */
const BEST_SELLER_WINDOW_DAYS = 90;

/**
 * Layout used when an operator has not configured one.
 *
 * A brand-new store still needs a homepage, and inventing one here keeps that concern
 * out of the seed data and out of the route. Once a layout is saved this is never used.
 */
const DEFAULT_SECTIONS: any[] = [
  { key: 'hero', type: 'HERO', enabled: true, position: 0, settings: { placement: 'HOME_HERO', limit: 5 } },
  { key: 'categories', type: 'FEATURED_CATEGORIES', title: 'Shop by category', enabled: true, position: 10, settings: { limit: 8 } },
  { key: 'featured', type: 'FEATURED_PRODUCTS', title: 'Featured products', enabled: true, position: 20, settings: { limit: 8 } },
  { key: 'new-arrivals', type: 'NEW_ARRIVALS', title: 'New arrivals', enabled: true, position: 30, settings: { limit: 8 } },
  { key: 'promo', type: 'BANNER', enabled: true, position: 40, settings: { placement: 'HOME_PROMO', limit: 3 } },
  { key: 'best-sellers', type: 'BEST_SELLERS', title: 'Best sellers', enabled: true, position: 50, settings: { limit: 8 } },
  {
    key: 'trust',
    type: 'TRUST_FEATURES',
    enabled: true,
    position: 60,
    settings: {
      features: [
        { icon: 'COD', title: 'Cash on delivery', subtitle: 'Pay when your order arrives' },
        { icon: 'SHIPPING', title: 'Nationwide delivery', subtitle: 'Shipping across Pakistan' },
        { icon: 'RETURNS', title: 'Easy returns', subtitle: 'Straightforward returns process' },
        { icon: 'SUPPORT', title: 'Customer support', subtitle: 'We answer every question' },
      ],
    },
  },
];

const clamp = (value: unknown, fallback: number, max: number) => Math.min(typeof value === 'number' && value > 0 ? value : fallback, max);

/** Recent best-selling product ids, highest quantity first. Bounded by `$limit`. */
async function bestSellerIds(limit: number): Promise<string[]> {
  const since = new Date(Date.now() - BEST_SELLER_WINDOW_DAYS * 86_400_000);
  const rows = await Order.aggregate([
    { $match: { createdAt: { $gte: since }, orderStatus: { $ne: 'CANCELLED' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', quantity: { $sum: '$items.quantity' } } },
    { $sort: { quantity: -1 } },
    // Over-fetch, because some sellers may since have been unpublished and will be
    // dropped by the public filter when the products are loaded.
    { $limit: Math.min(limit * 3, CONTENT_LIMITS.maxSectionProducts * 3) },
  ]);
  return rows.map((row: any) => String(row._id)).filter(Boolean);
}

/**
 * Assembles the public homepage payload.
 *
 * Returns the ordered, enabled sections plus the banners and promotions the storefront
 * needs to render them. Disabled sections are dropped server-side: whether a section is
 * live is never a client decision.
 */
export async function buildHomepage(now: Date = new Date()) {
  const config = await HomepageConfiguration.findOne({ key: 'HOME' }).lean();
  const configured = orderedSections(config);
  const sections = (configured.length ? configured : DEFAULT_SECTIONS)
    .filter((section: any) => section?.enabled !== false)
    .slice(0, CONTENT_LIMITS.maxHomepageSections);

  // Pass one: collect what the layout needs, without touching the database.
  const curatedProducts = new Set<string>();
  const curatedCategories = new Set<string>();
  const promotionIds = new Set<string>();
  const placements = new Set<string>();
  let needFeatured = false;
  let needNewArrivals = false;
  let needBestSellers = false;
  let needAllCategories = false;
  let needAnyPromotion = false;
  let bestSellerLimit = 8;
  for (const section of sections) {
    const settings = section.settings ?? {};
    const limit = clamp(settings.limit, 8, CONTENT_LIMITS.maxSectionProducts);
    if (section.type === 'HERO' || section.type === 'BANNER')
      placements.add(String(settings.placement || (section.type === 'HERO' ? 'HOME_HERO' : 'HOME_PROMO')));
    if (section.type === 'FEATURED_PRODUCTS') {
      const ids = (settings.products ?? []).map(String);
      if (ids.length) ids.forEach((id: string) => curatedProducts.add(id));
      else needFeatured = true;
    }
    if (section.type === 'NEW_ARRIVALS') needNewArrivals = true;
    if (section.type === 'BEST_SELLERS') {
      needBestSellers = true;
      bestSellerLimit = Math.max(bestSellerLimit, limit);
    }
    if (section.type === 'FEATURED_CATEGORIES') {
      const ids = (settings.categories ?? []).map(String);
      if (ids.length) ids.forEach((id: string) => curatedCategories.add(id));
      else needAllCategories = true;
    }
    if (section.type === 'PROMOTION') {
      if (settings.promotion) promotionIds.add(String(settings.promotion));
      else needAnyPromotion = true;
    }
  }

  // Pass two: one bounded query per kind of data, all in parallel.
  const sellerIds = needBestSellers ? await bestSellerIds(bestSellerLimit) : [];
  const [curated, featured, newest, sellers, categoryRows, allCategories, banners, promotions] = await Promise.all([
    curatedProducts.size
      ? Product.find({ ...PUBLIC_PRODUCT, _id: { $in: [...curatedProducts] } })
          .limit(CONTENT_LIMITS.maxSectionProducts)
          .lean()
      : [],
    needFeatured
      ? Product.find({ ...PUBLIC_PRODUCT, featured: true })
          .sort({ createdAt: -1 })
          .limit(CONTENT_LIMITS.maxSectionProducts)
          .lean()
      : [],
    needNewArrivals ? Product.find(PUBLIC_PRODUCT).sort({ createdAt: -1 }).limit(CONTENT_LIMITS.maxSectionProducts).lean() : [],
    sellerIds.length
      ? Product.find({ ...PUBLIC_PRODUCT, _id: { $in: sellerIds } })
          .limit(CONTENT_LIMITS.maxSectionProducts)
          .lean()
      : [],
    curatedCategories.size
      ? Category.find({ ...PUBLIC_CATEGORY, _id: { $in: [...curatedCategories] } })
          .limit(CONTENT_LIMITS.maxSectionCategories)
          .lean()
      : [],
    needAllCategories ? Category.find(PUBLIC_CATEGORY).sort({ sortOrder: 1, name: 1 }).limit(CONTENT_LIMITS.maxSectionCategories).lean() : [],
    placements.size
      ? Banner.find({ ...visibilityFilter(now, ['ACTIVE']), placement: { $in: [...placements] } })
          .sort({ priority: -1, createdAt: -1 })
          .limit(CONTENT_LIMITS.maxPublicBanners)
          .lean()
      : [],
    promotionIds.size || needAnyPromotion
      ? Promotion.find(needAnyPromotion ? visibilityFilter(now) : { ...visibilityFilter(now), _id: { $in: [...promotionIds] } })
          .sort({ priority: -1, createdAt: -1 })
          .limit(CONTENT_LIMITS.maxPublicPromotions)
          .lean()
      : [],
  ]);
  const targets = await resolveLinkTargets([...banners, ...promotions]);

  const productIndex = new Map<string, any>([...curated, ...sellers].map((row: any) => [String(row._id), row]));
  const categoryIndex = new Map<string, any>(categoryRows.map((row: any) => [String(row._id), row]));
  const promotionIndex = new Map<string, any>(promotions.map((row: any) => [String(row._id), row]));
  const bannersFor = (placement: string, limit: number) => banners.filter((banner: any) => String(banner.placement) === placement).slice(0, limit);
  // Curated order is the operator's order, so references are mapped in the order they
  // were configured rather than in whatever order Mongo returned them.
  const pick = (ids: string[], limit: number) =>
    ids
      .map(id => productIndex.get(String(id)))
      .filter(Boolean)
      .slice(0, limit)
      .map(serialize.product);

  // Pass three: shape each section. Nothing here queries.
  const payload = sections.map((section: any) => {
    const settings = section.settings ?? {};
    const limit = clamp(settings.limit, 8, CONTENT_LIMITS.maxSectionProducts);
    const base = { key: section.key, type: section.type, title: section.title ?? null, subtitle: section.subtitle ?? null };
    if (section.type === 'HERO' || section.type === 'BANNER') {
      const placement = String(settings.placement || (section.type === 'HERO' ? 'HOME_HERO' : 'HOME_PROMO'));
      return {
        ...base,
        banners: bannersFor(placement, clamp(settings.limit, CONTENT_LIMITS.maxSectionBanners, CONTENT_LIMITS.maxSectionBanners)).map((banner: any) =>
          publicBanner(banner, targets)
        ),
      };
    }
    if (section.type === 'FEATURED_PRODUCTS') {
      const ids = (settings.products ?? []).map(String);
      return { ...base, products: ids.length ? pick(ids, limit) : featured.slice(0, limit).map(serialize.product) };
    }
    if (section.type === 'NEW_ARRIVALS') return { ...base, products: newest.slice(0, limit).map(serialize.product) };
    if (section.type === 'BEST_SELLERS') {
      const ranked = pick(sellerIds, limit);
      // A store with no recent orders shows its newest stock rather than an empty rail.
      return { ...base, products: ranked.length ? ranked : newest.slice(0, limit).map(serialize.product) };
    }
    if (section.type === 'FEATURED_CATEGORIES') {
      const ids = (settings.categories ?? []).map(String);
      const rows = ids.length ? ids.map((id: string) => categoryIndex.get(String(id))).filter(Boolean) : allCategories;
      return {
        ...base,
        categories: rows.slice(0, clamp(settings.limit, CONTENT_LIMITS.maxSectionCategories, CONTENT_LIMITS.maxSectionCategories)).map(serialize.category),
      };
    }
    if (section.type === 'PROMOTION') {
      const chosen = settings.promotion ? promotionIndex.get(String(settings.promotion)) : promotions[0];
      return { ...base, promotion: chosen ? publicPromotion(chosen, targets) : null };
    }
    if (section.type === 'TRUST_FEATURES')
      return {
        ...base,
        features: (settings.features ?? [])
          .slice(0, CONTENT_LIMITS.maxTrustFeatures)
          .map((feature: any) => ({ icon: feature.icon, title: feature.title, subtitle: feature.subtitle ?? null })),
      };
    return base;
  });

  return { sections: payload, generatedAt: now.toISOString() };
}

/** The layout an unconfigured store serves. Exported so the admin API can seed it. */
export const defaultHomepageSections = (): any[] => DEFAULT_SECTIONS.map(section => ({ ...section, settings: { ...section.settings } }));
