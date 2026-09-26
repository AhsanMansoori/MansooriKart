/**
 * Product reviews against the v1 contract.
 *
 * Reading is public; writing requires a signed-in shopper, and the API decides that from the
 * bearer token rather than from anything this module sends. Ratings are therefore no longer
 * writable by an anonymous star click: the average is recalculated server-side from published
 * reviews only.
 */
import { apiClient, unwrap, withRetry } from './apiClient';

export const REVIEW_PAGE_SIZE = 10;

/** Newest first. Returns `{ rows, total }` so a caller can show a count without a second call. */
export async function fetchProductReviews(productId, { limit = REVIEW_PAGE_SIZE } = {}) {
  if (!productId) return { rows: [], total: 0 };
  const response = await withRetry(() => apiClient.get(`products/${productId}/reviews`, { params: { limit } }));
  const rows = unwrap(response);
  return { rows: Array.isArray(rows) ? rows : [], total: Number(response?.data?.total ?? 0) };
}

/**
 * Submit the signed-in shopper's review. `title` is omitted rather than sent empty because the
 * v1 body schema is strict and rejects a blank title.
 */
export async function createProductReview(productId, { rating, title, body }) {
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  const payload = { rating: Number(rating), body: String(body || '').trim() };
  if (trimmedTitle) payload.title = trimmedTitle;
  const response = await apiClient.post(`products/${productId}/reviews`, payload);
  return unwrap(response);
}
