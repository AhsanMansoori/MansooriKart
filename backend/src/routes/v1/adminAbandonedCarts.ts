import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Cart } from '../../models/cart.js';
import { Product } from '../../models/product.js';
import { sendSuccess } from '../../utils/api-response.js';

/**
 * Abandoned cart foundation (operational visibility only).
 *
 * Derived from the persisted authenticated Cart — no cart data is duplicated into a second
 * collection. A cart counts as abandoned when it still holds at least one item and has had no
 * activity for longer than the inactivity threshold. Checkout empties the cart, so a cart that is
 * still non-empty has not converted into an order.
 *
 * Anonymous carts are held client-side only and are never persisted server-side, so anonymous
 * abandonment is DEFERRED rather than fabricated.
 *
 * Recovery campaigns (email/SMS/push) are deliberately out of scope: they belong to Marketing.
 */

const router = express.Router();

export const DEFAULT_ABANDONED_AFTER_HOURS = 24;

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    olderThanHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(DEFAULT_ABANDONED_AFTER_HOURS),
  })
  .strict();

router.use(requireAuth, requireSuperAdmin);

router.get('/abandoned-carts', validate(listQuery, 'query'), async (r, s, n) => {
  try {
    const { page, limit, olderThanHours } = r.query as unknown as { page: number; limit: number; olderThanHours: number };
    const threshold = new Date(Date.now() - olderThanHours * 3600000);
    const filter = { 'items.0': { $exists: true }, updatedAt: { $lte: threshold } };
    const [carts, total] = await Promise.all([
      Cart.find(filter)
        .sort({ updatedAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name email')
        .lean(),
      Cart.countDocuments(filter),
    ]);
    const productIds = carts.flatMap((cart: any) => (cart.items ?? []).map((item: any) => item.product));
    const products = await Product.find({ _id: { $in: productIds } })
      .select('price status')
      .lean();
    const catalog = new Map<string, any>(products.map((product: any) => [String(product._id), product]));
    const data = carts.map((cart: any) => {
      let estimatedValue = 0;
      let itemCount = 0;
      for (const item of cart.items ?? []) {
        itemCount += Number(item.quantity ?? 0);
        // Server-authoritative valuation: current catalog price, never a stored or client-supplied
        // price. This is an estimate of present value and is NOT historical order pricing, which is
        // always read from the immutable order snapshot instead.
        const product = catalog.get(String(item.product));
        if (product && product.status === 'ACTIVE') estimatedValue += Number(product.price ?? 0) * Number(item.quantity ?? 0);
      }
      return {
        cartId: String(cart._id),
        customer: cart.user ? { id: String(cart.user._id ?? cart.user), name: cart.user.name ?? null, email: cart.user.email ?? null } : null,
        itemCount,
        distinctItems: (cart.items ?? []).length,
        estimatedValue: Number(estimatedValue.toFixed(2)),
        currency: 'PKR',
        lastActivityAt: cart.updatedAt,
        ageHours: Math.floor((Date.now() - new Date(cart.updatedAt).getTime()) / 3600000),
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
      };
    });
    return sendSuccess(s, data, 200, {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      olderThanHours,
      valuation: 'CURRENT_CATALOG_PRICE',
    });
  } catch (e) {
    return n(e);
  }
});

export default router;
