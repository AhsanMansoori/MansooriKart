/**
 * Customer-facing projections for every storefront configuration and content payload.
 *
 * Each function is an explicit allowlist, never a delete list. That direction matters:
 * a field added to `StoreConfiguration`, `Banner`, `CmsPage` or `NavigationMenu` later
 * is invisible to the storefront until somebody adds it here on purpose, so the default
 * for new configuration is "internal". This is what keeps `createdBy`, `updatedBy`,
 * audit metadata, scheduling internals, admin contact addresses, the store's tax
 * registration number and every supplier or cost field out of public responses (§44).
 */

import {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCY_DISPLAY,
  DEFAULT_LOCALE,
  DEFAULT_ROBOTS,
  DEFAULT_TIMEZONE,
  MAINTENANCE_DEFAULT_MESSAGE,
} from '../config/storefront.js';
import { shippingSettings, taxSettings } from '../services/storeConfigService.js';

const id = (value: any): string | undefined => (value === undefined || value === null ? undefined : String(value));
type Targets = { products: Map<string, any>; categories: Map<string, any>; promotions: Map<string, any> };
const emptyTargets: Targets = { products: new Map(), categories: new Map(), promotions: new Map() };

/**
 * Resolves a structured destination into something a client can route to.
 *
 * A reference whose target is missing or not publicly eligible degrades to
 * `{ type: 'NONE' }` rather than emitting a dead link or leaking the fact that a
 * hidden record exists. External URLs and internal paths were already validated at
 * write time, so no scheme check is repeated here.
 */
export function publicLink(record: any, targets: Targets = emptyTargets) {
  const type = String(record?.linkType ?? 'NONE');
  if (type === 'INTERNAL_PATH') return record.linkPath ? { type, path: record.linkPath } : { type: 'NONE' };
  if (type === 'EXTERNAL_URL') return record.linkUrl ? { type, url: record.linkUrl } : { type: 'NONE' };
  if (type === 'PRODUCT') {
    const product = targets.products.get(String(record.linkProduct));
    return product ? { type, productId: id(product._id), slug: product.slug } : { type: 'NONE' };
  }
  if (type === 'CATEGORY') {
    const category = targets.categories.get(String(record.linkCategory));
    return category ? { type, categoryId: id(category._id), slug: category.slug } : { type: 'NONE' };
  }
  if (type === 'PROMOTION') {
    const promotion = targets.promotions.get(String(record.linkPromotion));
    return promotion ? { type, slug: promotion.slug } : { type: 'NONE' };
  }
  return { type: 'NONE' };
}

/** Banner as the storefront sees it. Status, priority and the window stay internal. */
export const publicBanner = (record: any, targets?: Targets) => ({
  id: id(record._id),
  title: record.title,
  subtitle: record.subtitle ?? null,
  placement: record.placement,
  imageUrl: record.imageUrl,
  mobileImageUrl: record.mobileImageUrl ?? null,
  altText: record.altText ?? record.title,
  ctaLabel: record.ctaLabel ?? null,
  link: publicLink(record, targets),
});

/**
 * Promotion as the storefront sees it.
 *
 * `endsAt` is published because a customer-visible campaign may legitimately show a
 * deadline; `startAt`, `status` and `priority` are scheduling internals and are not.
 * `couponCode` is advertised text only — redeeming it still goes through the coupon
 * authority at checkout.
 */
export const publicPromotion = (record: any, targets?: Targets) => ({
  id: id(record._id),
  name: record.name,
  slug: record.slug,
  headline: record.headline ?? null,
  description: record.description ?? null,
  badgeText: record.badgeText ?? null,
  couponCode: record.couponCode ?? null,
  imageUrl: record.imageUrl ?? null,
  endsAt: record.endAt ?? null,
  link: publicLink(record, targets),
});

/** A structured content block, passed through with no field a client could execute. */
const publicBlock = (block: any) => ({
  type: block.type,
  ...(block.level === undefined ? {} : { level: block.level }),
  ...(block.text === undefined ? {} : { text: block.text }),
  ...(block.items === undefined ? {} : { items: block.items }),
  ...(block.style === undefined ? {} : { style: block.style }),
  ...(block.url === undefined ? {} : { url: block.url }),
  ...(block.alt === undefined ? {} : { alt: block.alt }),
});

/** Published CMS page. Authorship and workflow state are omitted entirely. */
export const publicCmsPage = (page: any) => ({
  slug: page.slug,
  title: page.title,
  excerpt: page.excerpt ?? null,
  blocks: (page.blocks ?? []).map(publicBlock),
  seo: {
    metaTitle: page.seo?.metaTitle ?? page.title,
    metaDescription: page.seo?.metaDescription ?? page.excerpt ?? null,
    canonicalUrl: page.seo?.canonicalUrl ?? null,
    robots: page.seo?.robots ?? DEFAULT_ROBOTS,
  },
  publishedAt: page.publishedAt ?? null,
  updatedAt: page.updatedAt ?? null,
});

/** Page reference for listings and navigation. */
export const publicCmsPageSummary = (page: any) => ({
  slug: page.slug,
  title: page.title,
  excerpt: page.excerpt ?? null,
  publishedAt: page.publishedAt ?? null,
});

