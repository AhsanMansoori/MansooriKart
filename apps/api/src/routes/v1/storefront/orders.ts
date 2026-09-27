import express from 'express';
import { z } from 'zod';
import {
  cancelCustomerOrder,
  checkoutHandler,
  downloadInvoicePdf,
  getCustomerOrderById,
  getCustomerOrders,
  getCustomerRefunds,
  getCustomerReturnById,
  getCustomerReturns,
  getOrderInvoice,
  getOrderTracking,
  previewCheckoutHandler,
  requestOrderReturn,
} from '../../../controllers/storefront/ordersController.js';
import { requireAuth } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';

const router = express.Router();
const oid = /^[a-f\d]{24}$/i;

const checkoutBody = z
  .object({
    addressId: z.string().regex(oid),
    couponCode: z.string().trim().min(2).max(64).optional(),
    paymentMethod: z.literal('CASH_ON_DELIVERY'),
    items: z
      .array(z.object({ productId: z.string().regex(oid), quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(50)
      .optional(),
    quoteHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

const params = z.object({ orderId: z.string().regex(oid) }).strict();
const emptyBody = z.object({}).strict();

const returnBody = z
  .object({
    items: z
      .array(z.object({ productId: z.string().regex(oid), quantity: z.number().int().min(1).max(99) }).strict())
      .min(1)
      .max(50),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  })
  .strict();

router.use(requireAuth);

router.post('/checkout/preview', validate(checkoutBody.omit({ quoteHash: true })), previewCheckoutHandler);
router.post('/checkout', validate(checkoutBody), checkoutHandler);
router.get('/orders', validate(listQuery, 'query'), getCustomerOrders);
router.get('/orders/:orderId/tracking', validate(params, 'params'), getOrderTracking);
router.get('/orders/:orderId/invoice', validate(params, 'params'), getOrderInvoice);
router.get('/orders/:orderId/invoice.pdf', validate(params, 'params'), downloadInvoicePdf);
router.post('/orders/:orderId/returns', validate(params, 'params'), validate(returnBody), requestOrderReturn);
router.get('/returns', validate(listQuery.omit({ status: true }), 'query'), getCustomerReturns);
router.get('/returns/:orderId', validate(params, 'params'), getCustomerReturnById);
router.get('/refunds', validate(listQuery.omit({ status: true }), 'query'), getCustomerRefunds);
router.get('/orders/:orderId', validate(params, 'params'), getCustomerOrderById);
router.post('/orders/:orderId/cancel', validate(params, 'params'), validate(emptyBody), cancelCustomerOrder);

export default router;
