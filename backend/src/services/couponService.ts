import { Coupon } from '../models/coupon.js';
import { getCart } from './cartService.js';
export class CouponError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
const money = (value: number) => Number(value.toFixed(2));
export async function previewCoupon(userId: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code }).lean();
  if (!coupon) throw new CouponError('COUPON_INVALID', 'Coupon is invalid.');
  const now = new Date();
  if (
    !coupon.enabled ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.expiresAt && coupon.expiresAt <= now) ||
    (coupon.usageLimit !== undefined && coupon.usageCount >= coupon.usageLimit)
  )
    throw new CouponError('COUPON_UNAVAILABLE', 'Coupon is not available.');
  const cart = await getCart(userId);
  const subtotal = cart.subtotal;
  if (subtotal < (coupon.minimumOrderAmount || 0)) throw new CouponError('COUPON_MINIMUM_NOT_MET', 'Cart does not meet the coupon minimum.');
  let discount = coupon.type === 'PERCENTAGE' ? subtotal * (coupon.value / 100) : coupon.value;
  if (coupon.maximumDiscount !== undefined) discount = Math.min(discount, coupon.maximumDiscount);
  discount = money(Math.min(discount, subtotal));
  return {
    valid: true,
    code: coupon.code,
    type: coupon.type,
    subtotalBeforeDiscount: subtotal,
    discountAmount: discount,
    subtotalAfterDiscount: money(subtotal - discount),
  };
}
