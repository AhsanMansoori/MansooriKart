import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/supplierSourcesController.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const productParam = z.object({ productId: z.string().regex(oid) }).strict();
const SORTABLE = ['createdAt', 'updatedAt', 'supplierCost', 'supplierStockUpdatedAt', 'supplierSku'] as const;

const listQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    productId: z.string().regex(oid).optional(),
    supplierSku: z.string().trim().min(1).max(120).optional(),
    availability: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    stale: z.enum(['true', 'false']).optional(),
    sortBy: z.enum(SORTABLE).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

router.get('/supplier-sources', validate(listQuery, 'query'), controller.listSupplierSources);
router.get('/products/:productId/supplier-sources', validate(productParam, 'params'), controller.getProductSupplierSources);
router.get('/supplier-sources/:id', validate(idParam, 'params'), controller.getSupplierSourceById);

export default router;
