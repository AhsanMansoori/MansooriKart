import express from 'express';
import { z } from 'zod';
import { CONTENT_LIMITS, CONTENT_STATUSES, FAQ_STATUSES, NAV_MENUS, NAV_TARGET_TYPES, ROBOTS_DIRECTIVES } from '../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { CmsPage, Faq } from '../../models/cmsPage.js';
import { NavigationMenu } from '../../models/navigationMenu.js';
import { adminCmsPage, adminFaq, adminNavigationMenu } from '../../serializers/marketingAdmin.js';
import { ensureNavigationMenu, missingReferences, orderedNavigation, publishFields } from '../../services/cmsService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { blocksField, httpUrl, internalPath, objectIdField, optionalPlainText, plainText, slugField } from '../../utils/contentSchemas.js';
import { escapeRegex, isObjectId, slugify } from '../../utils/sanitize.js';

/**
 * Super-Admin content API: CMS pages, FAQs and the header/footer navigation.
 *
 * A page's body is a bounded list of typed blocks — HEADING, PARAGRAPH, LIST, QUOTE,
 * IMAGE, DIVIDER — and every text field is stripped of markup while it is validated.
 * There is no field on this API that accepts HTML, a script or a template, so the store's
 * policy pages cannot become an injection surface no matter what an operator pastes in
 * (§15–16). This is also why the five policy documents §35 lists are ordinary CMS pages
 * rather than five bespoke models.
 *
 * A page records the store's *current* text. Editing the returns policy does not rewrite
 * what a past customer agreed to, because each order captured its own snapshot at
 * checkout; nothing in this router touches an order.
 *
 * Navigation is one document per menu, one level of children deep, with structured
 * targets. Public serialization resolves each target and drops the entries a customer
 * must not see, so an operator may point a menu item at a draft page without leaking it.
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
const badReferences = (r: any, s: any, refs: string[]) => sendFailure(s, 400, 'REFERENCE_NOT_FOUND', `Unknown reference: ${refs.join(', ')}`, r.requestId);
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(CONTENT_LIMITS.defaultPageSize),
});
/** Escaped substring match over an allowlisted field set: no regex or operator injection. */
const searchFilter = (search: string | undefined, fields: string[]) =>
  search ? { $or: fields.map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } })) } : {};
/** Sort orders come from a fixed map, never from the caller's string. */
const sorts: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  title: { title: 1 },
  slug: { slug: 1 },
  position: { position: 1, createdAt: 1 },
};
/**
 * Page SEO. `robots` is an enum rather than a free-form string so an operator cannot
 * inject a directive list — or a newline — into a rendered meta tag (§25).
 */
const seoFields = z
  .object({
    metaTitle: optionalPlainText(CONTENT_LIMITS.maxTitleLength),
    metaDescription: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    canonicalUrl: httpUrl.optional(),
    robots: z.enum(ROBOTS_DIRECTIVES as [string, ...string[]]).optional(),
  })
  .strict();

const pageFields = z
  .object({
    title: plainText(CONTENT_LIMITS.maxTitleLength).optional(),
    slug: slugField.optional(),
    excerpt: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    blocks: blocksField.optional(),
    seo: seoFields.optional(),
    status: z.enum(CONTENT_STATUSES as [string, ...string[]]).optional(),
  })
  .strict();
const pageCreate = pageFields.superRefine((value, context) => {
  if (!value.title) context.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'title is required.' });
});
const pageQuery = pagination
  .extend({
    status: z.enum(CONTENT_STATUSES as [string, ...string[]]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['newest', 'oldest', 'title', 'slug']).default('newest'),
  })
  .strict();

router.get('/pages', validate(pageQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof pageQuery>;
    const filter: Record<string, unknown> = { ...(query.status ? { status: query.status } : {}), ...searchFilter(query.search, ['title', 'slug']) };
    const [data, total] = await Promise.all([
      CmsPage.find(filter)
        .sort(sorts[query.sort] ?? sorts.newest)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CmsPage.countDocuments(filter),
    ]);
    return sendSuccess(s, data.map(adminCmsPage), 200, meta(query.page, query.limit, total));
  } catch (e) {
    return n(e);
  }
});
const pageNotFound = (r: any, s: any) => missing(r, s, 'PAGE_NOT_FOUND', 'Page not found.');

