import { apiClient } from './client';
import { ProductSummary, CategorySummary, CartSummary } from './types';

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

  // Public system / market config
  getConfig: () =>
    apiClient.get<{
      defaultCurrency: string;
      defaultMarket: string;
      supportedCurrencies: string[];
      vatRate: number;
    }>('/storefront/config'),
};
