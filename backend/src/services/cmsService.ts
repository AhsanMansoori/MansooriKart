/**
 * Content services: singleton initialisation, reference validation and navigation
 * resolution for CMS pages, FAQs, the homepage layout and the header/footer menus.
 *
 * Two rules are enforced here rather than in each route.
 *
 * **Existence is checked at write time; eligibility is checked at read time.** An
 * operator may legitimately curate a product that is still DRAFT and publish it an hour
 * later, so a write that references a real record succeeds — but the public serializers
 * resolve every reference against the publicly eligible filter, so that product does not
 * appear on the storefront until it is ACTIVE. A reference to a record that does not
 * exist at all is a 400: it can never resolve, so storing it only creates a dead link.
 *
 * **Singletons are created by upsert, not by "find then insert".** The homepage layout
 * and each navigation menu are one document keyed by a unique field, and two concurrent
 * first requests must not produce two documents (§19).
 */

import { CONTENT_LIMITS } from '../config/storefront.js';
import { Category } from '../models/category.js';
import { CmsPage } from '../models/cmsPage.js';
import { HomepageConfiguration } from '../models/homepageConfiguration.js';
import { NavigationMenu } from '../models/navigationMenu.js';
import { Product } from '../models/product.js';
import { Promotion } from '../models/promotion.js';
import type { NavTargets } from '../serializers/storefront.js';

export const HOMEPAGE_KEY = 'HOME';

/** Sorted, bounded copy of a section or navigation list. Position is authoritative. */
const ordered = <T extends { position?: number }>(items: T[], max: number): T[] =>
  [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, max);

/**
 * The homepage layout singleton, created on first access.
 *
 * The duplicate-key branch is the concurrency guarantee: if two requests race to
 * initialise the layout, the unique index on `key` rejects the loser and it re-reads the
 * winner's document instead of creating a second layout.
 */
export async function ensureHomepageConfiguration(): Promise<any> {
  await HomepageConfiguration.init();
  const existing = await HomepageConfiguration.findOne({ key: HOMEPAGE_KEY });
  if (existing) return existing;
  try {
    return await HomepageConfiguration.findOneAndUpdate(
      { key: HOMEPAGE_KEY },
      { $setOnInsert: { key: HOMEPAGE_KEY } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    return await HomepageConfiguration.findOne({ key: HOMEPAGE_KEY });
  }
}

/**
 * One navigation menu singleton (`HEADER` or `FOOTER`), created on first access.
 *
 * As above, the index that makes the menu a singleton is awaited before the first insert:
 * an unbuilt unique index would let two racing upserts both succeed.
 */
export async function ensureNavigationMenu(menu: string): Promise<any> {
  await NavigationMenu.init();
  const existing = await NavigationMenu.findOne({ menu });
  if (existing) return existing;
  try {
    return await NavigationMenu.findOneAndUpdate({ menu }, { $setOnInsert: { menu } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    return await NavigationMenu.findOne({ menu });
  }
}

/**
 * Identifiers that do not correspond to an existing record.
 *
 * Returned as a list of `field:id` strings so the caller can report exactly which
 * reference was wrong without echoing anything else about the missing record.
 */
export async function missingReferences(references: {
  products?: string[];
  categories?: string[];
  pages?: string[];
  promotions?: string[];
}): Promise<string[]> {
  const unique = (values?: string[]) => [...new Set((values ?? []).filter(Boolean).map(String))];
  const products = unique(references.products);
  const categories = unique(references.categories);
  const pages = unique(references.pages);
  const promotions = unique(references.promotions);
  const [foundProducts, foundCategories, foundPages, foundPromotions] = await Promise.all([
    products.length
      ? Product.find({ _id: { $in: products } })
          .select('_id')
          .lean()
      : [],
    categories.length
      ? Category.find({ _id: { $in: categories } })
          .select('_id')
          .lean()
      : [],
    pages.length
      ? CmsPage.find({ _id: { $in: pages } })
          .select('_id')
          .lean()
      : [],
    promotions.length
      ? Promotion.find({ _id: { $in: promotions } })
          .select('_id')
          .lean()
      : [],
  ]);
  const missing: string[] = [];
  const check = (ids: string[], rows: any[], label: string) => {
    const found = new Set(rows.map((row: any) => String(row._id)));
    for (const id of ids) if (!found.has(id)) missing.push(`${label}:${id}`);
  };
  check(products, foundProducts, 'product');
  check(categories, foundCategories, 'category');
  check(pages, foundPages, 'page');
  check(promotions, foundPromotions, 'promotion');
  return missing;
}

/**
 * Status and `publishedAt` for a CMS page transition.
 *
 * `publishedAt` is stamped the first time a page becomes PUBLISHED and then left alone:
 * re-publishing after an edit is not a new publication date, and archiving keeps the
 * original so an operator can see when the page was first live.
 */
export function publishFields(status: string | undefined, current: any): Record<string, unknown> {
  if (!status || status === current?.status) return {};
  if (status === 'PUBLISHED') return { status, publishedAt: current?.publishedAt ?? new Date() };
  return { status };
}

/** Every reference used by a set of navigation menus, in one bounded batch per model. */
export async function resolveNavTargets(menus: any[]): Promise<NavTargets> {
  const categoryIds = new Set<string>();
  const productIds = new Set<string>();
  const pageIds = new Set<string>();
  for (const menu of menus)
    for (const item of menu?.items ?? [])
      for (const entry of [item, ...(item?.children ?? [])]) {
        if (entry?.category) categoryIds.add(String(entry.category));
        if (entry?.product) productIds.add(String(entry.product));
        if (entry?.page) pageIds.add(String(entry.page));
      }
  // Each lookup carries the public eligibility filter, so an unpublished target is
  // simply absent from the map and the serializer drops the menu entry (§37).
  const [categories, products, pages] = await Promise.all([
    categoryIds.size
      ? Category.find({ _id: { $in: [...categoryIds] }, $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] })
          .select('slug name')
          .lean()
      : [],
    productIds.size
      ? Product.find({ _id: { $in: [...productIds] }, status: 'ACTIVE' })
          .select('slug name')
          .lean()
      : [],
    pageIds.size
      ? CmsPage.find({ _id: { $in: [...pageIds] }, status: 'PUBLISHED' })
          .select('slug title')
          .lean()
      : [],
  ]);
  const index = (rows: any[]) => new Map<string, any>(rows.map((row: any) => [String(row._id), row]));
  return { categories: index(categories), products: index(products), pages: index(pages) };
}

/** Navigation items in operator-defined order, with children ordered and bounded too. */
export function orderedNavigation(menu: any): any[] {
  return ordered(menu?.items ?? [], CONTENT_LIMITS.maxNavItems).map((item: any) => ({
    ...(typeof item?.toObject === 'function' ? item.toObject() : item),
    children: ordered(item?.children ?? [], CONTENT_LIMITS.maxNavChildren),
  }));
}

/** Homepage sections in operator-defined order, bounded by the central section cap. */
export const orderedSections = (config: any): any[] => ordered(config?.sections ?? [], CONTENT_LIMITS.maxHomepageSections);
