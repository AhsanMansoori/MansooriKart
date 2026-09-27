import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AuditLog } from '../../models/auditLog.js';
import { Coupon } from '../../models/coupon.js';
import { CouponRedemption } from '../../models/couponRedemption.js';
import { Order } from '../../models/order.js';
import { adminCoupon } from '../../serializers/marketingAdmin.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId, normalizeCouponCode } from '../../utils/sanitize.js';

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

export const valid = (v: any) => !((v.type === 'PERCENTAGE' && v.value > 100) || (v.startsAt && v.expiresAt && new Date(v.startsAt) >= new Date(v.expiresAt)));

const sorts: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  code: { code: 1 },
  value_desc: { value: -1 },
  usage_desc: { usageCount: -1 },
  expiring: { expiresAt: 1 },
};

function stateFilter(state: string | undefined, now: Date): Record<string, unknown> {
  if (state === 'DISABLED') return { enabled: false };
  if (state === 'EXPIRED') return { expiresAt: { $lte: now } };
  if (state === 'SCHEDULED') return { enabled: true, startsAt: { $gt: now } };
  if (state === 'EXHAUSTED') return { usageLimit: { $ne: null }, $expr: { $gte: ['$usageCount', '$usageLimit'] } };
  if (state === 'ACTIVE')
    return {
      enabled: true,
      $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
    };
  return {};
}

const audit = (request: Request, action: string, coupon: any, metadata: Record<string, unknown> = {}) =>
  AuditLog.create({
    actor: request.auth!.userId,
    action,
    resourceType: 'Coupon',
    resourceId: String(coupon._id),
    requestId: request.requestId,
    metadata: { code: coupon.code, enabled: coupon.enabled, ...metadata },
  });

const notFound = (request: Request, response: Response) => sendFailure(response, 404, 'COUPON_NOT_FOUND', 'Coupon not found.', request.requestId);

export const listCoupons = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const now = new Date();
    const filter: Record<string, unknown> = { ...stateFilter(query.state, now) };
    if (query.type) filter.type = query.type;
    const term = query.code ?? query.search;
    if (term) filter.code = { $regex: new RegExp(`^${escapeRegex(normalizeCouponCode(term))}`) };
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      Coupon.find(filter)
        .sort(sorts[query.sort] ?? sorts.newest)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Coupon.countDocuments(filter),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return sendSuccess(
      response,
      data.map((coupon: any) => adminCoupon(coupon, now)),
      200,
      { page: query.page, limit: query.limit, total, totalPages, hasNextPage: query.page < totalPages, hasPreviousPage: query.page > 1 }
    );
  } catch (error) {
    return next(error);
  }
};

export const createCoupon = async (request: Request, response: Response, next: NextFunction) => {
  try {
    await Coupon.init();
    const code = normalizeCouponCode(request.body.code);
    if (!CODE_PATTERN.test(code))
      return sendFailure(response, 400, 'COUPON_INVALID', 'Coupon code may contain only letters, digits, hyphen and underscore.', request.requestId);
    const value = { ...request.body, code };
    if (!valid(value)) return sendFailure(response, 400, 'COUPON_INVALID', 'Coupon values are invalid.', request.requestId);
    const coupon = await Coupon.create(value);
    await audit(request, 'COUPON_CREATED', coupon);
    return sendSuccess(response, adminCoupon(coupon.toObject()), 201);
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'COUPON_CODE_EXISTS', 'A coupon with that code already exists.', request.requestId);
    return next(error);
  }
};

export const getCouponById = async (request: Request, response: Response) => {
  try {
    if (!isObjectId(request.params.id)) return notFound(request, response);
    const coupon = await Coupon.findById(request.params.id).lean();
    return coupon ? sendSuccess(response, adminCoupon(coupon)) : notFound(request, response);
  } catch {
    return notFound(request, response);
  }
};

