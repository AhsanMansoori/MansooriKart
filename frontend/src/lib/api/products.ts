import { useQuery } from '@tanstack/react-query';
import { fetchAllProducts } from '@/services/catalog';
import type { Product } from '@/types/domain';

export const productQueryKey = ['products'] as const;

/**
 * The catalog as a react-query resource.
 *
 * The request itself lives in `services/catalog`, which is shared with the components that
 * still fetch directly, so paging and view-model adaptation have exactly one implementation.
 */
export function useProductsQuery() {
  return useQuery({ queryKey: productQueryKey, queryFn: (): Promise<Product[]> => fetchAllProducts() });
}
