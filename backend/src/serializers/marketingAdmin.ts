/**
 * Super-Admin projections for marketing, CMS, settings, coupons and the audit trail.
 *
 * These are still allowlists, but a wider one: an operator needs workflow state,
 * authorship and scheduling to do their job, so `status`, `priority`, the visibility
 * window and `createdBy`/`updatedBy` are all published here — and none of them appear
 * in the public serializers in `storefront.ts`.
 *
 * `adminStoreConfiguration` returns the configuration document as-is minus Mongo
 * bookkeeping. That is safe by construction rather than by filtering: the schema has no
 * credential field, so there is no secret in the document to withhold (§34).
 */

import { effectiveStatus } from '../services/marketingService.js';
import { redactAuditMetadata } from '../utils/redact.js';

const id = (value: any): string | undefined => (value === undefined || value === null ? undefined : String(value));

/** Coupon with its derived lifecycle state. Usage counters are read-only outputs. */
export function adminCoupon(record: any, now: Date = new Date()) {
  const expired = Boolean(record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime());
  const scheduled = Boolean(record.startsAt && new Date(record.startsAt).getTime() > now.getTime());
  const exhausted = record.usageLimit !== undefined && record.usageLimit !== null && (record.usageCount ?? 0) >= record.usageLimit;
  return {
    id: id(record._id),
    /** Preserved alongside `id`: the coupon admin contract already exposed `_id`. */
    _id: record._id,
    code: record.code,
    type: record.type,
    value: record.value,
    minimumOrderAmount: record.minimumOrderAmount ?? 0,
    maximumDiscount: record.maximumDiscount ?? null,
    startsAt: record.startsAt ?? null,
    expiresAt: record.expiresAt ?? null,
    usageLimit: record.usageLimit ?? null,
    usageCount: record.usageCount ?? 0,
    perCustomerLimit: record.perCustomerLimit ?? null,
    enabled: Boolean(record.enabled),
    /** Derived, never stored: what the coupon actually does if presented right now. */
    state: !record.enabled ? 'DISABLED' : expired ? 'EXPIRED' : scheduled ? 'SCHEDULED' : exhausted ? 'EXHAUSTED' : 'ACTIVE',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export const adminPromotion = (record: any, now: Date = new Date()) => ({
  id: id(record._id),
  name: record.name,
  slug: record.slug,
  headline: record.headline ?? null,
  description: record.description ?? null,
  badgeText: record.badgeText ?? null,
  couponCode: record.couponCode ?? null,
  imageUrl: record.imageUrl ?? null,
  linkType: record.linkType ?? 'NONE',
  linkPath: record.linkPath ?? null,
  linkProduct: id(record.linkProduct) ?? null,
  linkCategory: id(record.linkCategory) ?? null,
  linkUrl: record.linkUrl ?? null,
  status: record.status,
  effectiveStatus: effectiveStatus(record, now),
  startAt: record.startAt ?? null,
  endAt: record.endAt ?? null,
  priority: record.priority ?? 0,
  createdBy: id(record.createdBy) ?? null,
  updatedBy: id(record.updatedBy) ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const adminBanner = (record: any, now: Date = new Date()) => ({
  id: id(record._id),
  title: record.title,
  subtitle: record.subtitle ?? null,
  placement: record.placement,
  imageUrl: record.imageUrl,
  mobileImageUrl: record.mobileImageUrl ?? null,
  altText: record.altText ?? null,
  ctaLabel: record.ctaLabel ?? null,
  linkType: record.linkType ?? 'NONE',
  linkPath: record.linkPath ?? null,
  linkProduct: id(record.linkProduct) ?? null,
  linkCategory: id(record.linkCategory) ?? null,
  linkPromotion: id(record.linkPromotion) ?? null,
  linkUrl: record.linkUrl ?? null,
  category: id(record.category) ?? null,
  status: record.status,
  /** ACTIVE plus a closed window reads as EXPIRED here, matching promotion semantics. */
  effectiveStatus: effectiveStatus(record, now),
  startAt: record.startAt ?? null,
  endAt: record.endAt ?? null,
  priority: record.priority ?? 0,
  createdBy: id(record.createdBy) ?? null,
  updatedBy: id(record.updatedBy) ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const adminCmsPage = (page: any) => ({
  id: id(page._id),
  title: page.title,
  slug: page.slug,
  excerpt: page.excerpt ?? null,
  blocks: page.blocks ?? [],
  seo: page.seo ?? {},
  status: page.status,
  publishedAt: page.publishedAt ?? null,
  createdBy: id(page.createdBy) ?? null,
  updatedBy: id(page.updatedBy) ?? null,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
});

export const adminFaq = (faq: any) => ({
  id: id(faq._id),
  question: faq.question,
  answer: faq.answer,
  category: faq.category ?? 'General',
  position: faq.position ?? 0,
  status: faq.status,
  createdBy: id(faq.createdBy) ?? null,
  updatedBy: id(faq.updatedBy) ?? null,
  createdAt: faq.createdAt,
  updatedAt: faq.updatedAt,
});

/** Admin homepage layout. Section settings are returned exactly as configured. */
export const adminHomepage = (config: any) => ({
  sections: (config?.sections ?? []).map((section: any) => ({
    key: section.key,
    type: section.type,
    title: section.title ?? null,
    subtitle: section.subtitle ?? null,
    enabled: section.enabled !== false,
    position: section.position ?? 0,
    settings: section.settings ?? {},
  })),
  updatedBy: id(config?.updatedBy) ?? null,
  updatedAt: config?.updatedAt ?? null,
});

/** Admin navigation. Unresolvable targets are kept so an operator can repair them. */
export const adminNavigationMenu = (menu: any) => ({
  menu: menu?.menu,
  items: (menu?.items ?? []).map((item: any) => ({
    label: item.label,
    type: item.type,
    path: item.path ?? null,
    category: id(item.category) ?? null,
    product: id(item.product) ?? null,
    page: id(item.page) ?? null,
    url: item.url ?? null,
    enabled: item.enabled !== false,
    position: item.position ?? 0,
    children: (item.children ?? []).map((child: any) => ({
      label: child.label,
      type: child.type,
      path: child.path ?? null,
      category: id(child.category) ?? null,
      product: id(child.product) ?? null,
      page: id(child.page) ?? null,
      url: child.url ?? null,
      enabled: child.enabled !== false,
      position: child.position ?? 0,
    })),
  })),
  updatedBy: id(menu?.updatedBy) ?? null,
  updatedAt: menu?.updatedAt ?? null,
});

export const adminStoreConfiguration = (config: any) => {
  const { _id, __v, ...rest } = (config ?? {}) as Record<string, unknown>;
  return { id: id(_id), ...rest, updatedBy: id((rest as any).updatedBy) ?? null };
};

/**
 * Audit entry with redacted metadata.
 *
 * `actor` keeps whichever shape the query produced — the populated `{ id, name, email,
 * role }` object the existing trail endpoint has always returned, or a bare id when the
 * caller did not populate it. The trail is read-only; nothing in the API mutates it.
 */
export const auditEntry = (entry: any) => ({
  id: id(entry._id),
  actor:
    entry.actor && typeof entry.actor === 'object' && entry.actor._id
      ? { id: id(entry.actor._id), name: entry.actor.name, email: entry.actor.email, role: entry.actor.role }
      : (id(entry.actor) ?? null),
  action: entry.action,
  resourceType: entry.resourceType,
  resourceId: entry.resourceId ?? null,
  requestId: entry.requestId ?? null,
  metadata: redactAuditMetadata(entry.metadata),
  createdAt: entry.createdAt,
});
