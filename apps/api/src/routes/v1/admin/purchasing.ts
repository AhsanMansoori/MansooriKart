import { Router } from 'express';
import {
  archiveSupplierHandler,
  createPurchaseOrderHandler,
  createSupplierHandler,
  getGoodsReceiptById,
  getPurchaseOrderById,
  getPurchaseOrders,
  getPurchasingDashboard,
  getPurchasingReports,
  getSupplierById,
  getSupplierPerformance,
  getSuppliers,
  listGoodsReceiptsHandler,
  listPurchaseReturnsHandler,
  receiveGoodsHandler,
  returnToSupplierHandler,
  transitionPurchaseOrderHandler,
  updatePurchaseOrderHandler,
  updateSupplierHandler,
} from '../../../controllers/admin/purchasingController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import {
  createPoBody,
  createSupplierBody,
  dashboardQuery,
  idParam,
  poListQuery,
  purchaseReturnBody,
  reasonBody,
  receiptBody,
  receiptListQuery,
  reportQuery,
  supplierListQuery,
  updatePoBody,
  updateSupplierBody,
} from './purchasingSchemas.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/suppliers', validate(supplierListQuery, 'query'), getSuppliers);
router.post('/suppliers', validate(createSupplierBody), createSupplierHandler);
router.get('/suppliers/:id', validate(idParam, 'params'), getSupplierById);
router.patch('/suppliers/:id', validate(idParam, 'params'), validate(updateSupplierBody), updateSupplierHandler);
router.delete('/suppliers/:id', validate(idParam, 'params'), archiveSupplierHandler);
router.get('/suppliers/:id/performance', validate(idParam, 'params'), getSupplierPerformance);

router.get('/purchase-orders', validate(poListQuery, 'query'), getPurchaseOrders);
router.post('/purchase-orders', validate(createPoBody), createPurchaseOrderHandler);
router.get('/purchase-orders/:id', validate(idParam, 'params'), getPurchaseOrderById);
router.patch('/purchase-orders/:id', validate(idParam, 'params'), validate(updatePoBody), updatePurchaseOrderHandler);

const transitionRoute = (path: string, to: 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED' | 'CLOSED') =>
  router.post(`/purchase-orders/:id/${path}`, validate(idParam, 'params'), validate(reasonBody), (req, res, next) =>
    transitionPurchaseOrderHandler(req, res, next, to)
  );

transitionRoute('submit', 'PENDING_APPROVAL');
transitionRoute('approve', 'APPROVED');
transitionRoute('cancel', 'CANCELLED');
transitionRoute('close', 'CLOSED');

router.post('/purchase-orders/:id/receipts', validate(idParam, 'params'), validate(receiptBody), receiveGoodsHandler);
router.get('/purchase-orders/:id/receipts', validate(idParam, 'params'), validate(receiptListQuery, 'query'), (req, res, next) =>
  listGoodsReceiptsHandler(req, res, next, { purchaseOrder: req.params.id })
);
router.get('/goods-receipts', validate(receiptListQuery, 'query'), listGoodsReceiptsHandler);
router.get('/goods-receipts/:id', validate(idParam, 'params'), getGoodsReceiptById);

router.post('/purchase-orders/:id/returns', validate(idParam, 'params'), validate(purchaseReturnBody), returnToSupplierHandler);
router.get('/purchase-returns', validate(receiptListQuery, 'query'), listPurchaseReturnsHandler);

router.get('/purchasing/dashboard', validate(dashboardQuery, 'query'), getPurchasingDashboard);
router.get('/purchasing/reports', validate(reportQuery, 'query'), getPurchasingReports);

export default router;
