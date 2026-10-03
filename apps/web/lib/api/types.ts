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

export interface StorefrontConfig {
  storeName: string;
  legalName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  currency: {
    code: string;
    display: string;
  };
  timezone: string;
  locale: string;
  contact: {
    supportEmail?: string | null;
    supportPhone?: string | null;
    whatsapp?: string | null;
    supportHours?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    stateProvince?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  socialLinks: Array<{ channel: string; url: string }>;
  seo: {
    metaTitle?: string | null;
    metaDescription?: string | null;
    metaKeywords?: string[];
    canonicalUrl?: string | null;
    robots?: string;
    socialImageUrl?: string | null;
    openGraph?: {
      title?: string | null;
      description?: string | null;
      image?: string | null;
    };
    twitterHandle?: string | null;
  };
  shipping: {
    enabled: boolean;
    standardFee: number;
    freeShippingEnabled: boolean;
    freeShippingThreshold: number;
    codEnabled: boolean;
    deliveryEstimate?: string | null;
  };
  tax: {
    enabled: boolean;
    label: string;
    displayTaxSeparately: boolean;
    pricesIncludeTax: boolean;
  };
  maintenance: {
    enabled: boolean;
    message: string;
  };
}
