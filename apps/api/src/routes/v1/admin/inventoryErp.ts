import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import * as controller from '../../../controllers/admin/inventoryErpController.js';

const router = express.Router();
const oid = /^[a-f\d]{24}$/i;
const status = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
const id = z.object({ id: z.string().regex(oid) }).strict();

const warehouse = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,40}$/),
    description: z.string().trim().max(2000).optional(),
    address: z.string().trim().max(1000).optional(),
    contactName: z.string().trim().max(120).optional(),
    contactPhone: z.string().trim().max(30).optional(),
    status: status.default('ACTIVE'),
    isDefault: z.boolean().default(false),
  })
  .strict();

const location = z
  .object({
    warehouseId: z.string().regex(oid),
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,80}$/),
    description: z.string().trim().max(1000).optional(),
    status: status.default('ACTIVE'),
  })
  .strict();

const adjustment = z
  .object({
    productId: z.string().regex(oid),
    warehouseId: z.string().regex(oid).optional(),
    locationId: z.string().regex(oid).optional(),
    quantityDelta: z
      .number()
      .int()
      .refine(v => v !== 0),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const transfer = z
  .object({
    productId: z.string().regex(oid),
    sourceWarehouseId: z.string().regex(oid),
    sourceLocationId: z.string().regex(oid),
    destinationWarehouseId: z.string().regex(oid),
    destinationLocationId: z.string().regex(oid),
    quantity: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    warehouse: z.string().regex(oid).optional(),
    location: z.string().regex(oid).optional(),
    product: z.string().regex(oid).optional(),
    type: z.enum(['INITIAL', 'RESTOCK', 'ORDER', 'CANCELLATION', 'RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN']).optional(),
    referenceType: z.string().trim().min(1).max(80).optional(),
    referenceId: z.string().trim().min(1).max(160).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    stockState: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
    search: z.string().trim().max(80).optional(),
  })
  .strict();

router.use(requireAuth, requireSuperAdmin);

router.get('/inventory/dashboard', controller.getInventoryDashboard);
router.get('/inventory/stock', validate(page, 'query'), controller.listStockBalances);
router.get('/inventory/stock/:id', validate(id, 'params'), controller.getProductStockDetail);

router.get('/inventory/warehouses', validate(page, 'query'), controller.listWarehouses);
router.get('/inventory/warehouses/:id', validate(id, 'params'), controller.getWarehouseById);
router.post('/inventory/warehouses', validate(warehouse), controller.createWarehouse);
router.patch('/inventory/warehouses/:id', validate(id, 'params'), validate(warehouse.partial().strict()), controller.patchWarehouse);
router.delete('/inventory/warehouses/:id', validate(id, 'params'), controller.deleteWarehouse);

router.get('/inventory/locations', validate(page, 'query'), controller.listLocations);
router.get('/inventory/locations/:id', validate(id, 'params'), controller.getLocationById);
router.post('/inventory/locations', validate(location), controller.createLocation);
router.patch('/inventory/locations/:id', validate(id, 'params'), validate(location.partial().omit({ warehouseId: true }).strict()), controller.patchLocation);
router.delete('/inventory/locations/:id', validate(id, 'params'), controller.deleteLocation);

router.post('/inventory/adjustments', validate(adjustment), controller.createAdjustment);
router.post('/inventory/transfers', validate(transfer), controller.createTransfer);
router.get('/inventory/movements', validate(page, 'query'), controller.listMovements);
router.get('/inventory/bootstrap-default', controller.bootstrapDefaultWarehouse);

export default router;
