export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, string | number | boolean | undefined | null>;
  token?: string;
}

export interface ProductSummary {
  id: string;
  title: string;
  slug: string;
  description?: string;
  price: number;
  originalPrice?: number;
  category: string;
  images: string[];
  thumbnail?: string;
  rating?: number;
  ratingCount?: number;
  stock?: number;
  isAvailable?: boolean;
  tags?: string[];
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  productCount?: number;
}

export interface CartItem {
  id: string;
  productId: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
}

export interface CartSummary {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
}
