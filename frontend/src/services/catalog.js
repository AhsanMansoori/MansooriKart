import { apiClient, unwrap, withRetry } from './apiClient';
import { adaptProduct, adaptProductList } from '../utils/products';

/**
 * Catalog reads, in one place.
 *
 * The v1 catalog is paginated (`limit` is capped at 100 by the API) and returns products in
 * the API contract's own shape. Every page in this application wants the storefront view
 * model instead, so both concerns — paging and adaptation — are handled here and nowhere
 * else. Nothing in this module is authenticated: `/api/v1/products` is public.
 */
export const PRODUCT_PAGE_SIZE = 100;
export const PRODUCT_PAGE_LIMIT = 5;

const listProducts = async params => {
  const response = await withRetry(() => apiClient.get('products', { params }));
  const rows = unwrap(response);
  if (!Array.isArray(rows)) throw new Error('Unexpected products response.');
  return { rows: adaptProductList(rows), totalPages: Number(response?.data?.totalPages ?? 1) };
};

/** The whole catalog, assembled from a bounded number of pages. */
export async function fetchAllProducts() {
  const collected = [];
  for (let page = 1; page <= PRODUCT_PAGE_LIMIT; page += 1) {
    const { rows, totalPages } = await listProducts({ page, limit: PRODUCT_PAGE_SIZE });
    collected.push(...rows);
    if (!Number.isFinite(totalPages) || page >= totalPages || rows.length < PRODUCT_PAGE_SIZE) break;
  }
  return collected;
}

/** One product by id or slug. */
export async function fetchProduct(identifier) {
  const response = await withRetry(() => apiClient.get(`products/${encodeURIComponent(identifier)}`));
  return adaptProduct(unwrap(response));
}

/**
 * Catalog search.
 *
 * This is the database's own case-insensitive match over name and description — the same
 * behaviour the storefront has always had, with no vector service and no external search
 * provider involved.
 */
export async function searchProducts(query, { limit = 8 } = {}) {
  const { rows } = await listProducts({ search: query, limit });
  return rows;
}

/**
 * Other products a shopper is likely to want next.
 *
 * Same category, then same brand, highest rated first, with the product being viewed removed.
 * It is a plain catalog query: no embeddings, no similarity service, no recommendation model.
 */
export async function fetchRelatedProducts(product, { limit = 4 } = {}) {
  if (!product) return [];
  const currentId = String(product.id || product._id || '');
  const queries = [];
  if (product.category) queries.push({ category: product.category, sort: 'rating', limit: limit + 1 });
  if (product.brand) queries.push({ brand: product.brand, sort: 'rating', limit: limit + 1 });
  const collected = new Map();
  for (const params of queries) {
    const { rows } = await listProducts(params);
    for (const row of rows) {
      const id = String(row.id || row._id || '');
      if (!id || id === currentId || collected.has(id)) continue;
      collected.set(id, row);
    }
    if (collected.size >= limit) break;
  }
  return Array.from(collected.values()).slice(0, limit);
}
