import { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { AuditLog } from '../../models/auditLog.js';
import { GoodsReceipt, PurchaseReturn } from '../../models/goodsReceipt.js';
import { PurchaseOrder } from '../../models/purchaseOrder.js';
import { Supplier } from '../../models/supplier.js';
import { InventoryError } from '../../services/inventoryService.js';
import {
  createPurchaseOrder,
  PurchasingError,
  receiveGoods,
  returnToSupplier,
  transitionPurchaseOrder,
  updatePurchaseOrder,
} from '../../services/purchasingService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

const audit = (request: any, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown>) =>
  AuditLog.create({ actor: request.auth.userId, action, resourceType, resourceId, requestId: request.requestId, metadata });

const fail = (error: unknown, request: any, response: Response, next: NextFunction) => {
  if (error instanceof PurchasingError) return sendFailure(response, error.status, error.code, error.message, request.requestId);
  if (error instanceof InventoryError)
    return sendFailure(response, error.code === 'INSUFFICIENT_STOCK' ? 409 : 400, error.code, error.message, request.requestId);
  return next(error);
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const money = (value: number) => Number((value ?? 0).toFixed(2));

const idempotencyKey = (request: any, response: Response) => {
  const key = request.get('Idempotency-Key');
  if (typeof key !== 'string' || key.trim().length < 8 || key.trim().length > 128) {
    sendFailure(response, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header of 8 to 128 characters is required.', request.requestId);
    return null;
  }
  return key.trim();
};

const serializeSupplier = (document: any) => ({
  id: String(document._id),
  name: document.name,
  code: document.code,
  contactName: document.contactName ?? null,
  email: document.email ?? null,
  phone: document.phone ?? null,
  addressLine1: document.addressLine1 ?? null,
  addressLine2: document.addressLine2 ?? null,
  city: document.city ?? null,
  state: document.state ?? null,
  postalCode: document.postalCode ?? null,
  country: document.country ?? null,
  taxId: document.taxId ?? null,
  paymentTerms: document.paymentTerms ?? null,
  leadTimeDays: document.leadTimeDays ?? null,
  currency: document.currency ?? 'PKR',
  notes: document.notes ?? null,
  status: document.status,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

const serializePurchaseOrder = (document: any) => ({
  id: String(document._id),
  poNumber: document.poNumber,
  status: document.status,
  supplier:
    document.supplier && typeof document.supplier === 'object' && 'name' in document.supplier
      ? { id: String(document.supplier._id), name: document.supplier.name, code: document.supplier.code }
      : String(document.supplier),
  warehouse: String(document.warehouse),
  location: String(document.location),
  items: (document.items ?? []).map((item: any) => ({
    id: String(item._id),
    product: String(item.product),
    name: item.name,
    sku: item.sku ?? null,
    quantityOrdered: item.quantityOrdered,
    unitCost: item.unitCost,
    lineSubtotal: item.lineSubtotal,
    quantityReceived: item.quantityReceived ?? 0,
    quantityAccepted: item.quantityAccepted ?? 0,
    quantityRejected: item.quantityRejected ?? 0,
    quantityReturned: item.quantityReturned ?? 0,
    quantityOutstanding: Math.max(0, item.quantityOrdered - (item.quantityReceived ?? 0)),
  })),
  currency: document.currency ?? 'PKR',
  subtotal: document.subtotal,
  shippingCost: document.shippingCost ?? 0,
  taxAmount: document.taxAmount ?? 0,
  discount: document.discount ?? 0,
  total: document.total,
  expectedDate: document.expectedDate ?? null,
  reference: document.reference ?? null,
  notes: document.notes ?? null,
  statusHistory: (document.statusHistory ?? []).map((entry: any) => ({
    from: entry.from ?? null,
    to: entry.to,
    reason: entry.reason ?? null,
    actor: entry.actor ? String(entry.actor) : null,
    at: entry.at,
  })),
  createdBy: document.createdBy ? String(document.createdBy) : null,
  approvedBy: document.approvedBy ? String(document.approvedBy) : null,
  approvedAt: document.approvedAt ?? null,
  cancelledAt: document.cancelledAt ?? null,
  closedAt: document.closedAt ?? null,
  firstReceivedAt: document.firstReceivedAt ?? null,
  lastReceivedAt: document.lastReceivedAt ?? null,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

const serializeReceipt = (document: any) => ({
  id: String(document._id),
  receiptNumber: document.receiptNumber,
  purchaseOrder: String(document.purchaseOrder),
  supplier: String(document.supplier),
  warehouse: String(document.warehouse),
  location: String(document.location),
  items: (document.items ?? []).map((item: any) => ({
    purchaseOrderItem: String(item.purchaseOrderItem),
    product: String(item.product),
    name: item.name ?? null,
    sku: item.sku ?? null,
    unitCost: item.unitCost,
    quantityAccepted: item.quantityAccepted,
    quantityRejected: item.quantityRejected,
    rejectionReason: item.rejectionReason ?? null,
    previousCostPrice: item.previousCostPrice ?? null,
  })),
  totalAccepted: document.totalAccepted,
  totalRejected: document.totalRejected,
  acceptedValue: document.acceptedValue,
  currency: document.currency ?? 'PKR',
  receivedAt: document.receivedAt,
  note: document.note ?? null,
  receivedBy: document.receivedBy ? String(document.receivedBy) : null,
  costPriceSynced: Boolean(document.costPriceSynced),
  createdAt: document.createdAt,
});

const serializePurchaseReturn = (document: any) => ({
  id: String(document._id),
  returnNumber: document.returnNumber,
  purchaseOrder: String(document.purchaseOrder),
  supplier: String(document.supplier),
  warehouse: String(document.warehouse),
  location: String(document.location),
  items: (document.items ?? []).map((item: any) => ({
    purchaseOrderItem: String(item.purchaseOrderItem),
    product: String(item.product),
    name: item.name ?? null,
    sku: item.sku ?? null,
    unitCost: item.unitCost,
    quantity: item.quantity,
  })),
  totalQuantity: document.totalQuantity,
  returnedValue: document.returnedValue,
  currency: document.currency ?? 'PKR',
  reason: document.reason,
  returnedAt: document.returnedAt,
  createdBy: document.createdBy ? String(document.createdBy) : null,
  createdAt: document.createdAt,
});

export async function getSuppliers(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const filter: Record<string, unknown> = {};
    if (query.status) filter['status'] = query.status;
    else filter['status'] = { $ne: 'ARCHIVED' };
    if (query.paymentTerms) filter['paymentTerms'] = query.paymentTerms;
    if (query.search) {
      const pattern = new RegExp(escape(query.search), 'i');
      filter['$or'] = [{ name: pattern }, { code: pattern }, { email: pattern }, { contactName: pattern }];
    }
    const [rows, total] = await Promise.all([
      Supplier.find(filter)
        .sort({ [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Supplier.countDocuments(filter),
    ]);
    return sendSuccess(response, rows.map(serializeSupplier), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
}

export async function createSupplierHandler(request: any, response: Response, next: NextFunction) {
  try {
    const body = request.body;
    const created = await Supplier.create({ ...body, code: body.code.toUpperCase(), createdBy: request.auth.userId });
    await audit(request, 'SUPPLIER_CREATED', 'Supplier', String(created._id), { code: created.code, name: created.name });
    return sendSuccess(response, serializeSupplier(created), 201);
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'SUPPLIER_CODE_TAKEN', 'A supplier with that code already exists.', request.requestId);
    return next(error);
  }
}

export async function getSupplierById(request: any, response: Response, next: NextFunction) {
  try {
    const supplier = await Supplier.findById(request.params.id).lean();
    if (!supplier) return sendFailure(response, 404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.', request.requestId);
    const [openOrders, receivedValue] = await Promise.all([
      PurchaseOrder.countDocuments({ supplier: supplier._id, status: { $in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] } }),
      GoodsReceipt.aggregate([{ $match: { supplier: supplier._id } }, { $group: { _id: null, value: { $sum: '$acceptedValue' } } }]),
    ]);
    return sendSuccess(response, { ...serializeSupplier(supplier), openPurchaseOrders: openOrders, receivedValue: money(receivedValue[0]?.value ?? 0) });
  } catch (error) {
    return next(error);
  }
}

export async function updateSupplierHandler(request: any, response: Response, next: NextFunction) {
  try {
    const body = request.body as Record<string, unknown>;
    const update = { ...body };
    if (typeof update['code'] === 'string') update['code'] = update['code'].toUpperCase();
    const updated = await Supplier.findOneAndUpdate({ _id: request.params.id, status: { $ne: 'ARCHIVED' } }, { $set: update }, { new: true }).lean();
    if (!updated) return sendFailure(response, 404, 'SUPPLIER_NOT_FOUND', 'Supplier not found or archived.', request.requestId);
    await audit(request, 'SUPPLIER_UPDATED', 'Supplier', String(updated._id), { code: updated.code, fields: Object.keys(update) });
    return sendSuccess(response, serializeSupplier(updated));
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'SUPPLIER_CODE_TAKEN', 'A supplier with that code already exists.', request.requestId);
    return next(error);
  }
}

export async function archiveSupplierHandler(request: any, response: Response, next: NextFunction) {
  try {
    const open = await PurchaseOrder.countDocuments({
      supplier: request.params.id,
      status: { $in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] },
    });
    if (open > 0) return sendFailure(response, 409, 'SUPPLIER_HAS_OPEN_ORDERS', `The supplier still has ${open} open purchase order(s).`, request.requestId);
    const archived = await Supplier.findOneAndUpdate(
      { _id: request.params.id, status: { $ne: 'ARCHIVED' } },
      { $set: { status: 'ARCHIVED' } },
      { new: true }
    ).lean();
    if (!archived) return sendFailure(response, 404, 'SUPPLIER_NOT_FOUND', 'Supplier not found or already archived.', request.requestId);
    await audit(request, 'SUPPLIER_ARCHIVED', 'Supplier', String(archived._id), { code: archived.code });
    return sendSuccess(response, serializeSupplier(archived));
  } catch (error) {
    return next(error);
  }
}

export async function getSupplierPerformance(request: any, response: Response, next: NextFunction) {
  try {
    const supplier = await Supplier.findById(request.params.id).lean();
    if (!supplier) return sendFailure(response, 404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.', request.requestId);
    const [orderStats, receiptStats, returnStats] = await Promise.all([
      PurchaseOrder.aggregate([{ $match: { supplier: supplier._id } }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } }]),
      GoodsReceipt.aggregate([
        { $match: { supplier: supplier._id } },
        {
          $group: {
            _id: null,
            receipts: { $sum: 1 },
            accepted: { $sum: '$totalAccepted' },
            rejected: { $sum: '$totalRejected' },
            value: { $sum: '$acceptedValue' },
          },
        },
      ]),
      PurchaseReturn.aggregate([
        { $match: { supplier: supplier._id } },
        { $group: { _id: null, returns: { $sum: 1 }, quantity: { $sum: '$totalQuantity' }, value: { $sum: '$returnedValue' } } },
      ]),
    ]);
    const byStatus = orderStats.reduce((accumulator: Record<string, { count: number; value: number }>, row: any) => {
      accumulator[row._id] = { count: row.count, value: money(row.value) };
      return accumulator;
    }, {});
    const receipts = receiptStats[0] ?? { receipts: 0, accepted: 0, rejected: 0, value: 0 };
    const returns = returnStats[0] ?? { returns: 0, quantity: 0, value: 0 };
    const delivered = receipts.accepted + receipts.rejected;
    return sendSuccess(response, {
      supplier: { id: String(supplier._id), name: supplier.name, code: supplier.code, status: supplier.status },
      purchaseOrders: {
        total: orderStats.reduce((sum: number, row: any) => sum + row.count, 0),
        byStatus,
        committedValue: money(orderStats.reduce((sum: number, row: any) => sum + (row._id === 'CANCELLED' ? 0 : row.value), 0)),
      },
      receiving: {
        receipts: receipts.receipts,
        unitsAccepted: receipts.accepted,
        unitsRejected: receipts.rejected,
        acceptanceRate: delivered ? money((receipts.accepted / delivered) * 100) : null,
        acceptedValue: money(receipts.value),
      },
      supplierReturns: { count: returns.returns, units: returns.quantity, value: money(returns.value) },
      currency: supplier.currency ?? 'PKR',
    });
  } catch (error) {
    return next(error);
  }
}

export async function getPurchaseOrders(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const filter: Record<string, unknown> = {};
    if (query.status) filter['status'] = query.status;
    if (query.supplierId) filter['supplier'] = query.supplierId;
    if (query.warehouseId) filter['warehouse'] = query.warehouseId;
    if (query.productId) filter['items.product'] = query.productId;
    if (query.poNumber) filter['poNumber'] = query.poNumber.toUpperCase();
    if (query.from || query.to) filter['createdAt'] = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    if (query.minTotal !== undefined || query.maxTotal !== undefined)
      filter['total'] = {
        ...(query.minTotal !== undefined ? { $gte: query.minTotal } : {}),
        ...(query.maxTotal !== undefined ? { $lte: query.maxTotal } : {}),
      };
    const [rows, total] = await Promise.all([
      PurchaseOrder.find(filter)
        .populate('supplier', 'name code')
        .sort({ [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      PurchaseOrder.countDocuments(filter),
    ]);
    return sendSuccess(response, rows.map(serializePurchaseOrder), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
}

export async function createPurchaseOrderHandler(request: any, response: Response, next: NextFunction) {
  try {
    const created = await createPurchaseOrder({ ...request.body, actor: request.auth.userId, requestId: request.requestId });
    return sendSuccess(response, serializePurchaseOrder(created), 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getPurchaseOrderById(request: any, response: Response, next: NextFunction) {
  try {
    const purchaseOrder = await PurchaseOrder.findById(request.params.id).populate('supplier', 'name code').lean();
    if (!purchaseOrder) return sendFailure(response, 404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.', request.requestId);
    const [receipts, returns] = await Promise.all([
      GoodsReceipt.find({ purchaseOrder: purchaseOrder._id })
        .select('receiptNumber totalAccepted totalRejected acceptedValue receivedAt')
        .sort({ receivedAt: -1 })
        .lean(),
      PurchaseReturn.find({ purchaseOrder: purchaseOrder._id })
        .select('returnNumber totalQuantity returnedValue reason returnedAt')
        .sort({ returnedAt: -1 })
        .lean(),
    ]);
    return sendSuccess(response, {
      ...serializePurchaseOrder(purchaseOrder),
      receipts: receipts.map((receipt: any) => ({
        id: String(receipt._id),
        receiptNumber: receipt.receiptNumber,
        totalAccepted: receipt.totalAccepted,
        totalRejected: receipt.totalRejected,
        acceptedValue: receipt.acceptedValue,
        receivedAt: receipt.receivedAt,
      })),
      supplierReturns: returns.map((entry: any) => ({
        id: String(entry._id),
        returnNumber: entry.returnNumber,
        totalQuantity: entry.totalQuantity,
        returnedValue: entry.returnedValue,
        reason: entry.reason,
        returnedAt: entry.returnedAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

export async function updatePurchaseOrderHandler(request: any, response: Response, next: NextFunction) {
  try {
    const updated = await updatePurchaseOrder(request.params.id, request.body, { actor: request.auth.userId, requestId: request.requestId });
    return sendSuccess(response, serializePurchaseOrder(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function transitionPurchaseOrderHandler(
  request: any,
  response: Response,
  next: NextFunction,
  to: 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED' | 'CLOSED'
) {
  try {
    const updated = await transitionPurchaseOrder(request.params.id, to, {
      actor: request.auth.userId,
      requestId: request.requestId,
      reason: request.body?.reason,
    });
    return sendSuccess(response, serializePurchaseOrder(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function receiveGoodsHandler(request: any, response: Response, next: NextFunction) {
  try {
    const key = idempotencyKey(request, response);
    if (!key) return undefined;
    const receipt = await receiveGoods(request.params.id, request.body, {
      actor: request.auth.userId,
      requestId: request.requestId,
      idempotencyKey: key,
    });
    return sendSuccess(response, serializeReceipt(receipt), receipt.__replayed ? 200 : 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function listGoodsReceiptsHandler(request: any, response: Response, next: NextFunction, scope?: Record<string, unknown>) {
  try {
    const query = request.query;
    const filter: Record<string, unknown> = { ...scope };
    if (query.purchaseOrderId) filter['purchaseOrder'] = query.purchaseOrderId;
    if (query.supplierId) filter['supplier'] = query.supplierId;
    if (query.from || query.to) filter['receivedAt'] = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [rows, total] = await Promise.all([
      GoodsReceipt.find(filter)
        .sort({ receivedAt: -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      GoodsReceipt.countDocuments(filter),
    ]);
    return sendSuccess(response, rows.map(serializeReceipt), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
}

export async function getGoodsReceiptById(request: any, response: Response, next: NextFunction) {
  try {
    const receipt = await GoodsReceipt.findById(request.params.id).lean();
    if (!receipt) return sendFailure(response, 404, 'GOODS_RECEIPT_NOT_FOUND', 'Goods receipt not found.', request.requestId);
    return sendSuccess(response, serializeReceipt(receipt));
  } catch (error) {
    return next(error);
  }
}

export async function returnToSupplierHandler(request: any, response: Response, next: NextFunction) {
  try {
    const key = idempotencyKey(request, response);
    if (!key) return undefined;
    const record = await returnToSupplier(request.params.id, request.body, {
      actor: request.auth.userId,
      requestId: request.requestId,
      idempotencyKey: key,
    });
    return sendSuccess(response, serializePurchaseReturn(record), record.__replayed ? 200 : 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function listPurchaseReturnsHandler(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const filter: Record<string, unknown> = {};
    if (query.purchaseOrderId) filter['purchaseOrder'] = query.purchaseOrderId;
    if (query.supplierId) filter['supplier'] = query.supplierId;
    if (query.from || query.to) filter['returnedAt'] = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [rows, total] = await Promise.all([
      PurchaseReturn.find(filter)
        .sort({ returnedAt: -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      PurchaseReturn.countDocuments(filter),
    ]);
    return sendSuccess(response, rows.map(serializePurchaseReturn), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
}

export async function getPurchasingDashboard(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const since = new Date(Date.now() - query.days * 86_400_000);
    const [suppliers, byStatus, outstanding, receipts, returns, topSuppliers, recent] = await Promise.all([
      Supplier.aggregate([{ $group: { _id: '$status', value: { $sum: 1 } } }]),
      PurchaseOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } }]),
      PurchaseOrder.aggregate([
        { $match: { status: { $in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: null,
            units: { $sum: { $max: [0, { $subtract: ['$items.quantityOrdered', '$items.quantityReceived'] }] } },
            value: { $sum: { $multiply: ['$items.unitCost', { $max: [0, { $subtract: ['$items.quantityOrdered', '$items.quantityReceived'] }] }] } },
          },
        },
      ]),
      GoodsReceipt.aggregate([
        { $match: { receivedAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            receipts: { $sum: 1 },
            accepted: { $sum: '$totalAccepted' },
            rejected: { $sum: '$totalRejected' },
            value: { $sum: '$acceptedValue' },
          },
        },
      ]),
      PurchaseReturn.aggregate([
        { $match: { returnedAt: { $gte: since } } },
        { $group: { _id: null, returns: { $sum: 1 }, units: { $sum: '$totalQuantity' }, value: { $sum: '$returnedValue' } } },
      ]),
      PurchaseOrder.aggregate([
        { $match: { status: { $ne: 'CANCELLED' }, createdAt: { $gte: since } } },
        { $group: { _id: '$supplier', orders: { $sum: 1 }, value: { $sum: '$total' } } },
        { $sort: { value: -1, _id: 1 } },
        { $limit: query.limit },
        { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 'supplier', pipeline: [{ $project: { name: 1, code: 1 } }] } },
        { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: true } },
      ]),
      PurchaseOrder.find({})
        .populate('supplier', 'name code')
        .select('poNumber status total currency supplier createdAt expectedDate')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);
    const statusMap = byStatus.reduce((accumulator: Record<string, { count: number; value: number }>, row: any) => {
      accumulator[row._id] = { count: row.count, value: money(row.value) };
      return accumulator;
    }, {});
    const supplierMap = suppliers.reduce((accumulator: Record<string, number>, row: any) => {
      accumulator[row._id] = row.value;
      return accumulator;
    }, {});
    const receiptTotals = receipts[0] ?? { receipts: 0, accepted: 0, rejected: 0, value: 0 };
    const returnTotals = returns[0] ?? { returns: 0, units: 0, value: 0 };
    const open = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'];
    return sendSuccess(response, {
      suppliers: {
        total: Object.values(supplierMap).reduce((sum: number, value: any) => sum + value, 0),
        active: supplierMap['ACTIVE'] ?? 0,
        inactive: supplierMap['INACTIVE'] ?? 0,
        archived: supplierMap['ARCHIVED'] ?? 0,
      },
      purchaseOrders: {
        total: byStatus.reduce((sum: number, row: any) => sum + row.count, 0),
        open: open.reduce((sum: number, status: string) => sum + (statusMap[status]?.count ?? 0), 0),
        awaitingApproval: statusMap['PENDING_APPROVAL']?.count ?? 0,
        byStatus: statusMap,
        committedValue: money(byStatus.reduce((sum: number, row: any) => sum + (row._id === 'CANCELLED' ? 0 : row.value), 0)),
      },
      outstanding: { units: outstanding[0]?.units ?? 0, value: money(outstanding[0]?.value ?? 0) },
      receiving: {
        receipts: receiptTotals.receipts,
        unitsAccepted: receiptTotals.accepted,
        unitsRejected: receiptTotals.rejected,
        receivedValue: money(receiptTotals.value),
      },
      supplierReturns: { count: returnTotals.returns, units: returnTotals.units, value: money(returnTotals.value) },
      topSuppliers: topSuppliers.map((row: any) => ({
        supplier: row.supplier ? { id: String(row._id), name: row.supplier.name, code: row.supplier.code } : { id: String(row._id), name: null, code: null },
        orders: row.orders,
        value: money(row.value),
      })),
      recentPurchaseOrders: recent.map((row: any) => ({
        id: String(row._id),
        poNumber: row.poNumber,
        status: row.status,
        supplier: row.supplier ? { id: String(row.supplier._id), name: row.supplier.name, code: row.supplier.code } : null,
        total: row.total,
        currency: row.currency ?? 'PKR',
        expectedDate: row.expectedDate ?? null,
        createdAt: row.createdAt,
      })),
      periodDays: query.days,
      currency: 'PKR',
      basis: 'PROCUREMENT_COMMITMENT_AND_GOODS_IN',
    });
  } catch (error) {
    return next(error);
  }
}

export async function getPurchasingReports(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const since = new Date(Date.now() - query.days * 86_400_000);
    if (query.groupBy === 'date') {
      const rows = await GoodsReceipt.aggregate([
        { $match: { receivedAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } },
            receipts: { $sum: 1 },
            unitsAccepted: { $sum: '$totalAccepted' },
            unitsRejected: { $sum: '$totalRejected' },
            value: { $sum: '$acceptedValue' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      return sendSuccess(response, {
        groupBy: 'date',
        periodDays: query.days,
        rows: rows.map((row: any) => ({
          date: row._id,
          receipts: row.receipts,
          unitsAccepted: row.unitsAccepted,
          unitsRejected: row.unitsRejected,
          value: money(row.value),
        })),
        currency: 'PKR',
      });
    }
    if (query.groupBy === 'product') {
      const rows = await GoodsReceipt.aggregate([
        { $match: { receivedAt: { $gte: since } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            sku: { $first: '$items.sku' },
            unitsAccepted: { $sum: '$items.quantityAccepted' },
            unitsRejected: { $sum: '$items.quantityRejected' },
            value: { $sum: { $multiply: ['$items.unitCost', '$items.quantityAccepted'] } },
            latestUnitCost: { $last: '$items.unitCost' },
          },
        },
        { $sort: { value: -1, _id: 1 } },
        { $limit: query.limit },
      ]);
      return sendSuccess(response, {
        groupBy: 'product',
        periodDays: query.days,
        rows: rows.map((row: any) => ({
          product: String(row._id),
          name: row.name ?? null,
          sku: row.sku ?? null,
          unitsAccepted: row.unitsAccepted,
          unitsRejected: row.unitsRejected,
          value: money(row.value),
          latestUnitCost: row.latestUnitCost ?? null,
        })),
        currency: 'PKR',
      });
    }
    const rows = await PurchaseOrder.aggregate([
      { $match: { createdAt: { $gte: since }, status: { $ne: 'CANCELLED' } } },
      {
        $group: {
          _id: '$supplier',
          orders: { $sum: 1 },
          committedValue: { $sum: '$total' },
          unitsOrdered: { $sum: { $sum: '$items.quantityOrdered' } },
          unitsReceived: { $sum: { $sum: '$items.quantityReceived' } },
        },
      },
      { $sort: { committedValue: -1, _id: 1 } },
      { $limit: query.limit },
      { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 'supplier', pipeline: [{ $project: { name: 1, code: 1 } }] } },
      { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: true } },
    ]);
    return sendSuccess(response, {
      groupBy: 'supplier',
      periodDays: query.days,
      rows: rows.map((row: any) => ({
        supplier: { id: String(row._id), name: row.supplier?.name ?? null, code: row.supplier?.code ?? null },
        orders: row.orders,
        committedValue: money(row.committedValue),
        unitsOrdered: row.unitsOrdered,
        unitsReceived: row.unitsReceived,
        fulfillmentRate: row.unitsOrdered ? money((row.unitsReceived / row.unitsOrdered) * 100) : null,
      })),
      currency: 'PKR',
    });
  } catch (error) {
    return next(error);
  }
}
