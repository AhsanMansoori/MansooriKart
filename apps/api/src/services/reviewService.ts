import { Order } from '../models/order.js';
import { Product } from '../models/product.js';
import { Review } from '../models/review.js';
export class ReviewError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}
export async function recalculate(product: string) {
  const [r] = await Review.aggregate([
    { $match: { product: Product.base.Types.ObjectId.createFromHexString(product), status: 'PUBLISHED' } },
    { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } } },
  ]);
  await Product.updateOne({ _id: product }, { $set: { ratingCount: r?.count || 0, ratingAverage: Number((r?.average || 0).toFixed(2)) } });
}
export async function verified(customer: string, product: string) {
  return Boolean(await Order.exists({ customer, orderStatus: 'DELIVERED', items: { $elemMatch: { productId: product } } }));
}
export async function createReview(customer: string, product: string, input: any) {
  await Review.init();
  const p = await Product.findOne({ _id: product, status: 'ACTIVE' });
  if (!p) throw new ReviewError('PRODUCT_NOT_FOUND', 'Product not found.');
  try {
    const review = await Review.create({ product, customer, ...input, verifiedPurchase: await verified(customer, product) });
    await recalculate(product);
    return review;
  } catch (e: any) {
    if (e?.code === 11000) throw new ReviewError('REVIEW_EXISTS', 'You have already reviewed this product.');
    throw e;
  }
}
export async function updateReview(customer: string, id: string, input: any) {
  const r = await Review.findOne({ _id: id, customer });
  if (!r) throw new ReviewError('REVIEW_NOT_FOUND', 'Review not found.');
  Object.assign(r, input);
  await r.save();
  await recalculate(String(r.product));
  return r;
}
export async function deleteReview(customer: string, id: string) {
  const r = await Review.findOneAndDelete({ _id: id, customer });
  if (!r) throw new ReviewError('REVIEW_NOT_FOUND', 'Review not found.');
  await recalculate(String(r.product));
  return r;
}
