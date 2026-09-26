import express from 'express';
import { z } from 'zod';
import { CONTENT_LIMITS } from '../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Coupon } from '../../models/coupon.js';
import { CouponRedemption } from '../../models/couponRedemption.js';
import { Order } from '../../models/order.js';
import { adminCoupon } from '../../serializers/marketingAdmin.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId, normalizeCouponCode } from '../../utils/sanitize.js';

/**
 * Super-Admin management surface over the existing coupon authority.
 *
 * This router manages coupon *records*. It does not evaluate them: the discount a
 * customer actually receives is computed once, at checkout, by `orderService` — expiry,
 * start date, usage limit, per-customer limit, minimum order, percentage cap and the
 * maximum-discount ceiling all live there and are untouched by this file. There is
 * exactly one coupon system in MansooriKart and this is its admin API, not a second
 * implementation of it (§3).
 *
 * Editing a coupon never rewrites history. Every order stores its own coupon snapshot
 * (`code`, `type`, `value`, `actualDiscount`) at checkout, so changing a code's value —
 * or disabling it entirely — leaves past orders exactly as they were priced.
 */
const router = express.Router();
const MAX_MONEY = 100_000_000;
/** Codes are normalised before this test, so the pattern is deliberately uppercase-only. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

const fields = z
  .object({
    code: z.string().trim().min(2).max(64).optional(),
    type: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    value: z.number().positive().max(MAX_MONEY).optional(),
    minimumOrderAmount: z.number().min(0).max(MAX_MONEY).optional(),
    maximumDiscount: z.number().positive().max(MAX_MONEY).optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    usageLimit: z.number().int().positive().max(1_000_000).optional(),
    perCustomerLimit: z.number().int().positive().max(1_000_000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

/**
 * Cross-field coupon rules, applied to the *merged* record on update so a patch cannot
 * create an invalid combination one field at a time. A past `expiresAt` is allowed —
 * an expired coupon is a legitimate historical record, and checkout already refuses it.
 */
const valid = (v: any) => !((v.type === 'PERCENTAGE' && v.value > 100) || (v.startsAt && v.expiresAt && new Date(v.startsAt) >= new Date(v.expiresAt)));

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(CONTENT_LIMITS.defaultPageSize),
    state: z.enum(['ACTIVE', 'DISABLED', 'SCHEDULED', 'EXPIRED', 'EXHAUSTED']).optional(),
    type: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    code: z.string().trim().min(1).max(64).optional(),
    search: z.string().trim().min(1).max(64).optional(),
    sort: z.enum(['newest', 'oldest', 'code', 'value_desc', 'usage_desc', 'expiring']).default('newest'),
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

/** Sort orders are chosen from this map, so no caller-supplied field ever reaches Mongo. */
const sorts: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  code: { code: 1 },
  value_desc: { value: -1 },
  usage_desc: { usageCount: -1 },
  expiring: { expiresAt: 1 },
};

/**
 * Translates a lifecycle state into a Mongo filter.
 *
 * EXHAUSTED needs `$expr` because it compares two fields of the same document; the
 * expression is built from constants only, never from request input.
 */
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

const audit = (r: any, action: string, coupon: any, metadata: Record<string, unknown> = {}) =>
  AuditLog.create({
    actor: r.auth.userId,
    action,
    resourceType: 'Coupon',
    resourceId: String(coupon._id),
    requestId: r.requestId,
    metadata: { code: coupon.code, enabled: coupon.enabled, ...metadata },
  });
const notFound = (r: any, s: any) => sendFailure(s, 404, 'COUPON_NOT_FOUND', 'Coupon not found.', r.requestId);

router.use(requireAuth, requireSuperAdmin);

router.get('/coupons', validate(listQuery, 'query'), async (r, s, n) => {
  try {
    const query = r.query as unknown as z.infer<typeof listQuery>;
    const now = new Date();
    const filter: Record<string, unknown> = { ...stateFilter(query.state, now) };
    if (query.type) filter.type = query.type;
    // Code lookups are escaped prefix matches: a caller cannot smuggle regex syntax or a
    // Mongo operator through either parameter.
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
      s,
      data.map((coupon: any) => adminCoupon(coupon, now)),
      200,
      { page: query.page, limit: query.limit, total, totalPages, hasNextPage: query.page < totalPages, hasPreviousPage: query.page > 1 }
    );
  } catch (e) {
    return n(e);
  }
});

