import express from 'express';
import {
  createBanner,
  createPromotion,
  deleteBanner,
  deletePromotion,
  getBannerById,
  getBanners,
  getHomepage,
  getPromotionById,
  getPromotions,
  reorderBanners,
  reorderHomepage,
  setBannerStatus,
  setPromotionStatus,
  updateBanner,
  updateHomepage,
  updateHomepageSection,
  updatePromotion,
} from '../../../controllers/admin/marketingController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import {
  bannerCreate,
  bannerFields,
  bannerQuery,
  homepageSchema,
  promotionCreate,
  promotionFields,
  promotionQuery,
  reorderHomepageSchema,
  reorderSchema,
  sectionEnabledSchema,
} from './marketingSchemas.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/promotions', validate(promotionQuery, 'query'), getPromotions);
router.post('/promotions', validate(promotionCreate), createPromotion);
router.get('/promotions/:id', getPromotionById);
router.patch('/promotions/:id', validate(promotionFields), updatePromotion);
router.post('/promotions/:id/activate', (r, s, n) => setPromotionStatus(r, s, n, 'ACTIVE', 'PROMOTION_ACTIVATED'));
router.post('/promotions/:id/archive', (r, s, n) => setPromotionStatus(r, s, n, 'ARCHIVED', 'PROMOTION_ARCHIVED'));
router.delete('/promotions/:id', deletePromotion);

router.get('/banners', validate(bannerQuery, 'query'), getBanners);
router.post('/banners', validate(bannerCreate), createBanner);
router.get('/banners/:id', getBannerById);
router.patch('/banners/:id', validate(bannerFields), updateBanner);
router.post('/banners/:id/activate', (r, s, n) => setBannerStatus(r, s, n, 'ACTIVE', 'BANNER_ACTIVATED'));
router.post('/banners/:id/archive', (r, s, n) => setBannerStatus(r, s, n, 'ARCHIVED', 'BANNER_ARCHIVED'));
router.delete('/banners/:id', deleteBanner);
router.post('/banners/reorder', validate(reorderSchema), reorderBanners);

router.get('/homepage', getHomepage);
router.put('/homepage', validate(homepageSchema), updateHomepage);
router.post('/homepage/reorder', validate(reorderHomepageSchema), reorderHomepage);
router.patch('/homepage/sections/:key', validate(sectionEnabledSchema), updateHomepageSection);

export default router;
