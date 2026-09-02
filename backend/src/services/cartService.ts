import { Cart } from '../models/cart.js';
import { Product } from '../models/product.js';

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

export async function getCart(userId: string) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product').lean();
  const items = (cart?.items || [])
    .filter((item: any) => item.product)
    .map((item: any) => ({
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.product.price,
      lineSubtotal: Number((item.product.price * item.quantity).toFixed(2)),
    }));
  return { items, subtotal: Number(items.reduce((sum: number, item: any) => sum + item.lineSubtotal, 0).toFixed(2)) };
}

export async function addCartItem(userId: string, productId: string, quantity: number) {
  const product = await loadProduct(productId);
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });
  const existing = cart.items.find((item: any) => String(item.product) === String(product._id));
  const nextQuantity = (existing?.quantity || 0) + quantity;
  if (nextQuantity > product.stock) throw new CartError('INSUFFICIENT_STOCK', 'Requested quantity is not available.');
  if (existing) existing.quantity = nextQuantity;
  else cart.items.push({ product: product._id, quantity });
  await cart.save();
  return getCart(userId);
}

export async function updateCartItem(userId: string, productId: string, quantity: number) {
  const product = await loadProduct(productId);
  if (quantity > product.stock) throw new CartError('INSUFFICIENT_STOCK', 'Requested quantity is not available.');
  const cart = await Cart.findOne({ user: userId });
  const item = cart?.items.find((entry: any) => String(entry.product) === productId);
  if (!item) throw new CartError('CART_ITEM_NOT_FOUND', 'Cart item not found.');
  item.quantity = quantity;
  await cart.save();
  return getCart(userId);
}

export async function removeCartItem(userId: string, productId: string) {
  const cart = await Cart.findOne({ user: userId });
  if (!cart || !cart.items.some((item: any) => String(item.product) === productId)) throw new CartError('CART_ITEM_NOT_FOUND', 'Cart item not found.');
  cart.items = cart.items.filter((item: any) => String(item.product) !== productId);
  await cart.save();
  return getCart(userId);
}

export async function clearCart(userId: string) {
  await Cart.findOneAndUpdate({ user: userId }, { $set: { items: [] } });
  return { cleared: true };
}

export async function mergeGuestCart(userId: string, incoming: Array<{ productId: string; quantity: number }>) {
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
