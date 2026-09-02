import { Product } from '../models/product.js';
import { Wishlist } from '../models/wishlist.js';

export class WishlistError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
const active = { $or: [{ status: 'ACTIVE' }, { status: { $exists: false } }] };
export async function getWishlist(userId: string) {
  const wishlist = await Wishlist.findOne({ user: userId }).populate('products').lean();
  return { products: (wishlist?.products || []).filter(Boolean) };
}
export async function addWishlistItem(userId: string, productId: string) {
  const product = await Product.findOne({ _id: productId, ...active });
  if (!product) throw new WishlistError('PRODUCT_NOT_FOUND', 'Product not found.');
  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) wishlist = new Wishlist({ user: userId, products: [] });
  if (!wishlist.products.some((id: any) => String(id) === productId)) {
    wishlist.products.push(product._id);
    await wishlist.save();
  }
  return getWishlist(userId);
}
export async function removeWishlistItem(userId: string, productId: string) {
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist || !wishlist.products.some((id: any) => String(id) === productId))
    throw new WishlistError('WISHLIST_ITEM_NOT_FOUND', 'Wishlist item not found.');
  wishlist.products = wishlist.products.filter((id: any) => String(id) !== productId);
  await wishlist.save();
  return getWishlist(userId);
}
export async function clearWishlist(userId: string) {
  await Wishlist.findOneAndUpdate({ user: userId }, { $set: { products: [] } });
  return { cleared: true };
}