router.post('/pages', validate(pageCreate), async (r, s, n) => {
  try {
    // The 409 below comes from the `slug` unique index, so its build is awaited first.
    await CmsPage.init();
    const slug = r.body.slug ?? slugify(r.body.title);
    if (!slug) return sendFailure(s, 400, 'PAGE_INVALID', 'A page slug could not be derived from the title. Supply `slug` explicitly.', r.requestId);
    const page = await CmsPage.create({ ...r.body, slug, ...publishFields(r.body.status, null), createdBy: r.auth!.userId, updatedBy: r.auth!.userId });
    await audit(r, 'CMS_PAGE_CREATED', 'CmsPage', String(page._id), { slug: page.slug, status: page.status });
    return sendSuccess(s, adminCmsPage(page.toObject()), 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'PAGE_SLUG_EXISTS', 'A page with that slug already exists.', r.requestId);
    return n(e);
  }
});

router.get('/pages/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return pageNotFound(r, s);
    const page = await CmsPage.findById(r.params.id).lean();
    return page ? sendSuccess(s, adminCmsPage(page)) : pageNotFound(r, s);
  } catch (e) {
    return n(e);
  }
});

/**
 * Edits a page.
 *
 * `publishFields` decides `publishedAt`: it is stamped the first time a page becomes
 * PUBLISHED and then never rewritten, so re-editing published text does not restate the
 * publication date and archiving preserves it.
 */
router.patch('/pages/:id', validate(pageFields), async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return pageNotFound(r, s);
    const page = await CmsPage.findById(r.params.id);
    if (!page) return pageNotFound(r, s);
    const patch: Record<string, unknown> = { ...r.body, ...publishFields(r.body.status, page) };
    // A patch that changes nothing writes no audit entry (§59).
    const fields = Object.keys(r.body).filter(key => JSON.stringify((page as any)[key] ?? null) !== JSON.stringify((patch as any)[key] ?? null));
    Object.assign(page, patch, { updatedBy: r.auth!.userId });
    await page.save();
    if (fields.length) await audit(r, 'CMS_PAGE_UPDATED', 'CmsPage', String(page._id), { slug: page.slug, fields });
    return sendSuccess(s, adminCmsPage(page.toObject()));
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'PAGE_SLUG_EXISTS', 'A page with that slug already exists.', r.requestId);
    return n(e);
  }
});
/** Explicit publish/archive. Idempotent: re-issuing the same status writes no audit entry. */
for (const [path, status, action] of [
  ['publish', 'PUBLISHED', 'CMS_PAGE_PUBLISHED'],
  ['archive', 'ARCHIVED', 'CMS_PAGE_ARCHIVED'],
] as const) {
  router.post(`/pages/:id/${path}`, async (r, s, n) => {
    try {
      if (!isObjectId(r.params.id)) return pageNotFound(r, s);
      const page = await CmsPage.findById(r.params.id);
      if (!page) return pageNotFound(r, s);
      if (page.status !== status) {
        Object.assign(page, publishFields(status, page), { status, updatedBy: r.auth!.userId });
        await page.save();
        await audit(r, action, 'CmsPage', String(page._id), { slug: page.slug });
      }
      return sendSuccess(s, adminCmsPage(page.toObject()));
    } catch (e) {
      return n(e);
    }
  });
}

/**
 * Soft archive. A page is never deleted: its slug may be linked from navigation, a banner
 * or an external site, and archiving it removes it from the storefront while keeping the
 * record an operator can restore.
 */
router.delete('/pages/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return pageNotFound(r, s);
    const page = await CmsPage.findById(r.params.id);
    if (!page) return pageNotFound(r, s);
    page.status = 'ARCHIVED';
    page.updatedBy = r.auth!.userId;
    await page.save();
    await audit(r, 'CMS_PAGE_ARCHIVED', 'CmsPage', String(page._id), { slug: page.slug });
    return sendSuccess(s, { id: String(page._id), archived: true });
  } catch (e) {
    return n(e);
  }
});
const faqFields = z
  .object({
    question: plainText(CONTENT_LIMITS.maxShortTextLength).optional(),
    answer: plainText(CONTENT_LIMITS.maxLongTextLength).optional(),
    category: optionalPlainText(120),
    position: z.number().int().min(0).max(10_000).optional(),
    status: z.enum(FAQ_STATUSES as [string, ...string[]]).optional(),
  })
  .strict();
