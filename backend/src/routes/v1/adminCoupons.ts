import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Coupon } from '../../models/coupon.js';
import { AuditLog } from '../../models/auditLog.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
const router = express.Router();
const fields = z
  .object({
    code: z.string().trim().min(2).max(64).optional(),
    type: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    value: z.number().positive().optional(),
    minimumOrderAmount: z.number().min(0).optional(),
    maximumDiscount: z.number().positive().optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    usageLimit: z.number().int().positive().optional(),
    perCustomerLimit: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const valid = (v: any) => !((v.type === 'PERCENTAGE' && v.value > 100) || (v.startsAt && v.expiresAt && v.startsAt >= v.expiresAt));
const audit = (r: any, action: string, coupon: any) =>
  AuditLog.create({
    actor: r.auth.userId,
    action,
    resourceType: 'Coupon',
    resourceId: String(coupon._id),
    requestId: r.requestId,
    metadata: { code: coupon.code, enabled: coupon.enabled },
  });
router.use(requireAuth, requireSuperAdmin);
router.get('/coupons', async (r, s, n) => {
  try {
    const page = Math.max(1, Number(r.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(r.query.limit) || 20));
    const [data, total] = await Promise.all([
      Coupon.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Coupon.countDocuments(),
    ]);
    return sendSuccess(s, data, 200, {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    });
  } catch (e) {
    return n(e);
  }
});
router.post('/coupons', validate(fields.refine(v => v.code && v.type && v.value !== undefined, 'code, type and value are required')), async (r, s, n) => {
  try {
    const value = { ...r.body, code: r.body.code.toUpperCase() };
    if (!valid(value)) return sendFailure(s, 400, 'COUPON_INVALID', 'Coupon values are invalid.', r.requestId);
    const coupon = await Coupon.create(value);
    await audit(r, 'COUPON_CREATED', coupon);
    return sendSuccess(s, coupon, 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'COUPON_CODE_EXISTS', 'A coupon with that code already exists.', r.requestId);
    return n(e);
  }
});
router.get('/coupons/:id', async (r, s, n) => {
  try {
    const coupon = await Coupon.findById(r.params.id).lean();
    return coupon ? sendSuccess(s, coupon) : sendFailure(s, 404, 'COUPON_NOT_FOUND', 'Coupon not found.', r.requestId);
  } catch (e) {
    return sendFailure(s, 404, 'COUPON_NOT_FOUND', 'Coupon not found.', r.requestId);
  }
});
router.patch('/coupons/:id', validate(fields), async (r, s, n) => {
  try {
    const existing = await Coupon.findById(r.params.id);
    if (!existing) return sendFailure(s, 404, 'COUPON_NOT_FOUND', 'Coupon not found.', r.requestId);
    const next = { ...existing.toObject(), ...r.body, ...(r.body.code ? { code: r.body.code.toUpperCase() } : {}) };
    if (!valid(next)) return sendFailure(s, 400, 'COUPON_INVALID', 'Coupon values are invalid.', r.requestId);
    Object.assign(existing, r.body, r.body.code ? { code: r.body.code.toUpperCase() } : {});
    await existing.save();
    await audit(r, existing.enabled ? 'COUPON_UPDATED' : 'COUPON_DISABLED', existing);
    return sendSuccess(s, existing);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'COUPON_CODE_EXISTS', 'A coupon with that code already exists.', r.requestId);
    return n(e);
  }
});
router.delete('/coupons/:id', async (r, s, n) => {
  try {
    const coupon = await Coupon.findById(r.params.id);
    if (!coupon) return sendFailure(s, 404, 'COUPON_NOT_FOUND', 'Coupon not found.', r.requestId);
    coupon.enabled = false;
    await coupon.save();
    await audit(r, 'COUPON_ARCHIVED', coupon);
    return sendSuccess(s, { id: String(coupon._id), archived: true });
  } catch (e) {
    return n(e);
  }
});
export default router;
