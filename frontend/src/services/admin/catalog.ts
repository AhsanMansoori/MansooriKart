import { apiClient, unwrap, unwrapMeta } from '../apiClient';

export type AdminProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription?: string;
  category: string;
  brand?: string;
  images?: Array<{ url: string; alt?: string; position?: number }>;
  price: number;
  compareAtPrice?: number;
  currency: string;
  costPrice?: number;
  stock: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  fulfillmentType: 'OWN_STOCK' | 'DROPSHIP';
  sourceType?: string;
  sellingPriceOverridden: boolean;
  supplierSuggestedRetailPrice?: number | null;
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicationCandidate = {
  productId?: string;
  id?: string;
  name?: string;
  publishable: boolean;
  issues: Array<{ code: string; message?: string }>;
};

export async function listAdminProducts(
  params: {
    page?: number;
    limit?: number;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    search?: string;
    sort?: string;
  } = {}
) {
  const response = await apiClient.get('/admin/products', { params: { page: 1, limit: 20, sort: 'newest', ...params } });
  return { items: unwrap(response) as AdminProduct[], meta: unwrapMeta(response) };
}

export async function updateAdminProduct(
  id: string,
  body: Partial<Pick<AdminProduct, 'name' | 'description' | 'shortDescription' | 'category' | 'brand' | 'price' | 'compareAtPrice'>>
) {
  const response = await apiClient.patch(`/admin/products/${id}`, body);
  return unwrap(response) as AdminProduct;
}

export async function previewPublication(productIds: string[]) {
  const response = await apiClient.post('/admin/products/publish-preview', { productIds });
  return unwrap(response) as {
    candidates: PublicationCandidate[];
    summary: { requested: number; publishable: number };
  };
}

export async function publishProducts(productIds: string[]) {
  const response = await apiClient.post('/admin/products/publish', { productIds });
  return unwrap(response) as {
    published: string[];
    rejected: Array<{ productId?: string; id?: string; issues: Array<{ code: string; message?: string }> }>;
    summary: { requested: number; publishedCount: number; rejectedCount: number };
  };
}
