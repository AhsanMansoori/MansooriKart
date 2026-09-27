import express from 'express';
import { z } from 'zod';
import {
  archiveProduct,
  archiveProductsBulk,
  createEntityHandlers,
  createProduct,
  getProductById,
  getProducts,
  previewPublishProducts,
  publishProductsBulk,
  publishSingleProduct,
  updateProduct,
} from '../../../controllers/admin/catalogController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { Brand } from '../../../models/brand.js';
import { CatalogAttribute } from '../../../models/catalogAttribute.js';
import { Category } from '../../../models/category.js';
import { ProductBadge } from '../../../models/productBadge.js';
import { ProductType } from '../../../models/productType.js';
import * as serialize from '../../../serializers/index.js';
import {
  attributeCreate,
  badgeCreate,
  brandCreate,
  catalogStatus,
  categoryCreate,
  idParams,
  noBody,
  productBody,
  productPatch,
  productQuery,
  publishBody,
  typeCreate,
} from './catalogSchemas.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/products', validate(productQuery, 'query'), getProducts);
router.get('/products/:id', validate(idParams, 'params'), getProductById);
router.post('/products', validate(productBody), createProduct);
router.patch('/products/:id', validate(idParams, 'params'), validate(productPatch), updateProduct);
router.delete('/products/:id', validate(idParams, 'params'), archiveProduct);
router.post('/products/publish-preview', validate(publishBody), previewPublishProducts);
router.post('/products/publish', validate(publishBody), publishProductsBulk);
router.post('/products/archive', validate(publishBody), archiveProductsBulk);
router.post('/products/:id/publish', validate(idParams, 'params'), validate(noBody), publishSingleProduct);

function registerSimpleEntity(path: string, resourceType: string, Model: any, createSchema: any, transform?: (item: any) => any) {
  const patch = createSchema.partial().strict();
  const list = z
    .object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), status: catalogStatus.optional() })
    .strict();
  const handlers = createEntityHandlers(resourceType, Model, transform);
  router.get(path, validate(list, 'query'), handlers.list);
  router.get(`${path}/:id`, validate(idParams, 'params'), handlers.get);
  router.post(path, validate(createSchema), handlers.create);
  router.patch(`${path}/:id`, validate(idParams, 'params'), validate(patch), handlers.update);
  router.delete(`${path}/:id`, validate(idParams, 'params'), handlers.archive);
}

registerSimpleEntity('/categories', 'Category', Category, categoryCreate, serialize.adminCategory);
registerSimpleEntity('/brands', 'Brand', Brand, brandCreate, serialize.adminBrand);
registerSimpleEntity('/product-types', 'ProductType', ProductType, typeCreate);
registerSimpleEntity('/attributes', 'CatalogAttribute', CatalogAttribute, attributeCreate);
registerSimpleEntity('/badges', 'ProductBadge', ProductBadge, badgeCreate);

export default router;
