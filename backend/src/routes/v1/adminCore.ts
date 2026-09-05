import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { CONTENT_LIMITS } from '../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Order } from '../../models/order.js';
import { Product } from '../../models/product.js';
import { User } from '../../models/user.js';
import { auditEntry } from '../../serializers/marketingAdmin.js';
import { getStoreConfiguration } from '../../services/storeConfigService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId } from '../../utils/sanitize.js';

const router = express.Router();
const objectId = /^[a-f\d]{24}$/i;
const rangeSchema = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') }).strict();
/**
 * Audit trail filters.
 *
 * Every filter is an allowlisted field compared by equality, an escaped prefix search or
 * a bounded date range — there is no path a caller can use to inject a Mongo operator,
 * and `sort` selects from two fixed orders rather than accepting a field name. The date
 * range is validated as a range, not just as two dates: `from` must not follow `to`, and
 * the span is capped so one request cannot scan the entire trail.
 */
const auditQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(20),
    action: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    actor: z.string().regex(objectId).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from.getTime() > value.to.getTime())
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: '`from` must not be after `to`.' });
    if (value.from && value.to && value.to.getTime() - value.from.getTime() > CONTENT_LIMITS.maxDateRangeDays * 86_400_000)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `Date range must not exceed ${CONTENT_LIMITS.maxDateRangeDays} days.` });
  });
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

/**
 * Distinct action vocabulary, so an operator can build a filter without guessing.
 * Declared before `/audit-logs/:id` so `actions` is never read as an identifier.
 */
router.get('/audit-logs/actions', async (_request, response, next) => {
  try {
    const actions = await AuditLog.distinct('action');
    const resourceTypes = await AuditLog.distinct('resourceType');
    return sendSuccess(response, {
      actions: (actions as string[]).filter(Boolean).sort().slice(0, 500),
      resourceTypes: (resourceTypes as string[]).filter(Boolean).sort().slice(0, 200),
    });
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
    if (query.resourceId) filter.resourceId = query.resourceId;
    if (query.actor) filter.actor = query.actor;
    // Search is an escaped, anchored regex over the action name only. Escaping is what
    // stops `.*` or `$where`-shaped input from becoming a query the caller controls.
    if (query.search) filter.action = { $regex: new RegExp(`^${escapeRegex(query.search)}`, 'i') };
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: query.sort === 'oldest' ? 1 : -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate('actor', 'name email role')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    return sendSuccess(response, data.map(auditEntry), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
});

/** Single entry. A malformed id is a clean 404, never a CastError. */
router.get('/audit-logs/:id', async (request, response, next) => {
  try {
    if (!isObjectId(request.params.id)) return sendFailure(response, 404, 'AUDIT_LOG_NOT_FOUND', 'Audit entry not found.', request.requestId);
    const entry = await AuditLog.findById(request.params.id).populate('actor', 'name email role').lean();
    if (!entry) return sendFailure(response, 404, 'AUDIT_LOG_NOT_FOUND', 'Audit entry not found.', request.requestId);
    return sendSuccess(response, auditEntry(entry));
  } catch (error) {
    return next(error);
  }
});

/**
 * Operational health for the Super Admin console.
 *
 * Everything published here is a status, a count or a label. There is deliberately no
 * connection string, no environment dump, no secret and no stack trace: `environment` is
 * narrowed to a known label rather than echoed, and `version` comes from an explicit
 * `APP_VERSION` rather than from reading the filesystem (§40).
 */
router.get('/system/health', async (_request, response, next) => {
  try {
    const readyState = mongoose.connection.readyState;
    const databaseConnected = readyState === 1;
    const config = databaseConnected ? await getStoreConfiguration().catch(() => null) : null;
    const environment = ['development', 'test', 'production'].includes(String(process.env.NODE_ENV)) ? String(process.env.NODE_ENV) : 'development';
    return sendSuccess(response, {
      status: databaseConnected ? 'ok' : 'degraded',
      api: 'ok',
      database: databaseConnected ? 'connected' : 'disconnected',
      databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][readyState] ?? 'unknown',
      uptimeSeconds: Math.floor(process.uptime()),
      environment,
      version: process.env.APP_VERSION || 'unknown',
      timestamp: new Date().toISOString(),
      store: { configured: Boolean(config), maintenanceMode: Boolean(config?.maintenanceMode) },
      checks: [
        { name: 'api', status: 'ok' },
        { name: 'database', status: databaseConnected ? 'ok' : 'fail' },
        { name: 'storeConfiguration', status: config ? 'ok' : 'unknown' },
      ],
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
