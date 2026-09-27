import { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { DEFAULT_CURRENCY } from '../../config/storefront.js';
import { Expense } from '../../models/expense.js';
import { GoodsReceipt, PurchaseReturn } from '../../models/goodsReceipt.js';
import { InventoryBalance } from '../../models/inventoryBalance.js';
import { InventoryMovement } from '../../models/inventoryMovement.js';
import { Order } from '../../models/order.js';
import { Product } from '../../models/product.js';
import { PurchaseOrder } from '../../models/purchaseOrder.js';
import { Refund } from '../../models/refund.js';
import { ReturnRequest } from '../../models/return.js';
import { User } from '../../models/user.js';
import {
  computeFinance,
  expensesByCategory,
  FinanceError,
  MAX_RANGE_DAYS,
  money,
  purchaseFinance,
  REALIZED_EXPRESSION,
  realizedOrderMatch,
  refundMatch,
  refundsByDate,
  resolveRange,
  revenueByDate,
  type Range,
} from '../../services/financeService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const fail = (error: unknown, request: any, response: Response, next: NextFunction) => {
  if (error instanceof FinanceError) return sendFailure(response, error.status, error.code, error.message, request.requestId);
  return next(error);
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const page = (query: { page: number; limit: number }, total: number) => ({
  page: query.page,
  limit: query.limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / query.limit)),
  hasNextPage: query.page * query.limit < total,
  hasPreviousPage: query.page > 1,
});

const meta = (query: { page: number; limit: number }, total: number, range: Range) => ({
  ...page(query, total),
  from: range.from.toISOString(),
  to: range.to.toISOString(),
  days: range.days,
});

const rangeMeta = (range: Range) => ({ from: range.from.toISOString(), to: range.to.toISOString(), days: range.days, maxRangeDays: MAX_RANGE_DAYS });

const skip = (query: { page: number; limit: number }) => (query.page - 1) * query.limit;

