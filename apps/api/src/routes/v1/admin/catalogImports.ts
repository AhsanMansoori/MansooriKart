import express from 'express';
import { z } from 'zod';
import { CSV_LIMITS } from '../../../config/dropshipping.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { MAPPING_TARGETS } from '../../../services/catalogImportService.js';
import * as controller from '../../../controllers/admin/catalogImportsController.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const noBody = z.object({}).strict();

const csvBody = express.raw({
  type: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
  limit: CSV_LIMITS.maxFileBytes,
});

const uploadQuery = z
  .object({
    supplierId: z.string().regex(oid),
    fileName: z.string().trim().min(1).max(260),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
  })
  .strict();

const overwriteFlags = z
  .object({ name: z.boolean(), description: z.boolean(), category: z.boolean(), brand: z.boolean(), images: z.boolean() })
  .partial()
  .strict();

const mappingBody = z
  .object({
    entries: z
      .array(z.object({ column: z.string().trim().min(1).max(CSV_LIMITS.maxHeaderLength), target: z.enum(MAPPING_TARGETS) }).strict())
      .min(1)
      .max(CSV_LIMITS.maxColumns),
    allowFieldOverwrite: overwriteFlags.optional(),
    pricingRuleId: z.string().regex(oid).nullable().optional(),
    applyPricingToNewProducts: z.boolean().optional(),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
    saveAsTemplate: z.boolean().optional(),
    templateName: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

const listQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    status: z.enum(['UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const rowsQuery = z
  .object({
    result: z.enum(['VALID', 'INVALID', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

router.get('/catalog-imports/mapping-targets', controller.getMappingTargets);

router.post('/catalog-imports', csvBody, validate(uploadQuery, 'query'), controller.uploadCatalogCsv);
router.post('/catalog-imports/:id/mapping', validate(idParam, 'params'), validate(mappingBody), controller.confirmCatalogMapping);

router.get('/catalog-imports/:id/preview', validate(idParam, 'params'), controller.previewCatalogJob);

router.post('/catalog-imports/:id/import', validate(idParam, 'params'), validate(noBody), controller.runCatalogImport);
router.post('/catalog-imports/:id/cancel', validate(idParam, 'params'), validate(noBody), controller.cancelCatalogJob);

router.get('/catalog-imports', validate(listQuery, 'query'), controller.listCatalogJobs);
router.get('/catalog-imports/:id', validate(idParam, 'params'), controller.getCatalogJobById);
router.get('/catalog-imports/:id/rows', validate(idParam, 'params'), validate(rowsQuery, 'query'), controller.listCatalogJobRows);

export default router;
