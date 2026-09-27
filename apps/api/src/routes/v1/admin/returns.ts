import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/returnsController.js';

const router = express.Router(),
  oid = /^[a-f\d]{24}$/i;

const id = z.object({ id: z.string().regex(oid) }).strict(),
  orderId = z.object({ orderId: z.string().regex(oid) }).strict();

const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED']).optional(),
  })
  .strict();

const status = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'RECEIVED', 'COMPLETED']), reason: z.string().trim().min(3).max(500) }).strict();
const refund = z.object({ amount: z.number().positive(), reason: z.string().trim().min(3).max(500), returnId: z.string().regex(oid).optional() }).strict();
const refundStatus = z.object({ status: z.enum(['APPROVED', 'COMPLETED', 'FAILED']) }).strict();

router.use(requireAuth, requireSuperAdmin);

router.get('/returns', validate(page, 'query'), controller.listReturns);
router.get('/returns/:id', validate(id, 'params'), controller.getReturnById);
router.patch('/returns/:id/status', validate(id, 'params'), validate(status), controller.updateReturnStatus);

router.get('/refunds', validate(page, 'query'), controller.listRefunds);
router.get('/refunds/:id', validate(id, 'params'), controller.getRefundById);
router.patch('/refunds/:id/status', validate(id, 'params'), validate(refundStatus), controller.updateRefundStatus);

router.post('/orders/:orderId/refunds', validate(orderId, 'params'), validate(refund), controller.createOrderRefund);

export default router;
