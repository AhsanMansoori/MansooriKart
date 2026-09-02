import { Router, type NextFunction, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Address } from '../../models/address.js';
import { AuditLog } from '../../models/auditLog.js';
import { Cart } from '../../models/cart.js';
import { Order } from '../../models/order.js';
import { Refund } from '../../models/refund.js';
import { ReturnRequest } from '../../models/return.js';
import { Review } from '../../models/review.js';
import { User } from '../../models/user.js';
import { Wishlist } from '../../models/wishlist.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};
const audit = (request: any, action: string, resourceId: string, metadata: Record<string, unknown>) =>
  AuditLog.create({ actor: request.auth.userId, action, resourceType: 'Customer', resourceId, requestId: request.requestId, metadata });

/**
 * Only these user fields ever leave the ERP. Aggregation ignores Mongoose's
 * `select: false`, so the allowlist is an explicit inclusive projection: the
 * password hash, reset token hash and reset expiry are structurally unable to
 * appear in a response.
 */
const publicUserProjection = {
  _id: 1,
  name: 1,
  email: 1,
  phone: 1,
  avatar: 1,
  role: 1,
  status: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
const safeUserFields = 'name email phone avatar role status createdAt updatedAt';

const serializeCustomer = (document: any) => ({
  id: String(document._id),
  name: document.name ?? null,
  email: document.email ?? null,
  phone: document.phone ?? null,
  avatar: document.avatar ?? null,
  role: document.role,
  status: document.status,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

/** Revenue-bearing statuses. A cancelled order is never lifetime value. */
const REALIZED = { orderStatus: 'DELIVERED', paymentStatus: 'PAID' };

/**
 * Derives a customer segment from real order history only. Segments are
 * read-only reporting labels: nothing in this phase acts on them, and no
 * campaign, email, SMS or push mechanism is attached to them.
 */
const segmentFor = (stats: { totalOrders: number; realizedSpend: number; lastOrderAt: Date | null }, now: number) => {
  if (stats.totalOrders === 0) return 'PROSPECT';
  const daysSinceLastOrder = stats.lastOrderAt ? Math.floor((now - new Date(stats.lastOrderAt).getTime()) / 86_400_000) : null;
  if (daysSinceLastOrder !== null && daysSinceLastOrder > 180) return 'AT_RISK';
  if (stats.realizedSpend >= 100_000) return 'VIP';
  if (stats.totalOrders >= 3) return 'REPEAT';
  return 'NEW';
};

const orderStatsLookup = [
  {
    $lookup: {
      from: 'orders',
      localField: '_id',
      foreignField: 'customer',
      as: 'orderStats',
      pipeline: [{ $project: { total: 1, orderStatus: 1, paymentStatus: 1, createdAt: 1 } }],
    },
  },
  {
    $addFields: {
      totalOrders: { $size: '$orderStats' },
      grossSpend: { $ifNull: [{ $sum: '$orderStats.total' }, 0] },
      realizedSpend: {
        $ifNull: [
          {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$orderStats',
                    as: 'o',
                    cond: { $and: [{ $eq: ['$$o.orderStatus', REALIZED.orderStatus] }, { $eq: ['$$o.paymentStatus', REALIZED.paymentStatus] }] },
                  },
                },
                as: 'o',
                in: '$$o.total',
              },
            },
          },
          0,
        ],
      },
      cancelledOrders: { $size: { $filter: { input: '$orderStats', as: 'o', cond: { $eq: ['$$o.orderStatus', 'CANCELLED'] } } } },
      lastOrderAt: { $max: '$orderStats.createdAt' },
      firstOrderAt: { $min: '$orderStats.createdAt' },
    },
  },
  { $project: { ...publicUserProjection, totalOrders: 1, grossSpend: 1, realizedSpend: 1, cancelledOrders: 1, lastOrderAt: 1, firstOrderAt: 1 } },
];

