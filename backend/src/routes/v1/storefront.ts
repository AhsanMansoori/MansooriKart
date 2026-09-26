import express from 'express';
import { z } from 'zod';
import { BANNER_PLACEMENTS, CONTENT_LIMITS, NAV_MENUS } from '../../config/storefront.js';
import { validate } from '../../middleware/validate.js';
import { CmsPage, Faq } from '../../models/cmsPage.js';
import { NavigationMenu } from '../../models/navigationMenu.js';
import {
  publicBanner,
  publicCmsPage,
  publicCmsPageSummary,
  publicFaq,
  publicNavigationItem,
  publicPromotion,
  publicStoreConfig,
} from '../../serializers/storefront.js';
import { orderedNavigation, resolveNavTargets } from '../../services/cmsService.js';
import { listVisibleBanners, listVisiblePromotions, resolveLinkTargets } from '../../services/marketingService.js';
import { getStoreConfiguration, isMaintenanceMode } from '../../services/storeConfigService.js';
import { buildHomepage } from '../../services/storefrontService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId, isSlug } from '../../utils/sanitize.js';

/**
 * The public storefront configuration and content API. No authentication, no writes.
 *
 * Every response here is produced by a serializer from `serializers/storefront.ts`, which
 * is an allowlist: workflow state, authorship, scheduling internals, operator contact
 * addresses, the store's tax number, invoice and email settings, supplier and cost data
 * are absent because no code path publishes them (§44).
 *
 * Eligibility is applied in the database query, not after serialization. A DRAFT product,
 * an unpublished page, an archived FAQ and a banner outside its window are never loaded,
 * so there is no request that could return them (§63).
 *
 * These routes are cache-friendly by construction — every response is derived from the
 * current state of the database with no per-customer variation and no session — but this
 * phase adds no cache layer and no Redis (§45). `GET /store/config` reads the singleton on
 * every request, which is what makes an admin settings change take effect immediately.
 */
const router = express.Router();

/**
 * Maintenance mode closes storefront *content*, not the building.
 *
 * `/store/config` is exempt on purpose: a client that receives 503 still needs to render
 * the operator's message, the store name and the support contact, all of which live in the
 * config payload. Health endpoints, Super Admin authentication and every admin route are
 * mounted outside this router and are never affected (§38).
 */
const maintenanceGuard = async (r: any, s: any, n: any) => {
  try {
    const config = await getStoreConfiguration();
    if (!isMaintenanceMode(config)) return n();
    return sendFailure(s, 503, 'STORE_MAINTENANCE', String(config?.maintenanceMessage ?? 'The store is temporarily unavailable.'), r.requestId);
  } catch (error) {
    return n(error);
  }
};

const publicList = z.object({ limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).optional() }).strict();

router.get('/store/config', async (r, s, n) => {
  try {
    return sendSuccess(s, publicStoreConfig(await getStoreConfiguration()));
  } catch (e) {
    return n(e);
  }
});
/**
 * The whole homepage in one bounded request.
 *
 * `buildHomepage` issues one query per *kind* of data the configured layout needs, so
 * twenty product rails cost the same as one, and every query carries a hard limit from
 * `CONTENT_LIMITS`. It is also a pure read: an unconfigured store falls back to the
 * default layout rather than creating the singleton on a public GET.
 */
router.get('/store/home', maintenanceGuard, async (r, s, n) => {
  try {
    return sendSuccess(s, await buildHomepage());
  } catch (e) {
    return n(e);
  }
});

/**
 * Header and footer menus with every destination resolved.
 *
 * Entries whose target is not publicly available are dropped, not disabled: a menu item
 * pointing at a DRAFT product or an unpublished page disappears rather than rendering a
 * link that would 404 or reveal that a hidden record exists (§37).
 */
