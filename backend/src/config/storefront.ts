/**
 * Single source of truth for every marketing, CMS and store-configuration bound.
 *
 * Two rules drive this module. First, defaults here must reproduce the behaviour
 * MansooriKart already shipped: PKR pricing, an `Asia/Karachi` clock, a flat
 * PKR 250 delivery fee waived at PKR 5,000, and no tax. A fresh install that never
 * touches the settings API must check out exactly as it did before Phase H.
 * Second, every list, string and collection that an operator can grow is bounded
 * here rather than in a route handler, so the public storefront payload can never
 * become unbounded by configuration alone.
 */

/** Currency. MansooriKart prices in PKR only; there is no conversion layer. */
export const DEFAULT_CURRENCY = 'PKR';
/** Presentation of the currency on the storefront. Never affects stored amounts. */
export const CURRENCY_DISPLAYS: readonly string[] = ['SYMBOL', 'CODE', 'SYMBOL_CODE'];
export const DEFAULT_CURRENCY_DISPLAY = 'SYMBOL';
/** Store clock. Persisted timestamps stay UTC; this is a display timezone only. */
export const DEFAULT_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_LOCALE = 'en-PK';
export const SUPPORTED_LOCALES: readonly string[] = ['en-PK', 'en-US', 'ur-PK'];

/**
 * Shipping defaults. These are the constants checkout used before shipping became
 * configurable, kept here so "unconfigured" and "configured to the old values" are
 * the same code path.
 */
export const SHIPPING_DEFAULTS = {
  enabled: true,
  standardFee: 250,
  freeShippingEnabled: true,
  freeShippingThreshold: 5000,
  codEnabled: true,
  /** Optional per-city fee overrides. Bounded so a config edit cannot bloat checkout. */
  maxCityOverrides: 50,
  maxFee: 100_000,
  maxThreshold: 100_000_000,
} as const;

/**
 * Tax defaults. Disabled, which is the pre-Phase-H behaviour (`tax = 0` on every
 * order). Enabling it is an explicit, audited admin decision.
 */
export const TAX_DEFAULTS = { enabled: false, defaultRate: 0, pricesIncludeTax: false, displayTaxSeparately: true, label: 'Tax', maxRate: 100 } as const;

/** Order-number prefix and low-stock threshold surfaced through store settings. */
export const STORE_DEFAULTS = { orderPrefix: 'MK', lowStockThreshold: 5, maxLowStockThreshold: 10_000 } as const;

/** Invoice presentation defaults. Never recomputes a historical order total. */
export const INVOICE_DEFAULTS = { showLogo: true, showTaxNumber: false, footerNote: '', termsNote: '' } as const;

/**
 * Transactional-email behaviour flags.
 *
 * Behaviour only: there is no credential field anywhere in this module or in the
 * StoreConfiguration schema. SMTP hosts, passwords and provider API keys stay in
 * the deployment environment and are read by the mail adapter, never by MongoDB.
 */
export const EMAIL_DEFAULTS = {
  fromName: 'MansooriKart',
  orderConfirmationEnabled: true,
  shippingUpdateEnabled: true,
  deliveryEmailEnabled: true,
  includeInvoiceLink: true,
} as const;

/** Maintenance-mode default message. Deliberately generic and non-technical. */
export const MAINTENANCE_DEFAULT_MESSAGE = 'MansooriKart is briefly unavailable while we make improvements. Please check back shortly.';

/** Robots directives an operator may select. Free-form robots strings are rejected. */
export const ROBOTS_DIRECTIVES: readonly string[] = ['index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'];
export const DEFAULT_ROBOTS = 'index,follow';

/** Social channels MansooriKart publishes. A channel outside this set is rejected. */
export const SOCIAL_CHANNELS: readonly string[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LINKEDIN', 'X'];

/** Marketing domain vocabularies. */
export const PROMOTION_STATUSES: readonly string[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'ARCHIVED'];
/** Statuses whose records may reach the storefront at all, before the time window is applied. */
export const PUBLISHABLE_PROMOTION_STATUSES: readonly string[] = ['SCHEDULED', 'ACTIVE'];
export const BANNER_PLACEMENTS: readonly string[] = ['HOME_HERO', 'HOME_PROMO', 'CATEGORY_HERO'];
export const BANNER_STATUSES: readonly string[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
export const LINK_TYPES: readonly string[] = ['NONE', 'INTERNAL_PATH', 'PRODUCT', 'CATEGORY', 'PROMOTION', 'EXTERNAL_URL'];

/** Curated homepage section vocabulary. This is not a page builder: the set is closed. */
export const HOMEPAGE_SECTION_TYPES: readonly string[] = [
  'HERO',
  'FEATURED_PRODUCTS',
  'NEW_ARRIVALS',
  'BEST_SELLERS',
  'FEATURED_CATEGORIES',
  'PROMOTION',
  'BANNER',
  'TRUST_FEATURES',
];

/** Content vocabularies. CMS content is structured blocks, never raw HTML. */
export const CONTENT_STATUSES: readonly string[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
export const FAQ_STATUSES: readonly string[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
export const CMS_BLOCK_TYPES: readonly string[] = ['HEADING', 'PARAGRAPH', 'LIST', 'QUOTE', 'IMAGE', 'DIVIDER'];
export const NAV_MENUS: readonly string[] = ['HEADER', 'FOOTER'];
export const NAV_TARGET_TYPES: readonly string[] = ['INTERNAL_PATH', 'CATEGORY', 'PRODUCT', 'CMS_PAGE', 'EXTERNAL_URL'];
export const TRUST_FEATURE_ICONS: readonly string[] = ['SHIPPING', 'RETURNS', 'SUPPORT', 'SECURE', 'COD', 'WARRANTY'];

/**
 * Bounds applied to every operator-editable collection and to every list response.
 *
 * `maxHomepageSections`, `maxNavItems` and the per-section caps together put a hard
 * ceiling on one public home aggregation, which is why `GET /api/v1/store/home` can
 * be a single bounded read no matter how the store is configured.
 */
export const CONTENT_LIMITS = {
  maxPageSize: 100,
  defaultPageSize: 20,
  maxSlugLength: 120,
  maxTitleLength: 200,
  maxShortTextLength: 300,
  maxLongTextLength: 5_000,
  maxUrlLength: 2_048,
  maxBlocks: 120,
  maxListItems: 40,
  maxHomepageSections: 20,
  maxSectionProducts: 24,
  maxSectionCategories: 12,
  maxSectionBanners: 6,
  maxTrustFeatures: 6,
  maxNavItems: 30,
  maxNavChildren: 20,
  maxFaqBatch: 100,
  maxReorderItems: 200,
  maxPublicPromotions: 20,
  maxPublicBanners: 12,
  maxPublicFaqs: 100,
  /** Widest date range accepted by an admin filter, in days. */
  maxDateRangeDays: 366,
} as const;

/** URL schemes accepted anywhere an operator supplies a link. Everything else is rejected. */
export const ALLOWED_URL_SCHEMES: readonly string[] = ['http:', 'https:'];