const round = (value: number) => Number((value ?? 0).toFixed(2));
const withStats = (document: any, now: number) => {
  const stats = {
    totalOrders: document.totalOrders ?? 0,
    grossSpend: round(document.grossSpend),
    realizedSpend: round(document.realizedSpend),
    cancelledOrders: document.cancelledOrders ?? 0,
    lastOrderAt: document.lastOrderAt ?? null,
    firstOrderAt: document.firstOrderAt ?? null,
  };
  return {
    ...serializeCustomer(document),
    ...stats,
    averageOrderValue: stats.totalOrders ? round(stats.grossSpend / stats.totalOrders) : 0,
    segment: segmentFor(stats, now),
    currency: 'PKR',
  };
};

/* -------------------------------------------------------------------------- */
/* Customer list                                                               */
/* -------------------------------------------------------------------------- */

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    role: z.enum(['CUSTOMER', 'SUPER_ADMIN']).optional(),
    segment: z.enum(['PROSPECT', 'NEW', 'REPEAT', 'VIP', 'AT_RISK']).optional(),
    hasOrders: z.enum(['true', 'false']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sort: z.enum(['createdAt', 'name', 'email', 'totalOrders', 'realizedSpend', 'lastOrderAt']).default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

router.get('/customers', validate(listQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const query = request.query as z.infer<typeof listQuery>;
    const match: Record<string, unknown> = { role: query.role ?? 'CUSTOMER' };
    if (query.status) match['status'] = query.status;
    if (query.from || query.to) match['createdAt'] = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    if (query.search) {
      // Escaped so an operator-looking search value can only ever match literally.
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match['$or'] = [{ name: pattern }, { email: pattern }, { phone: pattern }];
    }
    const post: Record<string, unknown>[] = [];
    if (query.hasOrders === 'true') post.push({ $match: { totalOrders: { $gt: 0 } } });
    if (query.hasOrders === 'false') post.push({ $match: { totalOrders: 0 } });
    const rows = await User.aggregate([
      { $match: match },
      ...orderStatsLookup,
      ...post,
      { $sort: { [query.sort]: query.direction === 'asc' ? 1 : -1, _id: 1 } },
      { $facet: { data: [{ $skip: (query.page - 1) * query.limit }, { $limit: query.limit }], total: [{ $count: 'value' }] } },
    ]);
    const now = Date.now();
    const facet = rows[0] ?? { data: [], total: [] };
    const total = facet.total[0]?.value ?? 0;
    const data = facet.data.map((row: any) => withStats(row, now));
    return sendSuccess(response, query.segment ? data.filter((row: any) => row.segment === query.segment) : data, 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Customer analytics                                                          */
/* -------------------------------------------------------------------------- */

const analyticsQuery = z
  .object({ days: z.coerce.number().int().min(1).max(365).default(30), limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

router.get('/customers/analytics', validate(analyticsQuery, 'query'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const query = request.query as z.infer<typeof analyticsQuery>;
    const since = new Date(Date.now() - query.days * 86_400_000);
    const [counts, newCustomers, ranked] = await Promise.all([
      User.aggregate([{ $match: { role: 'CUSTOMER' } }, { $group: { _id: '$status', value: { $sum: 1 } } }]),
      User.countDocuments({ role: 'CUSTOMER', createdAt: { $gte: since } }),
      User.aggregate([{ $match: { role: 'CUSTOMER' } }, ...orderStatsLookup, { $sort: { realizedSpend: -1, _id: 1 } }, { $limit: 500 }]),
    ]);
    const now = Date.now();
    const enriched = ranked.map((row: any) => withStats(row, now));
    const segments = enriched.reduce((accumulator: Record<string, number>, row: any) => {
      accumulator[row.segment] = (accumulator[row.segment] ?? 0) + 1;
      return accumulator;
    }, {});
    const byStatus = counts.reduce((accumulator: Record<string, number>, row: any) => {
      accumulator[row._id] = row.value;
      return accumulator;
    }, {});
    const withOrders = enriched.filter((row: any) => row.totalOrders > 0);
    const repeat = enriched.filter((row: any) => row.totalOrders > 1).length;
    return sendSuccess(response, {
      totals: {
        customers: (byStatus['ACTIVE'] ?? 0) + (byStatus['SUSPENDED'] ?? 0),
        active: byStatus['ACTIVE'] ?? 0,
        suspended: byStatus['SUSPENDED'] ?? 0,
        newInPeriod: newCustomers,
        purchasing: withOrders.length,
        repeatPurchasers: repeat,
        repeatRate: withOrders.length ? round((repeat / withOrders.length) * 100) : 0,
        averageLifetimeValue: withOrders.length ? round(withOrders.reduce((sum: number, row: any) => sum + row.realizedSpend, 0) / withOrders.length) : 0,
      },
      segments: {
        PROSPECT: segments['PROSPECT'] ?? 0,
        NEW: segments['NEW'] ?? 0,
        REPEAT: segments['REPEAT'] ?? 0,
        VIP: segments['VIP'] ?? 0,
        AT_RISK: segments['AT_RISK'] ?? 0,
      },
      topCustomers: enriched.slice(0, query.limit),
      periodDays: query.days,
      currency: 'PKR',
    });
  } catch (error) {
    return next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Customer detail                                                             */
/* -------------------------------------------------------------------------- */

router.get('/customers/:id', validate(idParam, 'params'), async (request: any, response: Response, next: NextFunction) => {
  try {
    const { id } = request.params as { id: string };
    const customer = await User.findById(id).select(safeUserFields).lean();
    if (!customer) return sendFailure(response, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found.', request.requestId);
    const objectId = new Types.ObjectId(id);
    const orderIds = await Order.find({ customer: id }).select('_id').lean();
    const [aggregate, addresses, orders, cart, wishlist, reviews, returns, refunds] = await Promise.all([
      User.aggregate([{ $match: { _id: objectId } }, ...orderStatsLookup]),
      Address.find({ user: id }).sort({ isDefault: -1, createdAt: -1 }).limit(50).lean(),
      Order.find({ customer: id })
        .select('orderNumber invoiceNumber orderStatus paymentStatus paymentMethod total currency createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Cart.findOne({ user: id }).select('items updatedAt').lean(),
      Wishlist.findOne({ user: id }).select('products updatedAt').lean(),
      Review.find({ customer: id }).select('product rating title status createdAt').sort({ createdAt: -1 }).limit(20).lean(),
      ReturnRequest.find({ customer: id }).select('returnNumber order status createdAt').sort({ createdAt: -1 }).limit(20).lean(),
      // Refunds carry no customer reference; they are reached through the
      // customer's own orders so a refund can never be attributed to the wrong account.
      Refund.find({ order: { $in: orderIds.map((entry: any) => entry._id) } })
        .select('refundNumber order amount status createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);
    const stats = withStats({ ...customer, ...(aggregate[0] ?? {}) }, Date.now());
    return sendSuccess(response, {
      ...stats,
      addresses: addresses.map((address: any) => ({
        id: String(address._id),
        label: address.label ?? null,
        fullName: address.fullName ?? null,
        phone: address.phone ?? null,
        line1: address.addressLine1 ?? null,
        line2: address.addressLine2 ?? null,
        city: address.city ?? null,
        state: address.stateProvince ?? null,
        postalCode: address.postalCode ?? null,
        country: address.country ?? null,
        isDefault: Boolean(address.isDefault),
      })),
      recentOrders: orders.map((order: any) => ({
        id: String(order._id),
        orderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber ?? null,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        total: order.total,
        currency: order.currency ?? 'PKR',
        createdAt: order.createdAt,
      })),
      cart: cart
        ? {
            itemCount: (cart.items ?? []).reduce((sum: number, item: any) => sum + item.quantity, 0),
            distinctItems: (cart.items ?? []).length,
            updatedAt: cart.updatedAt,
          }
        : null,
      wishlist: wishlist ? { itemCount: (wishlist.products ?? []).length, updatedAt: wishlist.updatedAt } : null,
      reviews: reviews.map((review: any) => ({
        id: String(review._id),
        product: String(review.product),
        rating: review.rating,
        title: review.title ?? null,
        status: review.status,
        createdAt: review.createdAt,
      })),
      returns: returns.map((entry: any) => ({
        id: String(entry._id),
        returnNumber: entry.returnNumber,
        order: String(entry.order),
        status: entry.status,
        createdAt: entry.createdAt,
      })),
      refunds: refunds.map((entry: any) => ({
        id: String(entry._id),
        refundNumber: entry.refundNumber,
        order: String(entry.order),
        amount: entry.amount,
        status: entry.status,
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

const ordersQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

router.get(
  '/customers/:id/orders',
  validate(idParam, 'params'),
  validate(ordersQuery, 'query'),
  async (request: any, response: Response, next: NextFunction) => {
    try {
      const { id } = request.params as { id: string };
      const query = request.query as z.infer<typeof ordersQuery>;
      const customer = await User.findById(id).select('_id').lean();
      if (!customer) return sendFailure(response, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found.', request.requestId);
      const [rows, total] = await Promise.all([
        Order.find({ customer: id })
          .select('orderNumber invoiceNumber orderStatus paymentStatus paymentMethod total currency createdAt')
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        Order.countDocuments({ customer: id }),
      ]);
      return sendSuccess(
        response,
        rows.map((order: any) => ({
          id: String(order._id),
          orderNumber: order.orderNumber,
          invoiceNumber: order.invoiceNumber ?? null,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          total: order.total,
          currency: order.currency ?? 'PKR',
          createdAt: order.createdAt,
        })),
        200,
        meta(query.page, query.limit, total)
      );
    } catch (error) {
      return next(error);
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Account status                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The only mutation the Customers ERP exposes. `role` is deliberately absent
 * from the schema and from the update, so this endpoint cannot be used to grant
 * privileges: there is no admin route anywhere that writes `User.role`.
 */
const statusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(1).max(500).optional() }).strict();

router.patch(
  '/customers/:id/status',
  validate(idParam, 'params'),
  validate(statusBody, 'body'),
  async (request: any, response: Response, next: NextFunction) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof statusBody>;
      const existing = await User.findById(id).select('_id role status name email').lean();
      if (!existing) return sendFailure(response, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found.', request.requestId);
      if (existing.role === 'SUPER_ADMIN')
        return sendFailure(
          response,
          409,
          'CUSTOMER_STATUS_FORBIDDEN',
          'A Super Admin account cannot be suspended through the Customers ERP.',
          request.requestId
        );
      if (String(existing._id) === String(request.auth.userId))
        return sendFailure(response, 409, 'CUSTOMER_STATUS_FORBIDDEN', 'An account cannot change its own status.', request.requestId);
      if (existing.status === body.status)
        return sendFailure(response, 409, 'CUSTOMER_STATUS_UNCHANGED', `The customer is already ${body.status}.`, request.requestId);
      const updated = await User.findOneAndUpdate({ _id: id, role: 'CUSTOMER', status: existing.status }, { $set: { status: body.status } }, { new: true })
        .select(safeUserFields)
        .lean();
      if (!updated)
        return sendFailure(response, 409, 'CUSTOMER_STATUS_UNCHANGED', 'The customer status changed before the update was applied.', request.requestId);
      await audit(request, body.status === 'SUSPENDED' ? 'CUSTOMER_SUSPENDED' : 'CUSTOMER_REACTIVATED', id, {
        from: existing.status,
        to: body.status,
        reason: body.reason ?? null,
      });
      return sendSuccess(response, serializeCustomer(updated));
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
