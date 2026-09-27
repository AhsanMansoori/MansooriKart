import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import type { z } from 'zod';
import { REALIZED_ORDER } from '../../services/financeService.js';
import { getConfig } from '../../config/env.js';
import { AuditLog } from '../../models/auditLog.js';
import { Order } from '../../models/order.js';
import { Product } from '../../models/product.js';
import { User } from '../../models/user.js';
import { auditEntry } from '../../serializers/marketingAdmin.js';
import { getStoreConfiguration } from '../../services/storeConfigService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId } from '../../utils/sanitize.js';

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

export const getDashboard = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const lowStock = { $expr: { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', 5] }] } };
    const [productCounts, orderCounts, totalCustomers, revenue, recentOrders, lowStockItems] = await Promise.all([
      Product.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      User.countDocuments({ role: 'CUSTOMER' }),
      Order.aggregate([{ $match: { ...REALIZED_ORDER } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
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
};

export const getDashboardSales = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const start = rangeStart((request.query as any).range);
    const data = await Order.aggregate([
      { $match: { createdAt: { $gte: start }, ...REALIZED_ORDER } },
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
};

export const getDashboardOrders = async (request: Request, response: Response, next: NextFunction) => {
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
};

export const getDashboardProducts = async (request: Request, response: Response, next: NextFunction) => {
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
};

export const getAuditActions = async (_request: Request, response: Response, next: NextFunction) => {
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
};

export const listAuditLogs = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    if (query.resourceType) filter.resourceType = query.resourceType;
    if (query.resourceId) filter.resourceId = query.resourceId;
    if (query.actor) filter.actor = query.actor;
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
};

export const getAuditLogById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return sendFailure(response, 404, 'AUDIT_LOG_NOT_FOUND', 'Audit entry not found.', request.requestId);
    const entry = await AuditLog.findById(request.params.id).populate('actor', 'name email role').lean();
    if (!entry) return sendFailure(response, 404, 'AUDIT_LOG_NOT_FOUND', 'Audit entry not found.', request.requestId);
    return sendSuccess(response, auditEntry(entry));
  } catch (error) {
    return next(error);
  }
};

export const getSystemHealth = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const readyState = mongoose.connection.readyState;
    const databaseConnected = readyState === 1;
    const config = databaseConnected ? await getStoreConfiguration().catch(() => null) : null;
    const { nodeEnv, appVersion } = getConfig();
    return sendSuccess(response, {
      status: databaseConnected ? 'ok' : 'degraded',
      api: 'ok',
      database: databaseConnected ? 'connected' : 'disconnected',
      databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][readyState] ?? 'unknown',
      uptimeSeconds: Math.floor(process.uptime()),
      environment: nodeEnv,
      version: appVersion,
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
};