const faqCreate = faqFields.superRefine((value, context) => {
  if (!value.question) context.addIssue({ code: z.ZodIssueCode.custom, path: ['question'], message: 'question is required.' });
  if (!value.answer) context.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: 'answer is required.' });
});
const faqQuery = pagination
  .extend({
    status: z.enum(FAQ_STATUSES as [string, ...string[]]).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['position', 'newest', 'oldest']).default('position'),
  })
  .strict();
const faqNotFound = (r: any, s: any) => missing(r, s, 'FAQ_NOT_FOUND', 'FAQ not found.');

router.get('/faqs', validate(faqQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof faqQuery>;
    const filter: Record<string, unknown> = {
      ...(query.status ? { status: query.status } : {}),
      // Category is an exact escaped match, so it cannot carry regex syntax either.
      ...(query.category ? { category: { $regex: new RegExp(`^${escapeRegex(query.category)}$`, 'i') } } : {}),
      ...searchFilter(query.search, ['question', 'answer', 'category']),
    };
    const [data, total] = await Promise.all([
      Faq.find(filter)
        .sort(sorts[query.sort] ?? sorts.position)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Faq.countDocuments(filter),
    ]);
    return sendSuccess(s, data.map(adminFaq), 200, meta(query.page, query.limit, total));
  } catch (e) {
    return n(e);
  }
});

router.post('/faqs', validate(faqCreate), async (r, s, n) => {
  try {
    const faq = await Faq.create({ ...r.body, createdBy: r.auth!.userId, updatedBy: r.auth!.userId });
    await audit(r, 'FAQ_CREATED', 'Faq', String(faq._id), { category: faq.category, status: faq.status });
    return sendSuccess(s, adminFaq(faq.toObject()), 201);
  } catch (e) {
    return n(e);
  }
});
/**
 * Bulk reorder. Declared before `/faqs/:id` so the literal path always wins, and applied
 * as one `bulkWrite` so the list never has two entries at the same position mid-update.
 */
router.post('/faqs/reorder', validate(z.object({ ids: z.array(objectIdField).min(1).max(CONTENT_LIMITS.maxReorderItems) }).strict()), async (r, s, n) => {
  try {
    const ids: string[] = r.body.ids;
    const found = await Faq.find({ _id: { $in: ids } })
      .select('_id')
      .lean();
    if (found.length !== new Set(ids).size) return faqNotFound(r, s);
    await Faq.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { position: index, updatedBy: r.auth!.userId } } } })));
    await audit(r, 'FAQ_REORDERED', 'Faq', 'collection', { count: ids.length });
    return sendSuccess(s, { reordered: ids.length });
  } catch (e) {
    return n(e);
  }
});

router.get('/faqs/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return faqNotFound(r, s);
    const faq = await Faq.findById(r.params.id).lean();
    return faq ? sendSuccess(s, adminFaq(faq)) : faqNotFound(r, s);
  } catch (e) {
    return n(e);
  }
});

router.patch('/faqs/:id', validate(faqFields), async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return faqNotFound(r, s);
    const faq = await Faq.findById(r.params.id);
    if (!faq) return faqNotFound(r, s);
    const fields = Object.keys(r.body).filter(key => String((faq as any)[key] ?? '') !== String((r.body as any)[key] ?? ''));
    Object.assign(faq, r.body, { updatedBy: r.auth!.userId });
    await faq.save();
    if (fields.length) await audit(r, 'FAQ_UPDATED', 'Faq', String(faq._id), { fields });
    return sendSuccess(s, adminFaq(faq.toObject()));
  } catch (e) {
    return n(e);
  }
});

/** Soft archive, for the same reason pages are archived rather than removed. */
router.delete('/faqs/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return faqNotFound(r, s);
    const faq = await Faq.findById(r.params.id);
    if (!faq) return faqNotFound(r, s);
    faq.status = 'ARCHIVED';
    faq.updatedBy = r.auth!.userId;
    await faq.save();
    await audit(r, 'FAQ_ARCHIVED', 'Faq', String(faq._id), {});
    return sendSuccess(s, { id: String(faq._id), archived: true });
  } catch (e) {
    return n(e);
  }
});
/**
 * Navigation entry.
 *
 * `type` selects which reference field applies, and `refineNavTarget` requires that field
 * to be present — a CATEGORY item with no category would render as a dead link. Depth
 * stops at one level of children: the schema for a child has no `children` key at all, so
 * an unbounded tree cannot be submitted (§37).
 */
