export interface Product {
  _id?: string;
  id?: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  category?: string;
  brand?: string;
  stock?: number;
  rating?: number;
  numReviews?: number;
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
  status: string;
  total: number;
  paymentMethod: 'COD' | 'ONLINE';
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