router.post('/coupons', validate(fields.refine(v => v.code && v.type && v.value !== undefined, 'code, type and value are required')), async (r, s, n) => {
  try {
    // The 409 below comes from the `code` unique index, so its build is awaited first.
    await Coupon.init();
    const code = normalizeCouponCode(r.body.code);
    if (!CODE_PATTERN.test(code))
      return sendFailure(s, 400, 'COUPON_INVALID', 'Coupon code may contain only letters, digits, hyphen and underscore.', r.requestId);
    const value = { ...r.body, code };
    if (!valid(value)) return sendFailure(s, 400, 'COUPON_INVALID', 'Coupon values are invalid.', r.requestId);
    const coupon = await Coupon.create(value);
    await audit(r, 'COUPON_CREATED', coupon);
    return sendSuccess(s, adminCoupon(coupon.toObject()), 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'COUPON_CODE_EXISTS', 'A coupon with that code already exists.', r.requestId);
    return n(e);
  }
});
router.get('/coupons/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return notFound(r, s);
    const coupon = await Coupon.findById(r.params.id).lean();
    return coupon ? sendSuccess(s, adminCoupon(coupon)) : notFound(r, s);
  } catch {
    return notFound(r, s);
  }
});

/**
 * Usage statistics for one coupon.
 *
 * Redemption counts come from `CouponRedemption` (the per-customer ledger checkout
 * writes) and the money figure comes from the `coupon.actualDiscount` snapshot on each
 * order — never recomputed from the coupon's *current* value, because that would
 * misreport what past customers were actually given.
 */
router.get('/coupons/:id/usage', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return notFound(r, s);
    const coupon = await Coupon.findById(r.params.id).lean();
    if (!coupon) return notFound(r, s);
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
    return sendSuccess(s, {
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
  } catch (e) {
    return n(e);
  }
});

router.patch('/coupons/:id', validate(fields), async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return notFound(r, s);
    const existing = await Coupon.findById(r.params.id);
    if (!existing) return notFound(r, s);
    const patch: Record<string, unknown> = { ...r.body };
    if (patch.code !== undefined) {
      const code = normalizeCouponCode(String(patch.code));
      if (!CODE_PATTERN.test(code))
        return sendFailure(s, 400, 'COUPON_INVALID', 'Coupon code may contain only letters, digits, hyphen and underscore.', r.requestId);
      patch.code = code;
    }
    if (!valid({ ...existing.toObject(), ...patch })) return sendFailure(s, 400, 'COUPON_INVALID', 'Coupon values are invalid.', r.requestId);
    // A patch that changes nothing writes no audit entry: the trail records decisions,
    // not requests (§59).
    const changed = Object.entries(patch).filter(([key, value]) => {
      const current = (existing as any)[key];
      return value instanceof Date || current instanceof Date ? String(current ?? '') !== String(value ?? '') : current !== value;
    });
    Object.assign(existing, patch);
    await existing.save();
    if (changed.length) await audit(r, existing.enabled ? 'COUPON_UPDATED' : 'COUPON_DISABLED', existing, { fields: changed.map(([key]) => key) });
    return sendSuccess(s, adminCoupon(existing.toObject()));
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'COUPON_CODE_EXISTS', 'A coupon with that code already exists.', r.requestId);
    return n(e);
  }
});

/** Explicit activate/disable. Idempotent: re-issuing the same state writes no audit entry. */
for (const [path, enabled, action] of [
  ['activate', true, 'COUPON_ENABLED'],
  ['disable', false, 'COUPON_DISABLED'],
] as const) {
  router.post(`/coupons/:id/${path}`, async (r, s, n) => {
    try {
      if (!isObjectId(r.params.id)) return notFound(r, s);
      const coupon = await Coupon.findById(r.params.id);
      if (!coupon) return notFound(r, s);
      const changed = Boolean(coupon.enabled) !== enabled;
      if (changed) {
        coupon.enabled = enabled;
        await coupon.save();
        await audit(r, action, coupon);
      }
      return sendSuccess(s, adminCoupon(coupon.toObject()));
    } catch (e) {
      return n(e);
    }
  });
}

/**
 * Soft archive. A coupon is never deleted: redemptions and order snapshots reference it,
 * so it is disabled instead and stops validating at checkout.
 */
router.delete('/coupons/:id', async (r, s, n) => {
  try {
    if (!isObjectId(r.params.id)) return notFound(r, s);
    const coupon = await Coupon.findById(r.params.id);
    if (!coupon) return notFound(r, s);
    coupon.enabled = false;
    await coupon.save();
    await audit(r, 'COUPON_ARCHIVED', coupon);
    return sendSuccess(s, { id: String(coupon._id), archived: true });
  } catch (e) {
    return n(e);
  }
});
export default router;
