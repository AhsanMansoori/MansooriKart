import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Order } from '../../models/order.js';
import { Product } from '../../models/product.js';
import { User } from '../../models/user.js';
import { sendSuccess } from '../../utils/api-response.js';

const router = express.Router();
const objectId = /^[a-f\d]{24}$/i;
const rangeSchema = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') }).strict();
const auditQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    actor: z.string().regex(objectId).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
const rangeStart = (range: '7d' | '30d' | '90d') => {
  const days = Number(range.slice(0, -1));
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
};
const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

router.use(requireAuth, requireSuperAdmin);

router.get('/dashboard', async (_request, response, next) => {
  try {
    const lowStock = { $expr: { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', 5] }] } };
    const [productCounts, orderCounts, totalCustomers, revenue, recentOrders, lowStockItems] = await Promise.all([
      Product.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      User.countDocuments({ role: 'CUSTOMER' }),
      Order.aggregate([{ $match: { orderStatus: 'DELIVERED', paymentStatus: 'PAID' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('orderNumber customer total currency paymentStatus orderStatus createdAt')
        .populate('customer', 'name email')
        .lean(),
      Product.find(lowStock).sort({ stock: 1, name: 1 }).limit(10).select('name slug sku stock lowStockThreshold status').lean(),
    ]);
    const products = Object.fromEntries(productCounts.map((entry: any) => [entry._id || 'ACTIVE', entry.count]));
    const orders = Object.fromEntries(orderCounts.map((entry: any) => [entry._id, entry.count]));
    return sendSuccess(response, {
      totalProducts: await Product.countDocuments(),
      activeProducts: products.ACTIVE || 0,
      draftProducts: products.DRAFT || 0,
      archivedProducts: products.ARCHIVED || 0,
      lowStockProducts: await Product.countDocuments(lowStock),
      outOfStockProducts: await Product.countDocuments({ stock: 0 }),
      totalOrders: await Order.countDocuments(),
      pendingOrders: orders.PENDING || 0,
      processingOrders: orders.PROCESSING || 0,
      shippedOrders: orders.SHIPPED || 0,
      deliveredOrders: orders.DELIVERED || 0,
      cancelledOrders: orders.CANCELLED || 0,
      totalCustomers,
      totalRevenue: revenue[0]?.total || 0,
      recentOrders,
      lowStockItems: lowStockItems.map((item: any) => ({ id: String(item._id), ...item })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/dashboard/sales', validate(rangeSchema, 'query'), async (request, response, next) => {
  try {
    const start = rangeStart((request.query as any).range);
    const data = await Order.aggregate([
      { $match: { createdAt: { $gte: start }, orderStatus: 'DELIVERED', paymentStatus: 'PAID' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return sendSuccess(
      response,
      data.map((entry: any) => ({ date: entry._id, revenue: entry.revenue, orders: entry.orders })),
      200,
      { range: (request.query as any).range }
    );
  } catch (error) {
    return next(error);
  }
});
router.get('/dashboard/orders', validate(rangeSchema, 'query'), async (request, response, next) => {
  try {
    const start = rangeStart((request.query as any).range);
    const data = await Order.aggregate([{ $match: { createdAt: { $gte: start } } }, { $group: { _id: '$orderStatus', count: { $sum: 1 } } }]);
    return sendSuccess(
      response,
      data.map((entry: any) => ({ status: entry._id, count: entry.count })),
      200,
      { range: (request.query as any).range }
    );
  } catch (error) {
    return next(error);
  }
});
router.get('/dashboard/products', validate(rangeSchema, 'query'), async (request, response, next) => {
  try {
    const start = rangeStart((request.query as any).range);
    const data = await Product.aggregate([{ $match: { createdAt: { $gte: start } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    return sendSuccess(
      response,
      data.map((entry: any) => ({ status: entry._id || 'ACTIVE', count: entry.count })),
      200,
      { range: (request.query as any).range }
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/audit-logs', validate(auditQuery, 'query'), async (request, response, next) => {
  try {
    const query = request.query as unknown as z.infer<typeof auditQuery>;
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    if (query.resourceType) filter.resourceType = query.resourceType;
    if (query.actor) filter.actor = query.actor;
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate('actor', 'name email role')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    return sendSuccess(
      response,
      data.map((entry: any) => ({
        id: String(entry._id),
        actor: entry.actor ? { id: String(entry.actor._id), name: entry.actor.name, email: entry.actor.email, role: entry.actor.role } : null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata || {},
        requestId: entry.requestId,
        createdAt: entry.createdAt,
      })),
      200,
      meta(query.page, query.limit, total)
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/system/health', (_request, response) =>
  sendSuccess(response, {
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || 'unknown',
  })
);

export default router;
