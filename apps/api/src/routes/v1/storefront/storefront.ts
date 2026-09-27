import express from 'express';
import { z } from 'zod';
import { BANNER_PLACEMENTS, CONTENT_LIMITS } from '../../../config/storefront.js';
import {
  getStoreBanners,
  getStoreConfig,
  getStoreFaqs,
  getStoreHome,
  getStoreNavigation,
  getStorePageBySlug,
  getStorePages,
  getStorePromotions,
  maintenanceGuard,
} from '../../../controllers/storefront/storefrontController.js';
import { validate } from '../../../middleware/validate.js';
import { isObjectId } from '../../../utils/sanitize.js';

const router = express.Router();

const publicList = z.object({ limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).optional() }).strict();

router.get('/store/config', getStoreConfig);
router.get('/store/home', maintenanceGuard, getStoreHome);
router.get('/store/navigation', maintenanceGuard, getStoreNavigation);

const faqQuery = publicList.extend({ category: z.string().trim().min(1).max(120).optional() }).strict();
router.get('/store/faqs', maintenanceGuard, validate(faqQuery, 'query'), getStoreFaqs);

router.get('/store/pages', maintenanceGuard, validate(publicList, 'query'), getStorePages);
router.get('/store/pages/:slug', maintenanceGuard, getStorePageBySlug);
router.get('/store/promotions', maintenanceGuard, validate(publicList, 'query'), getStorePromotions);

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

router.get('/store/banners', maintenanceGuard, validate(bannerQuery, 'query'), getStoreBanners);

export default router;
