import { z } from 'zod';

export const oid = /^[a-f\d]{24}$/i;
export const idParam = z.object({ id: z.string().regex(oid) }).strict();

export const supplierFields = {
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Supplier code may contain letters, digits, dot, underscore and hyphen only'),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(30).optional(),
  country: z.string().trim().max(120).optional(),
  taxId: z.string().trim().max(60).optional(),
  paymentTerms: z.enum(['PREPAID', 'COD', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60']).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(2000).optional(),
};

export const createSupplierBody = z.object(supplierFields).strict();
export const updateSupplierBody = z
  .object({ ...supplierFields, name: supplierFields.name.optional(), code: supplierFields.code.optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'At least one field must be supplied');

export const supplierListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(160).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
    paymentTerms: z.enum(['PREPAID', 'COD', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60']).optional(),
  })
  .strict();

export const poItem = z
  .object({ productId: z.string().regex(oid), quantity: z.coerce.number().int().min(1).max(1_000_000), unitCost: z.coerce.number().min(0).max(100_000_000) })
  .strict();

export const createPoBody = z
  .object({
    supplierId: z.string().regex(oid),
    items: z.array(poItem).min(1).max(200),
    warehouseId: z.string().regex(oid).optional(),
    locationId: z.string().regex(oid).optional(),
    expectedDate: z.coerce.date().optional(),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
    shippingCost: z.coerce.number().min(0).max(100_000_000).optional(),
    taxAmount: z.coerce.number().min(0).max(100_000_000).optional(),
    discount: z.coerce.number().min(0).max(100_000_000).optional(),
  })
  .strict();

export const updatePoBody = z
  .object({
    items: z.array(poItem).min(1).max(200).optional(),
    warehouseId: z.string().regex(oid).optional(),
    locationId: z.string().regex(oid).optional(),
    expectedDate: z.coerce.date().optional(),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
    shippingCost: z.coerce.number().min(0).max(100_000_000).optional(),
    taxAmount: z.coerce.number().min(0).max(100_000_000).optional(),
    discount: z.coerce.number().min(0).max(100_000_000).optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, 'At least one field must be supplied');

export const poListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    poNumber: z.string().trim().min(1).max(64).optional(),
    supplierId: z.string().regex(oid).optional(),
    warehouseId: z.string().regex(oid).optional(),
    productId: z.string().regex(oid).optional(),
    status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    minTotal: z.coerce.number().min(0).optional(),
    maxTotal: z.coerce.number().min(0).optional(),
    sort: z.enum(['createdAt', 'total', 'poNumber', 'expectedDate']).default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const reasonBody = z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict();

export const receiptBody = z
  .object({
    items: z
      .array(
        z
          .object({
            purchaseOrderItemId: z.string().regex(oid),
            quantityAccepted: z.coerce.number().int().min(0).max(1_000_000),
            quantityRejected: z.coerce.number().int().min(0).max(1_000_000).optional(),
            rejectionReason: z.string().trim().max(500).optional(),
          })
          .strict()
      )
      .min(1)
      .max(200),
    receivedAt: z.coerce.date().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const receiptListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    purchaseOrderId: z.string().regex(oid).optional(),
    supplierId: z.string().regex(oid).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

export const purchaseReturnBody = z
  .object({
    items: z
      .array(z.object({ purchaseOrderItemId: z.string().regex(oid), quantity: z.coerce.number().int().min(1).max(1_000_000) }).strict())
      .min(1)
      .max(200),
    reason: z.string().trim().min(3).max(500),
    returnedAt: z.coerce.date().optional(),
  })
  .strict();

export const dashboardQuery = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(30), limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

export const reportQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(30),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    groupBy: z.enum(['supplier', 'product', 'date']).default('supplier'),
  })
  .strict();
