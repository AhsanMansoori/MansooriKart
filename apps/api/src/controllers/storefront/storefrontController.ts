import { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { CONTENT_LIMITS, NAV_MENUS } from '../../config/storefront.js';
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
import { escapeRegex, isSlug } from '../../utils/sanitize.js';

export const maintenanceGuard = async (r: any, s: Response, n: NextFunction) => {
  try {
    const config = await getStoreConfiguration();
    if (!isMaintenanceMode(config)) return n();
    return sendFailure(s, 503, 'STORE_MAINTENANCE', String(config?.maintenanceMessage ?? 'The store is temporarily unavailable.'), r.requestId);
  } catch (error) {
    return n(error);
  }
};

export async function getStoreConfig(r: any, s: Response, n: NextFunction) {
  try {
    return sendSuccess(s, publicStoreConfig(await getStoreConfiguration()));
  } catch (e) {
    return n(e);
  }
}

export async function getStoreHome(r: any, s: Response, n: NextFunction) {
  try {
    return sendSuccess(s, await buildHomepage());
  } catch (e) {
    return n(e);
  }
}

export async function getStoreNavigation(r: any, s: Response, n: NextFunction) {
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
}

export async function getStoreFaqs(r: any, s: Response, n: NextFunction) {
  try {
    const query = r.query;
    const filter: Record<string, unknown> = { status: 'ACTIVE' };
    if (query.category) filter.category = { $regex: new RegExp(`^${escapeRegex(query.category)}$`, 'i') };
    const faqs = await Faq.find(filter)
      .sort({ position: 1, createdAt: 1 })
      .limit(Math.min(query.limit ?? CONTENT_LIMITS.maxPublicFaqs, CONTENT_LIMITS.maxPublicFaqs))
      .lean();
    return sendSuccess(s, faqs.map(publicFaq));
  } catch (e) {
    return n(e);
  }
}

export async function getStorePages(r: any, s: Response, n: NextFunction) {
  try {
    const limit = Math.min(Number(r.query?.limit ?? CONTENT_LIMITS.maxPageSize), CONTENT_LIMITS.maxPageSize);
    const pages = await CmsPage.find({ status: 'PUBLISHED' }).sort({ title: 1 }).limit(limit).select('slug title excerpt publishedAt').lean();
    return sendSuccess(s, pages.map(publicCmsPageSummary));
  } catch (e) {
    return n(e);
  }
}

export async function getStorePageBySlug(r: any, s: Response, n: NextFunction) {
  try {
    const slug = String(r.params.slug ?? '').toLowerCase();
    const notFound = () => sendFailure(s, 404, 'PAGE_NOT_FOUND', 'Page not found.', r.requestId);
    if (!isSlug(slug)) return notFound();
    const page = await CmsPage.findOne({ slug, status: 'PUBLISHED' }).lean();
    return page ? sendSuccess(s, publicCmsPage(page)) : notFound();
  } catch (e) {
    return n(e);
  }
}

export async function getStorePromotions(r: any, s: Response, n: NextFunction) {
  try {
    const promotions = await listVisiblePromotions(Number(r.query?.limit ?? CONTENT_LIMITS.maxPublicPromotions));
    const targets = await resolveLinkTargets(promotions);
    return sendSuccess(
      s,
      promotions.map((promotion: any) => publicPromotion(promotion, targets))
    );
  } catch (e) {
    return n(e);
  }
}

export async function getStoreBanners(r: any, s: Response, n: NextFunction) {
  try {
    const query = r.query;
    const banners = await listVisibleBanners(query.placement, query.limit ?? CONTENT_LIMITS.maxPublicBanners, query.category);
    const targets = await resolveLinkTargets(banners);
    return sendSuccess(
      s,
      banners.map((banner: any) => publicBanner(banner, targets))
    );
  } catch (e) {
    return n(e);
  }
}