/** FAQ entry. Ordering is conveyed by array position, so `position` is not published. */
export const publicFaq = (faq: any) => ({ id: id(faq._id), question: faq.question, answer: faq.answer, category: faq.category ?? 'General' });

export type NavTargets = { categories: Map<string, any>; products: Map<string, any>; pages: Map<string, any> };

/**
 * One navigation entry, or `null` when its destination is not publicly available.
 *
 * Returning `null` is the whole point: a menu item pointing at a DRAFT product, an
 * archived category or an unpublished CMS page is dropped from the public menu rather
 * than rendered as a link that 404s or, worse, reveals that a hidden record exists.
 * The admin menu still shows the item so an operator can see and fix it.
 */
export function publicNavigationItem(item: any, targets: NavTargets): Record<string, unknown> | null {
  if (item?.enabled === false) return null;
  const type = String(item?.type ?? '');
  const base = { label: item.label, type };
  if (type === 'INTERNAL_PATH') return item.path ? { ...base, path: item.path } : null;
  if (type === 'EXTERNAL_URL') return item.url ? { ...base, url: item.url } : null;
  if (type === 'CATEGORY') {
    const category = targets.categories.get(String(item.category));
    return category ? { ...base, categoryId: id(category._id), slug: category.slug } : null;
  }
  if (type === 'PRODUCT') {
    const product = targets.products.get(String(item.product));
    return product ? { ...base, productId: id(product._id), slug: product.slug } : null;
  }
  if (type === 'CMS_PAGE') {
    const page = targets.pages.get(String(item.page));
    return page ? { ...base, slug: page.slug } : null;
  }
  return null;
}

/**
 * Store configuration as the storefront sees it.
 *
 * Withheld deliberately: `businessEmail` and `businessPhone` (internal operator
 * contacts rather than customer support channels), `tax.taxNumber` and
 * `invoice.*` (invoice presentation belongs to the rendered invoice, not to a public
 * config feed), `email.*` (transactional-email behaviour is internal), `lowStockThreshold`
 * and `orderPrefix` (operational), and `updatedBy`/timestamps (audit surface).
 *
 * The shipping block is published because a storefront must be able to state its
 * delivery fee and free-shipping threshold before checkout — these are the same numbers
 * the server will charge, not a client-side calculation the server later trusts.
 */
export function publicStoreConfig(config: any) {
  const shipping = shippingSettings(config);
  const tax = taxSettings(config);
  return {
    storeName: config?.storeName ?? 'MansooriKart',
    legalName: config?.legalName ?? null,
    tagline: config?.tagline ?? null,
    logoUrl: config?.logoUrl ?? null,
    faviconUrl: config?.faviconUrl ?? null,
    currency: { code: config?.defaultCurrency ?? DEFAULT_CURRENCY, display: config?.currencyDisplay ?? DEFAULT_CURRENCY_DISPLAY },
    timezone: config?.timezone ?? DEFAULT_TIMEZONE,
    locale: config?.defaultLocale ?? DEFAULT_LOCALE,
    contact: {
      supportEmail: config?.contact?.supportEmail ?? null,
      supportPhone: config?.contact?.supportPhone ?? null,
      whatsapp: config?.contact?.whatsapp ?? null,
      supportHours: config?.contact?.supportHours ?? null,
      addressLine1: config?.contact?.addressLine1 ?? null,
      addressLine2: config?.contact?.addressLine2 ?? null,
      city: config?.contact?.city ?? null,
      stateProvince: config?.contact?.stateProvince ?? null,
      postalCode: config?.contact?.postalCode ?? null,
      country: config?.contact?.country ?? null,
    },
    socialLinks: (config?.socialLinks ?? [])
      .filter((link: any) => link?.enabled !== false && link?.url)
      .map((link: any) => ({ channel: link.channel, url: link.url })),
    seo: {
      metaTitle: config?.seo?.metaTitle ?? null,
      metaDescription: config?.seo?.metaDescription ?? null,
      metaKeywords: config?.seo?.metaKeywords ?? [],
      canonicalUrl: config?.seo?.canonicalUrl ?? null,
      robots: config?.seo?.robots ?? DEFAULT_ROBOTS,
      socialImageUrl: config?.seo?.socialImageUrl ?? null,
      openGraph: {
        title: config?.seo?.openGraphTitle ?? config?.seo?.metaTitle ?? null,
        description: config?.seo?.openGraphDescription ?? config?.seo?.metaDescription ?? null,
        image: config?.seo?.socialImageUrl ?? null,
      },
      twitterHandle: config?.seo?.twitterHandle ?? null,
    },
    shipping: {
      enabled: shipping.enabled,
      standardFee: shipping.standardFee,
      freeShippingEnabled: shipping.freeShippingEnabled,
      freeShippingThreshold: shipping.freeShippingThreshold,
      codEnabled: shipping.codEnabled,
      deliveryEstimate: config?.shipping?.deliveryEstimate ?? null,
    },
    tax: { enabled: tax.enabled, label: tax.label, displayTaxSeparately: tax.displayTaxSeparately, pricesIncludeTax: tax.pricesIncludeTax },
    maintenance: { enabled: Boolean(config?.maintenanceMode), message: config?.maintenanceMessage ?? MAINTENANCE_DEFAULT_MESSAGE },
  };
}
