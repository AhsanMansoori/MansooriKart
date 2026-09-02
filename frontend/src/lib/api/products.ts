import { useQuery } from '@tanstack/react-query';
import { apiClient, withRetry } from '@/services/apiClient';
import type { Product } from '@/types/domain';

export const productQueryKey = ['products'] as const;

export function useProductsQuery() {
  return useQuery({
    queryKey: productQueryKey,
    queryFn: async (): Promise<Product[]> => {
      const { data } = await withRetry(() => apiClient.get('products'));
      if (!Array.isArray(data)) throw new Error('Unexpected products response.');
      return data.map(product => ({ ...product, _id: product._id || product.id, id: product._id || product.id }));
    },
  });
}
