import express from 'express';
import { z } from 'zod';
import {
  getBrandBySlug,
  getCategoryBySlug,
  getProductByIdentifier,
  listBrands,
  listCategories,
  listProducts,
} from '../../../controllers/storefront/catalogController.js';
import { validate } from '../../../middleware/validate.js';

const router = express.Router();
const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(80).optional(),
    category: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(120).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating']).default('newest'),
    featured: z.enum(['true', 'false']).optional(),
  })
  .strict();

router.get('/categories', listCategories);
router.get('/categories/:slug', getCategoryBySlug);
router.get('/brands', listBrands);
router.get('/brands/:slug', getBrandBySlug);
router.get('/products', validate(querySchema, 'query'), listProducts);
router.get('/products/:identifier', getProductByIdentifier);

export default router;
