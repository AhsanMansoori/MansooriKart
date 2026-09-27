import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/ordersController.js';

const router = express.Router(),
  oid = /^[a-f\d]{24}$/i;

const params = z.object({ orderId: z.string().regex(oid) }).strict();

const status = z
  .object({ status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']), reason: z.string().trim().min(3).max(500).optional() })
  .strict();

const payment = z
  .object({
    paymentStatus: z.enum(['PENDING', 'UNPAID', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    orderNumber: z.string().trim().min(1).max(64).optional(),
    customer: z.string().trim().min(1).max(120).optional(),
    orderStatus: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
    paymentStatus: z.enum(['PENDING', 'UNPAID', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
    paymentMethod: z.literal('CASH_ON_DELIVERY').optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    sort: z.enum(['createdAt', 'total', 'orderNumber']).default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

router.use(requireAuth, requireSuperAdmin);

router.get('/orders', validate(listQuery, 'query'), controller.listOrders);
router.get('/orders/:orderId', validate(params, 'params'), controller.getOrderById);
router.get('/orders/:orderId/invoice', validate(params, 'params'), controller.getOrderInvoice);
router.get('/orders/:orderId/invoice.pdf', validate(params, 'params'), controller.getOrderInvoicePdf);
router.patch('/orders/:orderId/status', validate(params, 'params'), validate(status), controller.updateOrderStatus);
router.patch('/orders/:orderId/payment-status', validate(params, 'params'), validate(payment), controller.updateOrderPaymentStatus);
router.post('/orders/:orderId/cancel', validate(params, 'params'), validate(z.object({}).strict()), controller.cancelAdminOrder);

export default router;
