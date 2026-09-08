/**
 * The storefront view model. `stock`, `image`, `rating` and `numReviews` are produced by
 * `utils/products.adaptProduct` from the v1 catalog contract's `availableStock`, `images[]`,
 * `ratingAverage` and `ratingCount`, which are kept here as optional so an adapted product
 * still typechecks with the contract fields it was spread from.
 */
export interface Product {
  _id?: string;
  id?: string;
  name: string;
  slug?: string;
  sku?: string;
  description?: string;
  price: number;
  compareAtPrice?: number;
  currency?: string;
  image?: string;
  images?: Array<{ url?: string; alt?: string; position?: number }>;
  category?: string;
  brand?: string;
  featured?: boolean;
  stock?: number;
  availableStock?: number;
  rating?: number;
  ratingAverage?: number;
  numReviews?: number;
  ratingCount?: number;
}

export interface CartItem extends Product {
  id: string;
  _id: string;
  quantity?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'CUSTOMER' | 'SUPER_ADMIN';
}

export interface Order {
  _id: string;
  orderNumber: string;
  orderStatus: string;
  total: number;
  paymentMethod: 'CASH_ON_DELIVERY';
}

export interface AuthResponse {
  token: string;
  user?: User;
}

export interface ApiError {
  message: string;
  requestId?: string;
  status?: number;
}