export async function getSalesReport(request: any, response: Response, next: NextFunction) {
  try {
    const range = resolveRange(request.query);
    const [totals, byDate, statuses, payments, units, top] = await Promise.all([
      computeFinance(range),
      revenueByDate(range),
      Order.aggregate([
        { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: '$orderStatus', orders: { $sum: 1 }, value: { $sum: '$total' } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: '$paymentStatus', orders: { $sum: 1 }, value: { $sum: '$total' } } },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: null,
            unitsSold: { $sum: '$items.quantity' },
            realizedUnits: { $sum: { $cond: [REALIZED_EXPRESSION, '$items.quantity', 0] } },
          },
        },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            name: { $first: '$items.name' },
            sku: { $first: '$items.sku' },
            unitsSold: { $sum: '$items.quantity' },
            grossRevenue: { $sum: '$items.lineSubtotal' },
            realizedRevenue: {
              $sum: { $cond: [REALIZED_EXPRESSION, '$items.lineSubtotal', 0] },
            },
          },
        },
        { $sort: { unitsSold: -1, _id: 1 } },
        { $limit: 10 },
      ]),
    ]);
    return sendSuccess(
      response,
      {
        totals: {
          orders: totals.orders,
          realizedOrders: totals.realizedOrders,
          cancelledOrders: totals.cancelledOrders,
          grossSales: totals.grossSales,
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netSales: totals.netSales,
          averageOrderValue: totals.averageOrderValue,
          discountsGiven: totals.discountsGiven,
          shippingCharged: totals.shippingCharged,
          taxCollected: totals.taxCollected,
          unitsSold: units[0]?.unitsSold ?? 0,
          realizedUnitsSold: units[0]?.realizedUnits ?? 0,
        },
        byDate,
        byOrderStatus: statuses.map((row: any) => ({ status: row._id, orders: row.orders, value: money(row.value) })),
        byPaymentStatus: payments.map((row: any) => ({ status: row._id, orders: row.orders, value: money(row.value) })),
        topProducts: top.map((row: any) => ({
          product: String(row._id),
          name: row.name ?? null,
          sku: row.sku ?? null,
          unitsSold: row.unitsSold,
          grossRevenue: money(row.grossRevenue),
          realizedRevenue: money(row.realizedRevenue),
        })),
        currency: DEFAULT_CURRENCY,
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getProductReport(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const range = resolveRange(query);
    const realized = {
      $cond: [REALIZED_EXPRESSION, 1, 0],
    };
    const pipeline: Record<string, unknown>[] = [
      { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
      { $unwind: '$items' },
      ...(query.search
        ? [{ $match: { $or: [{ 'items.name': new RegExp(escape(query.search), 'i') }, { 'items.sku': new RegExp(escape(query.search), 'i') }] } }]
        : []),
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.name' },
          sku: { $first: '$items.sku' },
          orders: { $addToSet: '$_id' },
          unitsSold: { $sum: '$items.quantity' },
          grossRevenue: { $sum: '$items.lineSubtotal' },
          realizedUnits: { $sum: { $multiply: ['$items.quantity', realized] } },
          realizedRevenue: { $sum: { $multiply: ['$items.lineSubtotal', realized] } },
          realizedCost: { $sum: { $multiply: [{ $ifNull: ['$items.lineCost', 0] }, realized] } },
        },
      },
      { $addFields: { orders: { $size: '$orders' }, grossProfit: { $subtract: ['$realizedRevenue', '$realizedCost'] } } },
      { $sort: { [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 } },
      { $facet: { rows: [{ $skip: skip(query) }, { $limit: query.limit }], total: [{ $count: 'value' }] } },
    ];
    const [facet] = await Order.aggregate(pipeline);
    const rows = facet?.rows ?? [];
    const ids = rows.map((row: any) => row._id).filter(Boolean);
    const [returned, stock, products] = await Promise.all([
      ids.length
        ? ReturnRequest.aggregate([
            {
              $match: {
                createdAt: { $gte: range.from, $lte: range.to },
                status: { $in: ['APPROVED', 'RECEIVED', 'COMPLETED'] },
                'items.productId': { $in: ids },
              },
            },
            { $unwind: '$items' },
            { $match: { 'items.productId': { $in: ids } } },
            { $group: { _id: '$items.productId', quantity: { $sum: '$items.quantity' } } },
          ])
        : [],
      ids.length
        ? InventoryBalance.aggregate([
            { $match: { product: { $in: ids } } },
            { $group: { _id: '$product', onHand: { $sum: '$quantityOnHand' }, reserved: { $sum: '$quantityReserved' } } },
          ])
        : [],
      ids.length
        ? Product.find({ _id: { $in: ids } })
            .select('ratingAverage ratingCount lowStockThreshold status')
            .lean()
        : [],
    ]);
    const returnedBy = new Map<string, number>(returned.map((row: any) => [String(row._id), Number(row.quantity) || 0]));
    const stockBy = new Map<string, { onHand: number; reserved: number }>(
      stock.map((row: any) => [String(row._id), { onHand: Number(row.onHand) || 0, reserved: Number(row.reserved) || 0 }])
    );
    const productBy = new Map<string, { ratingAverage?: number; ratingCount?: number; lowStockThreshold?: number; status?: string }>(
      products.map((row: any) => [String(row._id), row])
    );
    return sendSuccess(
      response,
      rows.map((row: any) => {
        const key = String(row._id);
        const balance = stockBy.get(key);
        const product = productBy.get(key);
        const available = balance ? balance.onHand - balance.reserved : null;
        const threshold = product?.lowStockThreshold ?? 5;
        return {
          product: key,
          name: row.name ?? null,
          sku: row.sku ?? null,
          orders: row.orders,
          unitsSold: row.unitsSold,
          grossRevenue: money(row.grossRevenue),
          realizedUnits: row.realizedUnits,
          realizedRevenue: money(row.realizedRevenue),
          costOfGoodsSold: money(row.realizedCost),
          grossProfit: money(row.grossProfit),
          grossMargin: row.realizedRevenue > 0 ? money((row.grossProfit / row.realizedRevenue) * 100) : null,
          returnedQuantity: returnedBy.get(key) ?? 0,
          onHand: balance?.onHand ?? null,
          reserved: balance?.reserved ?? null,
          available,
          lowStockThreshold: threshold,
          stockStatus: available === null ? 'UNTRACKED' : available <= 0 ? 'OUT_OF_STOCK' : available <= threshold ? 'LOW_STOCK' : 'IN_STOCK',
          rating: product?.ratingAverage ?? null,
          reviews: product?.ratingCount ?? null,
        };
      }),
      200,
      meta(query, facet?.total?.[0]?.value ?? 0, range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getInventoryReport(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const pipeline: Record<string, unknown>[] = [
      { $group: { _id: '$product', onHand: { $sum: '$quantityOnHand' }, reserved: { $sum: '$quantityReserved' }, locations: { $sum: 1 } } },
      { $addFields: { available: { $subtract: ['$onHand', '$reserved'] } } },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
          pipeline: [{ $project: { name: 1, sku: 1, category: 1, brand: 1, price: 1, costPrice: 1, lowStockThreshold: 1, status: 1 } }],
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          name: '$product.name',
          sku: '$product.sku',
          threshold: { $ifNull: ['$product.lowStockThreshold', 5] },
          stockValue: { $multiply: ['$available', { $ifNull: ['$product.costPrice', 0] }] },
          retailValue: { $multiply: ['$available', { $ifNull: ['$product.price', 0] }] },
        },
      },
      ...(query.search ? [{ $match: { $or: [{ name: new RegExp(escape(query.search), 'i') }, { sku: new RegExp(escape(query.search), 'i') }] } }] : []),
      ...(query.filter === 'out-of-stock' ? [{ $match: { available: { $lte: 0 } } }] : []),
      ...(query.filter === 'low-stock' ? [{ $match: { $expr: { $and: [{ $gt: ['$available', 0] }, { $lte: ['$available', '$threshold'] }] } } }] : []),
      { $sort: { [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 } },
      {
        $facet: {
          rows: [{ $skip: skip(query) }, { $limit: query.limit }],
          total: [{ $count: 'value' }],
          totals: [{ $group: { _id: null, units: { $sum: '$available' }, stockValue: { $sum: '$stockValue' }, retailValue: { $sum: '$retailValue' } } }],
        },
      },
    ];
    const [facet] = await InventoryBalance.aggregate(pipeline);
    const summary = facet?.totals?.[0] ?? { units: 0, stockValue: 0, retailValue: 0 };
    return sendSuccess(
      response,
      {
        totals: {
          products: facet?.total?.[0]?.value ?? 0,
          units: summary.units,
          stockValue: money(summary.stockValue),
          retailValue: money(summary.retailValue),
        },
        rows: (facet?.rows ?? []).map((row: any) => ({
          product: String(row._id),
          name: row.name ?? null,
          sku: row.sku ?? null,
          category: row.product?.category ?? null,
          brand: row.product?.brand ?? null,
          status: row.product?.status ?? null,
          locations: row.locations,
          onHand: row.onHand,
          reserved: row.reserved,
          available: row.available,
          lowStockThreshold: row.threshold,
          costPrice: row.product?.costPrice ?? null,
          stockValue: money(row.stockValue),
          retailValue: money(row.retailValue),
        })),
        valuationBasis: 'LATEST_PURCHASE_COST',
        stockAuthority: 'INVENTORY_BALANCE',
        asOf: new Date().toISOString(),
        currency: DEFAULT_CURRENCY,
      },
      200,
      page(query, facet?.total?.[0]?.value ?? 0)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getInventoryMovementReport(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const range = resolveRange(query);
    const match = { createdAt: { $gte: range.from, $lte: range.to } };
    const key = query.groupBy === 'date' ? { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } : query.groupBy === 'product' ? '$product' : '$type';
    const pipeline: Record<string, unknown>[] = [
      { $match: match },
      {
        $group: {
          _id: key,
          movements: { $sum: 1 },
          unitsIn: { $sum: { $cond: [{ $gt: ['$quantityDelta', 0] }, '$quantityDelta', 0] } },
          unitsOut: { $sum: { $cond: [{ $lt: ['$quantityDelta', 0] }, { $abs: '$quantityDelta' }, 0] } },
          netChange: { $sum: '$quantityDelta' },
        },
      },
      { $sort: { movements: -1, _id: 1 } },
      { $facet: { rows: [{ $skip: skip(query) }, { $limit: query.limit }], total: [{ $count: 'value' }] } },
    ];
    const [facet] = await InventoryMovement.aggregate(pipeline);
    return sendSuccess(
      response,
      {
        groupBy: query.groupBy,
        rows: (facet?.rows ?? []).map((row: any) => ({
          key: String(row._id),
          movements: row.movements,
          unitsIn: row.unitsIn,
          unitsOut: row.unitsOut,
          netChange: row.netChange,
        })),
      },
      200,
      meta(query, facet?.total?.[0]?.value ?? 0, range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getCustomerReport(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const range = resolveRange(query);
    const realized = { $cond: [REALIZED_EXPRESSION, 1, 0] };
    const [facet, newCustomers, totalCustomers] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: '$customer',
            orders: { $sum: 1 },
            grossSpend: { $sum: '$total' },
            realizedOrders: { $sum: realized },
            realizedSpend: { $sum: { $multiply: ['$total', realized] } },
            firstOrderAt: { $min: '$createdAt' },
            lastOrderAt: { $max: '$createdAt' },
          },
        },
        { $sort: { [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 } },
        {
          $facet: {
            rows: [
              { $skip: skip(query) },
              { $limit: query.limit },
              {
                $lookup: {
                  from: 'users',
                  localField: '_id',
                  foreignField: '_id',
                  as: 'customer',
                  pipeline: [{ $project: { name: 1, email: 1, status: 1, createdAt: 1 } }],
                },
              },
              { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
            ],
            total: [{ $count: 'value' }],
            totals: [
              {
                $group: {
                  _id: null,
                  orders: { $sum: '$orders' },
                  grossSpend: { $sum: '$grossSpend' },
                  realizedSpend: { $sum: '$realizedSpend' },
                  buyers: { $sum: 1 },
                  repeatBuyers: { $sum: { $cond: [{ $gt: ['$orders', 1] }, 1, 0] } },
                },
              },
            ],
          },
        },
      ]),
      User.countDocuments({ role: 'CUSTOMER', createdAt: { $gte: range.from, $lte: range.to } }),
      User.countDocuments({ role: 'CUSTOMER' }),
    ]);
    const result = facet[0] ?? { rows: [], total: [], totals: [] };
    const summary = result.totals[0] ?? { orders: 0, grossSpend: 0, realizedSpend: 0, buyers: 0, repeatBuyers: 0 };
    return sendSuccess(
      response,
      {
        totals: {
          customers: totalCustomers,
          newCustomers,
          purchasingCustomers: summary.buyers,
          repeatCustomers: summary.repeatBuyers,
          repeatRate: summary.buyers ? money((summary.repeatBuyers / summary.buyers) * 100) : null,
          orders: summary.orders,
          grossSpend: money(summary.grossSpend),
          realizedSpend: money(summary.realizedSpend),
          averageRealizedSpend: summary.buyers ? money(summary.realizedSpend / summary.buyers) : 0,
          averageOrderValue: summary.orders ? money(summary.grossSpend / summary.orders) : 0,
        },
        rows: result.rows.map((row: any) => ({
          customer: String(row._id),
          name: row.customer?.name ?? null,
          email: row.customer?.email ?? null,
          status: row.customer?.status ?? null,
          orders: row.orders,
          realizedOrders: row.realizedOrders,
          grossSpend: money(row.grossSpend),
          realizedSpend: money(row.realizedSpend),
          firstOrderAt: row.firstOrderAt,
          lastOrderAt: row.lastOrderAt,
          acquiredInPeriod: Boolean(row.customer?.createdAt && row.customer.createdAt >= range.from && row.customer.createdAt <= range.to),
        })),
        currency: DEFAULT_CURRENCY,
      },
      200,
      meta(query, result.total[0]?.value ?? 0, range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getOrderReport(request: any, response: Response, next: NextFunction) {
  try {
    const range = resolveRange(request.query);
    const window = { createdAt: { $gte: range.from, $lte: range.to } };
    const [totals, statuses, fulfilment, returns, refunds] = await Promise.all([
      computeFinance(range),
      Order.aggregate([{ $match: window }, { $group: { _id: '$orderStatus', orders: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Order.aggregate([
        { $match: window },
        {
          $addFields: {
            shippedAt: {
              $min: {
                $map: {
                  input: { $filter: { input: { $ifNull: ['$statusHistory', []] }, as: 'entry', cond: { $eq: ['$$entry.to', 'SHIPPED'] } } },
                  as: 'entry',
                  in: '$$entry.at',
                },
              },
            },
            deliveredAt: {
              $min: {
                $map: {
                  input: { $filter: { input: { $ifNull: ['$statusHistory', []] }, as: 'entry', cond: { $eq: ['$$entry.to', 'DELIVERED'] } } },
                  as: 'entry',
                  in: '$$entry.at',
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            shipped: {
              $sum: {
                $cond: [{ $in: ['$orderStatus', ['SHIPPED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED']] }, 1, 0],
              },
            },
            delivered: {
              $sum: { $cond: [{ $in: ['$orderStatus', ['DELIVERED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED']] }, 1, 0] },
            },
            unpaidDelivered: { $sum: { $cond: [{ $and: [{ $eq: ['$orderStatus', 'DELIVERED'] }, { $ne: ['$paymentStatus', 'PAID'] }] }, 1, 0] } },
            units: { $sum: { $sum: '$items.quantity' } },
            hoursToShip: { $avg: { $cond: ['$shippedAt', { $divide: [{ $subtract: ['$shippedAt', '$createdAt'] }, 3600000] }, null] } },
            hoursToDeliver: { $avg: { $cond: ['$deliveredAt', { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 3600000] }, null] } },
            timedShipments: { $sum: { $cond: ['$shippedAt', 1, 0] } },
            timedDeliveries: { $sum: { $cond: ['$deliveredAt', 1, 0] } },
          },
        },
      ]),
      ReturnRequest.aggregate([{ $match: window }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Refund.aggregate([{ $match: refundMatch(range) }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } }, { $sort: { _id: 1 } }]),
    ]);
    const flow = fulfilment[0] ?? {
      shipped: 0,
      delivered: 0,
      unpaidDelivered: 0,
      units: 0,
      hoursToShip: null,
      hoursToDeliver: null,
      timedShipments: 0,
      timedDeliveries: 0,
    };
    return sendSuccess(
      response,
      {
        totals: {
          orders: totals.orders,
          units: flow.units,
          shipped: flow.shipped,
          delivered: flow.delivered,
          cancelled: totals.cancelledOrders,
          realizedOrders: totals.realizedOrders,
          deliveredAwaitingPayment: flow.unpaidDelivered,
          grossSales: totals.grossSales,
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netSales: totals.netSales,
        },
        byOrderStatus: statuses.map((row: any) => ({ status: row._id, orders: row.orders })),
        returnsByStatus: returns.map((row: any) => ({ status: row._id, count: row.count })),
        refundsByStatus: refunds.map((row: any) => ({ status: row._id, count: row.count, value: money(row.value) })),
        fulfilmentRate: totals.orders ? money((flow.delivered / totals.orders) * 100) : null,
        cancellationRate: totals.orders ? money((totals.cancelledOrders / totals.orders) * 100) : null,
        timing: {
          averageHoursToShip: flow.hoursToShip === null ? null : money(flow.hoursToShip),
          averageHoursToDeliver: flow.hoursToDeliver === null ? null : money(flow.hoursToDeliver),
          sampled: { shipments: flow.timedShipments, deliveries: flow.timedDeliveries },
          basis: 'ORDER_STATUS_HISTORY_TIMESTAMPS',
        },
        currency: DEFAULT_CURRENCY,
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getPurchasesReport(request: any, response: Response, next: NextFunction) {
  try {
    const range = resolveRange(request.query);
    const window = { createdAt: { $gte: range.from, $lte: range.to } };
    const [purchases, receipts, returns, bySupplier] = await Promise.all([
      purchaseFinance(range),
      GoodsReceipt.aggregate([
        { $match: { receivedAt: { $gte: range.from, $lte: range.to } } },
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
        { $match: { returnedAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: null, count: { $sum: 1 }, units: { $sum: '$totalQuantity' }, value: { $sum: '$returnedValue' } } },
      ]),
      PurchaseOrder.aggregate([
        { $match: { ...window, status: { $ne: 'CANCELLED' } } },
        { $group: { _id: '$supplier', orders: { $sum: 1 }, committedValue: { $sum: '$total' } } },
        { $sort: { committedValue: -1, _id: 1 } },
        { $limit: 20 },
        { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 'supplier', pipeline: [{ $project: { name: 1, code: 1 } }] } },
        { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: true } },
      ]),
    ]);
    const receiptTotals = receipts[0] ?? { receipts: 0, accepted: 0, rejected: 0, value: 0 };
    const returnTotals = returns[0] ?? { count: 0, units: 0, value: 0 };
    const inspected = receiptTotals.accepted + receiptTotals.rejected;
    return sendSuccess(
      response,
      {
        purchaseOrders: {
          total: purchases.purchaseOrders.reduce((sum: number, row: any) => sum + row.count, 0),
          committedValue: purchases.orderedValue,
          byStatus: purchases.purchaseOrders,
        },
        receiving: {
          receipts: receiptTotals.receipts,
          unitsAccepted: receiptTotals.accepted,
          unitsRejected: receiptTotals.rejected,
          receivedValue: purchases.receivedValue,
          acceptanceRate: inspected ? money((receiptTotals.accepted / inspected) * 100) : null,
        },
        outstanding: {
          quantity: purchases.outstandingQuantity,
          value: purchases.outstandingValue,
        },
        supplierReturns: { count: returnTotals.count, units: returnTotals.units, value: money(returnTotals.value) },
        topSuppliers: bySupplier.map((row: any) => ({
          supplier: { id: String(row._id), name: row.supplier?.name ?? null, code: row.supplier?.code ?? null },
          orders: row.orders,
          committedValue: money(row.committedValue),
        })),
        currency: DEFAULT_CURRENCY,
        basis: 'PROCUREMENT_COMMITMENT_AND_GOODS_IN',
        note: purchases.note,
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getFinanceReport(request: any, response: Response, next: NextFunction) {
  try {
    const range = resolveRange(request.query);
    const [totals, categories, revenue, refunds] = await Promise.all([
      computeFinance(range),
      expensesByCategory(range),
      revenueByDate(range),
      refundsByDate(range),
    ]);
    return sendSuccess(
      response,
      {
        totals: {
          grossSales: totals.grossSales,
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netSales: totals.netSales,
          netRealizedRevenue: totals.netRealizedRevenue,
          costOfGoodsSold: totals.costOfGoodsSold,
          grossProfit: totals.grossProfit,
          grossMargin: totals.grossMargin,
          operatingExpenses: totals.operatingExpenses,
          operatingProfit: totals.operatingProfit,
          operatingMargin: totals.operatingMargin,
          taxCollected: totals.taxCollected,
        },
        expensesByCategory: categories,
        revenueByDate: revenue,
        refundsByDate: refunds,
        costBasis: 'LATEST_PURCHASE_COST',
        cogsCoverage: totals.cogs,
        currency: DEFAULT_CURRENCY,
        basis: 'MANAGEMENT_REPORTING_NOT_STATUTORY_ACCOUNTING',
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getProfitReport(request: any, response: Response, next: NextFunction) {
  try {
    const query = request.query;
    const range = resolveRange(query);
    if (query.groupBy === 'summary') {
      const totals = await computeFinance(range);
      return sendSuccess(
        response,
        {
          groupBy: 'summary',
          realizedRevenue: totals.realizedRevenue,
          refunds: totals.refunds,
          netRealizedRevenue: totals.netRealizedRevenue,
          costOfGoodsSold: totals.costOfGoodsSold,
          grossProfit: totals.grossProfit,
          grossMargin: totals.grossMargin,
          operatingExpenses: totals.operatingExpenses,
          operatingProfit: totals.operatingProfit,
          operatingMargin: totals.operatingMargin,
          costBasis: 'LATEST_PURCHASE_COST',
          cogsCoverage: totals.cogs,
          currency: DEFAULT_CURRENCY,
        },
        200,
        rangeMeta(range)
      );
    }
    if (query.groupBy === 'date') {
      const rows = await revenueByDate(range);
      return sendSuccess(response, { groupBy: 'date', rows, costBasis: 'LATEST_PURCHASE_COST', currency: DEFAULT_CURRENCY }, 200, rangeMeta(range));
    }
    const group =
      query.groupBy === 'product'
        ? { _id: '$items.productId', name: { $first: '$items.name' }, sku: { $first: '$items.sku' } }
        : { _id: '$product.category', name: { $first: '$product.category' } };
    const pipeline: Record<string, unknown>[] = [
      { $match: realizedOrderMatch(range) },
      { $unwind: '$items' },
      ...(query.groupBy === 'category'
        ? [
            {
              $lookup: {
                from: 'products',
                localField: 'items.productId',
                foreignField: '_id',
                as: 'product',
                pipeline: [{ $project: { category: 1 } }],
              },
            },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
          ]
        : []),
      {
        $group: {
          ...group,
          units: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineSubtotal' },
          cost: { $sum: { $ifNull: ['$items.lineCost', 0] } },
        },
      },
      { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
      { $sort: { profit: -1, _id: 1 } },
      { $facet: { rows: [{ $skip: skip(query) }, { $limit: query.limit }], total: [{ $count: 'value' }] } },
    ];
    const [facet] = await Order.aggregate(pipeline);
    return sendSuccess(
      response,
      {
        groupBy: query.groupBy,
        rows: (facet?.rows ?? []).map((row: any) => ({
          key: row._id === null ? null : String(row._id),
          name: row.name ?? null,
          ...(query.groupBy === 'product' ? { sku: row.sku ?? null } : {}),
          units: row.units,
          realizedRevenue: money(row.revenue),
          costOfGoodsSold: money(row.cost),
          grossProfit: money(row.profit),
          grossMargin: row.revenue > 0 ? money((row.profit / row.revenue) * 100) : null,
        })),
        costBasis: 'LATEST_PURCHASE_COST',
        currency: DEFAULT_CURRENCY,
      },
      200,
      meta(query, facet?.total?.[0]?.value ?? 0, range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getTaxReport(request: any, response: Response, next: NextFunction) {
  try {
    const range = resolveRange(request.query);
    const [totals, byDate, expenseTax] = await Promise.all([
      computeFinance(range),
      Order.aggregate([
        { $match: realizedOrderMatch(range) },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            orders: { $sum: 1 },
            taxableBase: { $sum: '$subtotal' },
            tax: { $sum: { $ifNull: ['$tax', 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Expense.aggregate([
        { $match: { status: 'APPROVED', expenseDate: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: '$category', tax: { $sum: { $ifNull: ['$taxAmount', 0] } } } },
        { $match: { tax: { $gt: 0 } } },
        { $sort: { tax: -1, _id: 1 } },
      ]),
    ]);
    return sendSuccess(
      response,
      {
        salesTax: {
          collectedOnSales: totals.taxCollected,
          realizedOrders: totals.realizedOrders,
          realizedRevenue: totals.realizedRevenue,
          byDate: byDate.map((row: any) => ({ date: row._id, orders: row.orders, taxableBase: money(row.taxableBase), tax: money(row.tax) })),
        },
        expenseTax: { total: totals.operatingExpenseTax, byCategory: expenseTax.map((row: any) => ({ category: row._id, tax: money(row.tax) })) },
        netTaxPosition: money(totals.taxCollected - totals.operatingExpenseTax),
        currency: DEFAULT_CURRENCY,
        basis: 'RECORDED_TAX_AMOUNTS_ONLY',
        disclaimer:
          'Recorded amounts only. No jurisdiction rules, rate tables, exemptions, registration thresholds or filing obligations are evaluated, and this is not tax advice or a tax return.',
      },
      200,
      rangeMeta(range)
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
}

export async function getReportsIndex(_request: any, response: Response) {
  return sendSuccess(response, {
    reports: [
      { key: 'sales', path: '/api/v1/admin/reports/sales', paginated: false },
      { key: 'products', path: '/api/v1/admin/reports/products', paginated: true },
      { key: 'inventory', path: '/api/v1/admin/reports/inventory', paginated: true },
      { key: 'inventory-movements', path: '/api/v1/admin/reports/inventory-movements', paginated: true },
      { key: 'customers', path: '/api/v1/admin/reports/customers', paginated: true },
      { key: 'orders', path: '/api/v1/admin/reports/orders', paginated: false },
      { key: 'purchases', path: '/api/v1/admin/reports/purchases', paginated: false },
      { key: 'finance', path: '/api/v1/admin/reports/finance', paginated: false },
      { key: 'profit', path: '/api/v1/admin/reports/profit', paginated: true },
      { key: 'tax', path: '/api/v1/admin/reports/tax', paginated: false },
    ],
    maxRangeDays: MAX_RANGE_DAYS,
    export: { available: false, reason: 'The Import/Export ERP module, including CSV export and scheduled delivery, is deferred to a later phase.' },
  });
}
