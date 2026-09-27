import type { NextFunction, Request, Response } from 'express';
import { Cart } from '../../models/cart.js';
import { Product } from '../../models/product.js';
import { sendSuccess } from '../../utils/api-response.js';

export const listAbandonedCarts = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const { page, limit, olderThanHours } = request.query as unknown as { page: number; limit: number; olderThanHours: number };
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
    return sendSuccess(response, data, 200, {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      olderThanHours,
      valuation: 'CURRENT_CATALOG_PRICE',
    });
  } catch (error) {
    return next(error);
  }
};
