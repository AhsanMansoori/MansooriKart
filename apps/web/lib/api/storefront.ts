import { apiClient } from './client';
import { ProductSummary, CategorySummary, CartSummary, StorefrontConfig } from './types';

export const storefrontApi = {
  // Catalog endpoints
  getProducts: (params?: { page?: number; limit?: number; category?: string; search?: string; sortBy?: string }) =>
    apiClient.get<ProductSummary[]>('/storefront/products', { params }),

  getProductBySlug: (slug: string) => apiClient.get<ProductSummary>(`/storefront/products/${slug}`),

  getFeaturedProducts: () => apiClient.get<ProductSummary[]>('/storefront/products/featured'),

  getCategories: () => apiClient.get<CategorySummary[]>('/storefront/categories'),

  // Cart endpoints
  getCart: () => apiClient.get<CartSummary>('/cart'),

  addToCart: (productId: string, quantity = 1) => apiClient.post<CartSummary>('/cart/items', { productId, quantity }),

  updateCartItem: (productId: string, quantity: number) => apiClient.put<CartSummary>(`/cart/items/${productId}`, { quantity }),

  removeFromCart: (productId: string) => apiClient.delete<CartSummary>(`/cart/items/${productId}`),

  // Public system / store config
  getConfig: () => apiClient.get<StorefrontConfig>('/store/config'),
};