router.get('/store/navigation', maintenanceGuard, async (r, s, n) => {
  try {
    const menus = await NavigationMenu.find({ menu: { $in: NAV_MENUS as string[] } })
      .limit(NAV_MENUS.length)
      .lean();
    const ordered = menus.map((menu: any) => ({ ...menu, items: orderedNavigation(menu) }));
    const targets = await resolveNavTargets(ordered);
    const payload = Object.fromEntries(
      (NAV_MENUS as string[]).map(name => {
        const menu = ordered.find((entry: any) => String(entry.menu) === name);
        const items = (menu?.items ?? [])
          .map((item: any) => {
            const resolved = publicNavigationItem(item, targets);
            if (!resolved) return null;
            const children = (item.children ?? []).map((child: any) => publicNavigationItem(child, targets)).filter(Boolean);
            return { ...resolved, children };
          })
          .filter(Boolean);
        return [name.toLowerCase(), items];
      })
    );
    return sendSuccess(s, payload);
  } catch (e) {
    return n(e);
  }
});

const faqQuery = publicList.extend({ category: z.string().trim().min(1).max(120).optional() }).strict();
router.get('/store/faqs', maintenanceGuard, validate(faqQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof faqQuery>;
    const filter: Record<string, unknown> = { status: 'ACTIVE' };
    // Exact, escaped, case-insensitive match: the value cannot carry regex syntax.
    if (query.category) filter.category = { $regex: new RegExp(`^${escapeRegex(query.category)}$`, 'i') };
    const faqs = await Faq.find(filter)
      .sort({ position: 1, createdAt: 1 })
      .limit(Math.min(query.limit ?? CONTENT_LIMITS.maxPublicFaqs, CONTENT_LIMITS.maxPublicFaqs))
      .lean();
    return sendSuccess(s, faqs.map(publicFaq));
  } catch (e) {
    return n(e);
  }
});
/** Published pages, as references. Bodies are fetched one page at a time by slug. */
router.get('/store/pages', maintenanceGuard, validate(publicList, 'query'), async (r, s, n) => {
  try {
    const limit = Math.min(Number((r.query as any).limit ?? CONTENT_LIMITS.maxPageSize), CONTENT_LIMITS.maxPageSize);
    const pages = await CmsPage.find({ status: 'PUBLISHED' }).sort({ title: 1 }).limit(limit).select('slug title excerpt publishedAt').lean();
    return sendSuccess(s, pages.map(publicCmsPageSummary));
  } catch (e) {
    return n(e);
  }
});

/**
 * One published page.
 *
 * A DRAFT or ARCHIVED page is a 404 with the same body an unknown slug produces, so the
 * response cannot be used to discover which unpublished pages exist. A malformed slug is
 * rejected before it reaches Mongo.
 */
router.get('/store/pages/:slug', maintenanceGuard, async (r, s, n) => {
  try {
    const slug = String(r.params.slug ?? '').toLowerCase();
    const notFound = () => sendFailure(s, 404, 'PAGE_NOT_FOUND', 'Page not found.', r.requestId);
    if (!isSlug(slug)) return notFound();
    const page = await CmsPage.findOne({ slug, status: 'PUBLISHED' }).lean();
    return page ? sendSuccess(s, publicCmsPage(page)) : notFound();
  } catch (e) {
    return n(e);
  }
});

/** Currently visible promotions. Scheduled and expired campaigns are simply absent. */
router.get('/store/promotions', maintenanceGuard, validate(publicList, 'query'), async (r, s, n) => {
  try {
    const promotions = await listVisiblePromotions(Number((r.query as any).limit ?? CONTENT_LIMITS.maxPublicPromotions));
    const targets = await resolveLinkTargets(promotions);
    return sendSuccess(
      s,
      promotions.map((promotion: any) => publicPromotion(promotion, targets))
    );
  } catch (e) {
    return n(e);
  }
});

/**
 * Currently visible banners for one placement.
 *
 * `placement` is an enum and `category` is validated as an identifier, so neither can
 * carry a Mongo operator. A banner that is DRAFT, archived, not yet started or already
 * finished is excluded by the query itself.
 */
const bannerQuery = z
  .object({
    placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]).default('HOME_HERO'),
    category: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPublicBanners).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.category !== undefined && !isObjectId(value.category))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'Must be a valid identifier.' });
  });
router.get('/store/banners', maintenanceGuard, validate(bannerQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof bannerQuery>;
    const banners = await listVisibleBanners(query.placement, query.limit ?? CONTENT_LIMITS.maxPublicBanners, query.category);
    const targets = await resolveLinkTargets(banners);
    return sendSuccess(
      s,
      banners.map((banner: any) => publicBanner(banner, targets))
    );
  } catch (e) {
    return n(e);
  }
});
export default router;
