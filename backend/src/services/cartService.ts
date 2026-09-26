import { withAvailability } from './productAvailability.js';
import crypto from 'node:crypto';
import { atomic } from './transaction.js';
import { CartSync } from '../models/cartSync.js';
import { BLOCKING_SUPPLIER_AVAILABILITY } from '../config/dropshipping.js';
import { Cart } from '../models/cart.js';
import { Product } from '../models/product.js';
import { SupplierCatalogItem } from '../models/supplierCatalogItem.js';
import * as serialize from '../serializers/index.js';

const active = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
export class CartError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function loadProduct(productId: string) {
  const product = await Product.findOne({ _id: productId, ...active }).lean();
  if (!product) throw new CartError('PRODUCT_NOT_FOUND', 'Product not found.');
  return product;
}

/**
 * Availability check for one cart line.
 *
 * Own stock is bounded by the warehouse balance mirrored on the product, exactly as
 * before. A dropship line has no warehouse balance at all, so it is checked against the
 * supplier feed instead: it needs an active supplier source, and only an explicit
 * OUT_OF_STOCK blocks. `UNKNOWN` or stale-but-positive supplier stock does not block —
 * a feed that reports no quantity is not evidence of absence, and supplier-reported
 * availability is advisory by definition (§24, §29).
 */
async function assertAvailable(product: any, quantity: number): Promise<void> {
  if (product.fulfillmentType !== 'DROPSHIP') {
    if (quantity > (await withAvailability([product]))[0].publicAvailability.availableStock)
      throw new CartError('INSUFFICIENT_STOCK', 'Requested quantity is not available.');
    return;
  }
  const sources = await SupplierCatalogItem.find({ product: product._id, isActive: true }).select('supplierAvailability').lean();
  if (!sources.length) throw new CartError('SUPPLIER_UNAVAILABLE', 'This product has no active supplier source.');
  if (sources.every((source: any) => BLOCKING_SUPPLIER_AVAILABILITY.includes(String(source.supplierAvailability ?? 'UNKNOWN'))))
    throw new CartError('SUPPLIER_OUT_OF_STOCK', 'This product is out of stock at the supplier.');
}

/**
 * The customer's cart.
 *
 * Each line's product goes through the public serializer rather than being handed back as
 * the stored document. A cart is a customer-facing surface, and for a DROPSHIP product
 * `costPrice` *is* the supplier's cost, so returning the raw document would put supplier
 * economics — along with `fulfillmentType`, `sourceType` and `sellingPriceOverridden` — in
 * front of the shopper (§30, §56). `_id` is kept beside the serializer's `id` because the
 * existing cart contract exposes it and clients key off it.
 */
export async function getCart(userId: string) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product').lean();
  const enriched = await withAvailability((cart?.items ?? []).map((item: any) => item.product).filter(Boolean));
  const items = (cart?.items || [])
    .filter((item: any) => item.product)
    .map((item: any) => ({
      product: { _id: item.product._id, ...serialize.product(enriched.find((product: any) => String(product._id) === String(item.product._id))) },
      quantity: item.quantity,
      unitPrice: item.product.price,
      lineSubtotal: Number((item.product.price * item.quantity).toFixed(2)),
    }));
  return { items, subtotal: Number(items.reduce((sum: number, item: any) => sum + item.lineSubtotal, 0).toFixed(2)) };
}

async function addCartItemImpl(userId: string, productId: string, quantity: number) {
  const product = await loadProduct(productId);
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });
  const existing = cart.items.find((item: any) => String(item.product) === String(product._id));
  const nextQuantity = (existing?.quantity || 0) + quantity;
  await assertAvailable(product, nextQuantity);
  if (existing) existing.quantity = nextQuantity;
  else cart.items.push({ product: product._id, quantity });
  await cart.save();
  return getCart(userId);
}

async function updateCartItemImpl(userId: string, productId: string, quantity: number) {
  const product = await loadProduct(productId);
  await assertAvailable(product, quantity);
  const cart = await Cart.findOne({ user: userId });
  const item = cart?.items.find((entry: any) => String(entry.product) === productId);
  if (!item) throw new CartError('CART_ITEM_NOT_FOUND', 'Cart item not found.');
  item.quantity = quantity;
  await cart.save();
  return getCart(userId);
}

async function removeCartItemImpl(userId: string, productId: string) {
  const cart = await Cart.findOne({ user: userId });
  if (!cart || !cart.items.some((item: any) => String(item.product) === productId)) throw new CartError('CART_ITEM_NOT_FOUND', 'Cart item not found.');
  cart.items = cart.items.filter((item: any) => String(item.product) !== productId);
  await cart.save();
  return getCart(userId);
}

async function clearCartImpl(userId: string) {
  await Cart.findOneAndUpdate({ user: userId }, { $set: { items: [] } });
  return { cleared: true };
}

async function mergeGuestCartImpl(userId: string, incoming: Array<{ productId: string; quantity: number }>) {
  const quantities = new Map<string, number>();
  incoming.forEach(item => quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity));
  const issues: Array<{ productId: string; code: string }> = [];
  for (const [productId, quantity] of quantities) {
    try {
      await addCartItem(userId, productId, quantity);
    } catch (error) {
      if (error instanceof CartError) issues.push({ productId, code: error.code });
      else throw error;
    }
  }
  return { ...(await getCart(userId)), issues };
}

export const addCartItem = (...args: Parameters<typeof addCartItemImpl>) => atomic(() => addCartItemImpl(...args));

export const updateCartItem = (...args: Parameters<typeof updateCartItemImpl>) => atomic(() => updateCartItemImpl(...args));

export const removeCartItem = (...args: Parameters<typeof removeCartItemImpl>) => atomic(() => removeCartItemImpl(...args));

export const clearCart = (...args: Parameters<typeof clearCartImpl>) => atomic(() => clearCartImpl(...args));

export const mergeGuestCart = (...args: Parameters<typeof mergeGuestCartImpl>) => atomic(() => mergeGuestCartImpl(...args));

/** Max-quantity union preserves other devices' lines; a durable key prevents replay resurrection. */
export const syncCart = (userId: string, incoming: Array<{ productId: string; quantity: number }>, key: string) =>
  atomic(async () => {
    const canonical = [...incoming].sort((a, b) => a.productId.localeCompare(b.productId));
    if (new Set(canonical.map(item => item.productId)).size !== canonical.length) throw new CartError('CART_ITEMS_DUPLICATE', 'Cart items must be unique.');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const replay = await CartSync.findOne({ user: userId, key });
    if (replay) {
      if (replay.fingerprint !== fingerprint) throw new CartError('IDEMPOTENCY_CONFLICT', 'This cart key belongs to a different selection.');
      return getCart(userId);
    }
    let cart = await Cart.findOne({ user: userId });
    if (!cart) cart = new Cart({ user: userId, items: [] });
    for (const item of canonical) {
      const product = await loadProduct(item.productId);
      const existing = cart.items.find((line: any) => String(line.product) === item.productId);
      const quantity = Math.max(existing?.quantity ?? 0, item.quantity);
      await assertAvailable(product, quantity);
      if (existing) existing.quantity = quantity;
      else cart.items.push({ product: product._id, quantity });
    }
    if (cart.items.length > 50) throw new CartError('CART_LIMIT', 'A cart may contain at most 50 products.');
    await cart.save();
    await CartSync.create({ user: userId, key, fingerprint });
    return getCart(userId);
  });