const navTargetFields = {
  label: plainText(120),
  type: z.enum(NAV_TARGET_TYPES as [string, ...string[]]),
  path: internalPath.optional(),
  category: objectIdField.optional(),
  product: objectIdField.optional(),
  page: objectIdField.optional(),
  url: httpUrl.optional(),
  enabled: z.boolean().default(true),
  position: z.number().int().min(0).max(1_000).default(0),
};
const REQUIRED_NAV_FIELD: Record<string, string> = { INTERNAL_PATH: 'path', CATEGORY: 'category', PRODUCT: 'product', CMS_PAGE: 'page', EXTERNAL_URL: 'url' };
function refineNavTarget(value: any, context: z.RefinementCtx): void {
  const field = REQUIRED_NAV_FIELD[value.type];
  if (field && (value[field] === undefined || value[field] === null))
    context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when type is ${value.type}.` });
}
const navChild = z.object(navTargetFields).strict().superRefine(refineNavTarget);
const navItem = z
  .object({ ...navTargetFields, children: z.array(navChild).max(CONTENT_LIMITS.maxNavChildren).default([]) })
  .strict()
  .superRefine(refineNavTarget);
const navSchema = z.object({ items: z.array(navItem).max(CONTENT_LIMITS.maxNavItems) }).strict();

/** References a menu points at, gathered across both levels for one existence check. */
function navReferences(items: any[]) {
  const categories: string[] = [];
  const products: string[] = [];
  const pages: string[] = [];
  for (const item of items)
    for (const entry of [item, ...(item.children ?? [])]) {
      if (entry.category) categories.push(String(entry.category));
      if (entry.product) products.push(String(entry.product));
      if (entry.page) pages.push(String(entry.page));
    }
  return { categories, products, pages };
}

const menuName = (value: unknown): string | null => {
  const menu = String(value ?? '').toUpperCase();
  return NAV_MENUS.includes(menu) ? menu : null;
};

router.get('/navigation', async (r, s, n) => {
  try {
    const menus = await Promise.all(NAV_MENUS.map(menu => ensureNavigationMenu(menu)));
    return sendSuccess(
      s,
      menus.map(menu => adminNavigationMenu({ ...menu.toObject(), items: orderedNavigation(menu) }))
    );
  } catch (e) {
    return n(e);
  }
});
router.get('/navigation/:menu', async (r, s, n) => {
  try {
    const menu = menuName(r.params.menu);
    if (!menu) return missing(r, s, 'MENU_NOT_FOUND', 'Menu not found.');
    const record = await ensureNavigationMenu(menu);
    return sendSuccess(s, adminNavigationMenu({ ...record.toObject(), items: orderedNavigation(record) }));
  } catch (e) {
    return n(e);
  }
});

/**
 * Replaces one menu.
 *
 * Whole-document replacement for the same reason the homepage layout is replaced whole:
 * a menu is an ordered list, and patching it item by item would let two concurrent edits
 * interleave. Targets are checked for existence here; publication status is checked when
 * the menu is read publicly, so an operator may wire up navigation before publishing.
 */
router.put('/navigation/:menu', validate(navSchema), async (r, s, n) => {
  try {
    const menu = menuName(r.params.menu);
    if (!menu) return missing(r, s, 'MENU_NOT_FOUND', 'Menu not found.');
    const items: any[] = r.body.items;
    const unknown = await missingReferences(navReferences(items));
    if (unknown.length) return badReferences(r, s, unknown);
    const record = await ensureNavigationMenu(menu);
    record.items = items;
    record.updatedBy = r.auth!.userId;
    await record.save();
    await audit(r, 'NAVIGATION_UPDATED', 'NavigationMenu', String(record._id), { menu, items: items.length });
    return sendSuccess(s, adminNavigationMenu({ ...record.toObject(), items: orderedNavigation(record) }));
  } catch (e) {
    return n(e);
  }
});
export default router;
