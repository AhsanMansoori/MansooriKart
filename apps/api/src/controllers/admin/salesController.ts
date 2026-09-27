import type { NextFunction, Request, Response } from 'express';
import { REALIZED_ORDER, REALIZED_EXPRESSION } from '../../services/financeService.js';
import { Order } from '../../models/order.js';
import { Refund } from '../../models/refund.js';
import { sendSuccess } from '../../utils/api-response.js';

const startFor = (q: any) => (q.range ? new Date(Date.now() - Number(q.range.slice(0, -1)) * 86400000) : q.from);

export const getSalesDashboard = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const start = startFor(request.query as any),
      end = (request.query as any).to || new Date();
    const base = { createdAt: { $gte: start, $lte: end } };
    const [orders, realized, cancelled, returns, refunds, topProducts, recent] = await Promise.all([
      Order.aggregate([{ $match: base }, { $group: { _id: null, count: { $sum: 1 }, gross: { $sum: '$total' }, average: { $avg: '$total' } } }]),
      Order.aggregate([{ $match: { ...base, ...REALIZED_ORDER } }, { $group: { _id: null, value: { $sum: '$total' } } }]),
      Order.countDocuments({ ...base, orderStatus: 'CANCELLED' }),
      Order.countDocuments({ ...base, orderStatus: { $in: ['RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURNED'] } }),
      Refund.aggregate([{ $match: { createdAt: base.createdAt, status: { $ne: 'FAILED' } } }, { $group: { _id: null, value: { $sum: '$amount' } } }]),
      Order.aggregate([
        { $match: base },
        { $unwind: '$items' },
        { $group: { _id: '$items.productId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' }, gross: { $sum: '$items.lineSubtotal' } } },
        { $sort: { quantity: -1 } },
        { $limit: 10 },
      ]),
      Order.find(base).sort({ createdAt: -1 }).limit(10).select('orderNumber total currency orderStatus paymentStatus createdAt').lean(),
    ]);
    const gross = orders[0]?.gross || 0,
      refundTotal = refunds[0]?.value || 0;
    return sendSuccess(
      response,
      {
        orders: orders[0]?.count || 0,
        grossSales: gross,
        realizedRevenue: realized[0]?.value || 0,
        averageOrderValue: orders[0]?.average || 0,
        cancelledOrders: cancelled,
        returnedOrders: returns,
        refunds: refundTotal,
        netSales: gross - refundTotal,
        topProducts,
        recentOrders: recent,
      },
      200,
      { from: start.toISOString(), to: end.toISOString() }
    );
  } catch (error) {
    return next(error);
  }
};

export const getSalesAnalytics = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const start = startFor(request.query as any),
      end = (request.query as any).to || new Date(),
      match = { createdAt: { $gte: start, $lte: end } };
    const [series, statuses] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            orders: { $sum: 1 },
            grossSales: { $sum: '$total' },
            realizedRevenue: { $sum: { $cond: [REALIZED_EXPRESSION, '$total', 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([{ $match: match }, { $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
    ]);
    return sendSuccess(
      response,
      {
        salesByDate: series.map((x: any) => ({ date: x._id, orders: x.orders, grossSales: x.grossSales, realizedRevenue: x.realizedRevenue })),
        statusBreakdown: statuses.map((x: any) => ({ status: x._id, count: x.count })),
      },
      200,
      { from: start.toISOString(), to: end.toISOString() }
    );
  } catch (error) {
    return next(error);
  }
};