export const getCouponUsage = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return notFound(request, response);
    const coupon = await Coupon.findById(request.params.id).lean();
    if (!coupon) return notFound(request, response);
    const [redemptions, customers, orderStats, recent] = await Promise.all([
      CouponRedemption.countDocuments({ coupon: coupon._id }),
      CouponRedemption.distinct('customer', { coupon: coupon._id }),
      Order.aggregate([
        { $match: { 'coupon.couponId': coupon._id } },
        { $group: { _id: null, orders: { $sum: 1 }, discount: { $sum: { $ifNull: ['$coupon.actualDiscount', 0] } }, revenue: { $sum: '$total' } } },
      ]),
      Order.find({ 'coupon.couponId': coupon._id }).sort({ createdAt: -1 }).limit(1).select('createdAt').lean(),
    ]);
    const stats = orderStats[0] ?? { orders: 0, discount: 0, revenue: 0 };
    return sendSuccess(response, {
      coupon: adminCoupon(coupon),
      usageCount: coupon.usageCount ?? 0,
      usageLimit: coupon.usageLimit ?? null,
      remainingUses: coupon.usageLimit === undefined || coupon.usageLimit === null ? null : Math.max(0, coupon.usageLimit - (coupon.usageCount ?? 0)),
      redemptions,
      distinctCustomers: (customers as unknown[]).length,
      orders: stats.orders,
      totalDiscountGiven: Number((stats.discount ?? 0).toFixed(2)),
      orderRevenue: Number((stats.revenue ?? 0).toFixed(2)),
      lastUsedAt: recent[0]?.createdAt ?? null,
    });
  } catch (error) {
    return next(error);
  }
};

export const patchCoupon = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return notFound(request, response);
    const existing = await Coupon.findById(request.params.id);
    if (!existing) return notFound(request, response);
    const patch: Record<string, unknown> = { ...request.body };
    if (patch.code !== undefined) {
      const code = normalizeCouponCode(String(patch.code));
      if (!CODE_PATTERN.test(code))
        return sendFailure(response, 400, 'COUPON_INVALID', 'Coupon code may contain only letters, digits, hyphen and underscore.', request.requestId);
      patch.code = code;
    }
    if (!valid({ ...existing.toObject(), ...patch })) return sendFailure(response, 400, 'COUPON_INVALID', 'Coupon values are invalid.', request.requestId);
    const changed = Object.entries(patch).filter(([key, value]) => {
      const current = (existing as any)[key];
      return value instanceof Date || current instanceof Date ? String(current ?? '') !== String(value ?? '') : current !== value;
    });
    Object.assign(existing, patch);
    await existing.save();
    if (changed.length) await audit(request, existing.enabled ? 'COUPON_UPDATED' : 'COUPON_DISABLED', existing, { fields: changed.map(([key]) => key) });
    return sendSuccess(response, adminCoupon(existing.toObject()));
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'COUPON_CODE_EXISTS', 'A coupon with that code already exists.', request.requestId);
    return next(error);
  }
};

export const activateCoupon = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return notFound(request, response);
    const coupon = await Coupon.findById(request.params.id);
    if (!coupon) return notFound(request, response);
    const changed = Boolean(coupon.enabled) !== true;
    if (changed) {
      coupon.enabled = true;
      await coupon.save();
      await audit(request, 'COUPON_ENABLED', coupon);
    }
    return sendSuccess(response, adminCoupon(coupon.toObject()));
  } catch (error) {
    return next(error);
  }
};

export const disableCoupon = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return notFound(request, response);
    const coupon = await Coupon.findById(request.params.id);
    if (!coupon) return notFound(request, response);
    const changed = Boolean(coupon.enabled) !== false;
    if (changed) {
      coupon.enabled = false;
      await coupon.save();
      await audit(request, 'COUPON_DISABLED', coupon);
    }
    return sendSuccess(response, adminCoupon(coupon.toObject()));
  } catch (error) {
    return next(error);
  }
};

export const deleteCoupon = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return notFound(request, response);
    const coupon = await Coupon.findById(request.params.id);
    if (!coupon) return notFound(request, response);
    coupon.enabled = false;
    await coupon.save();
    await audit(request, 'COUPON_ARCHIVED', coupon);
    return sendSuccess(response, { id: String(coupon._id), archived: true });
  } catch (error) {
    return next(error);
  }
};
