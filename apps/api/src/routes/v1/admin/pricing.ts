import express from 'express';
import { z } from 'zod';
import { BULK_LIMITS, SUPPLIER_VALUE_LIMITS } from '../../../config/dropshipping.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/pricingController.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const noBody = z.object({}).strict();
const money = z.number().min(0).max(SUPPLIER_VALUE_LIMITS.maxPrice);

const ruleFields = {
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  supplierId: z.string().regex(oid).nullable().optional(),
  category: z.string().trim().min(1).max(160).nullable().optional(),
  brand: z.string().trim().min(1).max(160).nullable().optional(),
  minCost: money.nullable().optional(),
  maxCost: money.nullable().optional(),
  markupType: z.enum(['PERCENTAGE', 'FIXED']),
  markupValue: money,
  minimumProfit: money.nullable().optional(),
  roundingRule: z.enum(['NONE', 'END_99']).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
};

const createRule = z.object(ruleFields).strict();
const patchRule = z
  .object({ ...ruleFields, markupType: ruleFields.markupType.optional(), markupValue: money.optional(), name: ruleFields.name.optional() })
  .strict()
  .refine(body => Object.keys(body).length > 0, { message: 'At least one field is required.' });

const ruleQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    markupType: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const targetBody = z
  .object({
    productIds: z.array(z.string().regex(oid)).min(1).max(BULK_LIMITS.maxPricingTargets).optional(),
    supplierId: z.string().regex(oid).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
    ruleId: z.string().regex(oid).optional(),
    includeOverridden: z.boolean().optional(),
  })
  .strict();

router.post('/pricing-rules', validate(createRule), controller.createPricingRule);

router.get('/pricing-rules', validate(ruleQuery, 'query'), controller.listPricingRules);
router.get('/pricing-rules/:id', validate(idParam, 'params'), controller.getPricingRuleById);

router.patch('/pricing-rules/:id', validate(idParam, 'params'), validate(patchRule), controller.patchPricingRule);

router.post('/pricing-rules/:id/disable', validate(idParam, 'params'), validate(noBody), controller.disablePricingRule);
router.post('/pricing-rules/:id/enable', validate(idParam, 'params'), validate(noBody), controller.enablePricingRule);

router.post('/pricing/preview', validate(targetBody), controller.previewBulkPricing);
router.post('/pricing/apply', validate(targetBody), controller.applyBulkPricing);

export default router;
