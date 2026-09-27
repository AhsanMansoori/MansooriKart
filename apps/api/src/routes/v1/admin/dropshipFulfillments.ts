import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/dropshipFulfillmentsController.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const STATUSES = ['PENDING', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;

const listQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    status: z.enum(STATUSES).optional(),
    orderId: z.string().regex(oid).optional(),
    orderNumber: z.string().trim().min(3).max(64).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'status', 'fulfillmentNumber']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const patchBody = z
  .object({
    status: z.enum(STATUSES).optional(),
    supplierOrderReference: z.string().trim().min(1).max(160).optional(),
    supplierTrackingNumber: z.string().trim().min(1).max(160).optional(),
    carrier: z.string().trim().min(1).max(120).optional(),
    trackingUrl: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(body => Object.keys(body).length > 0, { message: 'At least one field is required.' });

router.get('/dropship-fulfillments/cancellation-policy', controller.getCancellationPolicy);
router.get('/dropship-fulfillments', validate(listQuery, 'query'), controller.listDropshipFulfillments);
router.get('/dropship-fulfillments/:id', validate(idParam, 'params'), controller.getDropshipFulfillmentById);
router.patch('/dropship-fulfillments/:id', validate(idParam, 'params'), validate(patchBody), controller.patchDropshipFulfillment);

export default router;
