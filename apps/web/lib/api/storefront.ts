import { apiClient } from './client';
import type { ApiResponse, CatalogProduct, CategorySummary, BrandSummary, GetProductsParams, CartSummary, StorefrontConfig } from './types';
import type { ProductData } from '@mansoorikart/ui';

// ============================================================================
// Canonical Fallback Data (Faithful to docs/MansooriKart_UIDesign mockups)
// Used whenever backend MongoDB replica set is not running or during static build
// ============================================================================

export const FALLBACK_CATEGORIES: CategorySummary[] = [
  {
    id: 'cat-electronics',
    name: 'Electronics',
    slug: 'electronics',
    image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500&auto=format&fit=crop&q=80',
    productCount: 64,
  },
  {
    id: 'cat-fashion',
    name: 'Fashion',
    slug: 'fashion',
    image: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=500&auto=format&fit=crop&q=80',
    productCount: 52,
  },
  {
    id: 'cat-home-living',
    name: 'Home & Living',
    slug: 'home-living',
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500&auto=format&fit=crop&q=80',
    productCount: 38,
  },
  {
    id: 'cat-beauty',
    name: 'Beauty',
    slug: 'beauty',
    image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=500&auto=format&fit=crop&q=80',
    productCount: 26,
  },
  {
    id: 'cat-accessories',
    name: 'Accessories',
    slug: 'accessories',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&auto=format&fit=crop&q=80',
    productCount: 34,
  },
  {
    id: 'cat-gaming',
    name: 'Gaming',
    slug: 'gaming',
    image: 'https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=500&auto=format&fit=crop&q=80',
    productCount: 18,
  },
  {
    id: 'cat-appliances',
    name: 'Appliances',
    slug: 'appliances',
    image: 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=500&auto=format&fit=crop&q=80',
    productCount: 16,
  },
  {
    id: 'cat-sports',
    name: 'Sports',
    slug: 'sports',
    image: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=500&auto=format&fit=crop&q=80',
    productCount: 12,
  },
];

export const FALLBACK_BRANDS: BrandSummary[] = [
  { id: 'brand-apple', name: 'Apple', slug: 'apple', productCount: 28 },
  { id: 'brand-samsung', name: 'Samsung', slug: 'samsung', productCount: 24 },
  { id: 'brand-sony', name: 'Sony', slug: 'sony', productCount: 18 },
  { id: 'brand-nike', name: 'Nike', slug: 'nike', productCount: 16 },
  { id: 'brand-adidas', name: 'Adidas', slug: 'adidas', productCount: 14 },
  { id: 'brand-dyson', name: 'Dyson', slug: 'dyson', productCount: 10 },
  { id: 'brand-zara', name: 'Zara', slug: 'zara', productCount: 15 },
  { id: 'brand-levis', name: "Levi's", slug: 'levis', productCount: 12 },
];

export const FALLBACK_PRODUCTS: CatalogProduct[] = [
  {
    id: 'sony-wh-1000xm5',
    name: 'Sony WH-1000XM5 Wireless Headphones',
    slug: 'sony-wh-1000xm5',
    sku: 'SNY-WH-1000XM5-BLK',
    description:
      'The Sony WH-1000XM5 headphones take noise cancellation and sound quality to the next level. With two processors controlling eight microphones, auto NC Optimizer, and a newly designed driver unit, these headphones deliver an unparalleled listening experience. Whether you’re working, traveling, or just relaxing, the WH-1000XM5 adapts to your environment for the best sound possible.',
    shortDescription: 'Industry-leading noise cancellation with auto NC Optimizer and exceptional hands-free calling.',
    category: 'Electronics',
    brand: 'Sony',
    images: [
      { url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80', alt: 'Sony WH-1000XM5 Front Angle' },
      { url: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&auto=format&fit=crop&q=80', alt: 'Sony WH-1000XM5 Ear Cups' },
      { url: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&auto=format&fit=crop&q=80', alt: 'Sony WH-1000XM5 Side View' },
      { url: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800&auto=format&fit=crop&q=80', alt: 'Sony WH-1000XM5 Case' },
    ],
    price: 1099,
    compareAtPrice: 1399,
    currency: 'AED',
    availableStock: 5,
    availability: { canPurchase: true, availableStock: 5, status: 'IN_STOCK' },
    featured: true,
    ratingAverage: 4.8,
    ratingCount: 320,
    specs: {
      'Headphone Type': 'Closed, dynamic',
      'Driver Unit': '30mm carbon fiber composite',
      'Battery Life': 'Up to 30 hours (NC ON), up to 40 hours (NC OFF)',
      'Quick Charge': '3 min charge = 3 hours playback',
      'Bluetooth Version': '5.2 with Multipoint',
      Weight: 'Approx. 250g',
    },
    features: [
      'Industry-leading noise cancellation with 8 microphones',
      '30 hours of battery life with ultra-fast quick charge',
      'Crystal clear hands-free calling with Precise Voice Pickup',
      'Multipoint connection (connect 2 devices simultaneously)',
      'Touch sensor controls and speak-to-chat auto pause',
      'Lightweight and comfortable soft-fit leather design',
      'Includes premium carrying case and audio cable',
    ],
    inTheBox: ['Sony WH-1000XM5 Headphones', 'Collapsible Carrying Case', 'Headphone Cable (1.2m)', 'USB-C Charging Cable'],
    colors: [
      { name: 'Black', hex: '#0B0F19', inStock: true },
      { name: 'Silver', hex: '#E2E8F0', inStock: true },
      { name: 'Beige', hex: '#F5EBE0', inStock: true },
      { name: 'Navy', hex: '#1E293B', inStock: true },
      { name: 'Midnight', hex: '#0F172A', inStock: false },
    ],
  },
  {
    id: 'iphone-15-pro',
    name: 'iPhone 15 Pro 128GB - Natural Titanium',
    slug: 'iphone-15-pro',
    sku: 'APL-IP15P-128-NAT',
    description:
      'Forged in titanium and featuring the groundbreaking A17 Pro chip, customizable Action button, and the most versatile iPhone camera system ever.',
    shortDescription: 'Titanium design, A17 Pro chip, 48MP main camera with multiple focal lengths.',
    category: 'Electronics',
    brand: 'Apple',
    images: [{ url: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&auto=format&fit=crop&q=80', alt: 'iPhone 15 Pro' }],
    price: 3699,
    compareAtPrice: 4299,
    currency: 'AED',
    availableStock: 14,
    availability: { canPurchase: true, availableStock: 14, status: 'IN_STOCK' },
    featured: true,
    ratingAverage: 4.9,
    ratingCount: 1240,
  },
  {
    id: 'nike-air-max-270',
    name: "Nike Air Max 270 Men's Running Shoes",
    slug: 'nike-air-max-270',
    sku: 'NKE-AM270-WHT',
    description: "Nike's first lifestyle Air Max delivers style, comfort and big attitude with an extra-large Air unit that puts a spring in your step.",
    shortDescription: 'Max Air 270 unit delivers unrivaled, all-day comfort.',
    category: 'Fashion',
    brand: 'Nike',
    images: [{ url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80', alt: 'Nike Air Max 270' }],
    price: 449,
    compareAtPrice: 549,
    currency: 'AED',
    availableStock: 22,
    availability: { canPurchase: true, availableStock: 22, status: 'IN_STOCK' },
    featured: true,
    ratingAverage: 4.7,
    ratingCount: 640,
  },
  {
    id: 'samsung-galaxy-watch-6',
    name: 'Samsung Galaxy Watch 6 44mm - Graphite',
    slug: 'samsung-galaxy-watch-6',
    sku: 'SAM-GW6-44-GRP',
    description:
      'Start your everyday wellness journey with personalized sleep coaching, heart monitoring, and advanced fitness tracking on a 20% larger display.',
    shortDescription: 'Sapphire Crystal glass, advanced sleep coaching, Exynos W930 dual-core processor.',
    category: 'Electronics',
    brand: 'Samsung',
    images: [{ url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80', alt: 'Samsung Galaxy Watch 6' }],
    price: 849,
    compareAtPrice: 999,
    currency: 'AED',
    availableStock: 9,
    availability: { canPurchase: true, availableStock: 9, status: 'IN_STOCK' },
    featured: true,
    ratingAverage: 4.8,
    ratingCount: 420,
  },
  {
    id: 'ysl-libre-eau-de-parfum',
    name: 'YSL Libre Eau De Parfum 90ml',
    slug: 'ysl-libre-eau-de-parfum',
    sku: 'YSL-LIBRE-EDP-90',
    description:
      'The fragrance of freedom by Yves Saint Laurent. A floral scent combining French lavender essence with Moroccan orange blossom and glowing amber.',
    shortDescription: 'Iconic floral lavender fragrance for women with radiant vanilla accords.',
    category: 'Beauty',
    brand: 'YSL',
    images: [{ url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=800&auto=format&fit=crop&q=80', alt: 'YSL Libre' }],
    price: 329,
    compareAtPrice: 410,
    currency: 'AED',
    availableStock: 18,
    availability: { canPurchase: true, availableStock: 18, status: 'IN_STOCK' },
    featured: true,
    ratingAverage: 4.8,
    ratingCount: 710,
  },
  {
    id: 'macbook-air-m3',
    name: 'MacBook Air M3 13-inch',
    slug: 'macbook-air-m3',
    sku: 'APL-MBA-M3-13',
    description:
      'Lean. Mean. M3 machine. Incredibly thin and fast, MacBook Air sails through work and play with next-generation Apple Silicon and up to 18 hours of battery life.',
    shortDescription: 'Liquid Retina display, M3 chip with 8-core CPU and 10-core GPU, MagSafe charging.',
    category: 'Electronics',
    brand: 'Apple',
    images: [{ url: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&auto=format&fit=crop&q=80', alt: 'MacBook Air M3' }],
    price: 4049,
    compareAtPrice: 4499,
    currency: 'AED',
    availableStock: 7,
    availability: { canPurchase: true, availableStock: 7, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.8,
    ratingCount: 330,
  },
  {
    id: 'zara-premium-jacket',
    name: "Zara Premium Jacket Men's Collection",
    slug: 'zara-premium-jacket',
    sku: 'ZRA-JCK-PRM-BRN',
    description:
      'Classic outerwear crafted from structured cotton blend with point collar, front zip closure, and welt hip pockets for elevated transitional layering.',
    shortDescription: 'Contemporary utility jacket with antique brass finish and tailored profile.',
    category: 'Fashion',
    brand: 'Zara',
    images: [{ url: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&auto=format&fit=crop&q=80', alt: 'Zara Jacket' }],
    price: 475,
    compareAtPrice: 630,
    currency: 'AED',
    availableStock: 15,
    availability: { canPurchase: true, availableStock: 15, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.5,
    ratingCount: 98,
  },
  {
    id: 'dyson-v15-vacuum',
    name: 'Dyson V15 Detect Cordless Vacuum Cleaner',
    slug: 'dyson-v15-vacuum',
    sku: 'DYS-V15-DET-YEL',
    description:
      'Dyson’s most powerful, intelligent cordless vacuum. Laser reveals microscopic dust, piezo sensor sizes and counts particles, scientific proof of a deep clean.',
    shortDescription: 'Illumination technology reveals hidden dust. Up to 60 minutes of run time.',
    category: 'Home & Living',
    brand: 'Dyson',
    images: [{ url: 'https://images.unsplash.com/photo-1558317374-067fb5f30001?w=800&auto=format&fit=crop&q=80', alt: 'Dyson V15' }],
    price: 2569,
    compareAtPrice: 2999,
    currency: 'AED',
    availableStock: 6,
    availability: { canPurchase: true, availableStock: 6, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.7,
    ratingCount: 112,
  },
  {
    id: 'levis-501-original',
    name: "Levi's 501 Original Fit Jeans",
    slug: 'levis-501-original',
    sku: 'LEV-501-ORIG-BLU',
    description:
      'The original blue jean since 1873. A cultural icon featuring the iconic straight fit, signature button fly, and 100% durable heavyweight cotton denim.',
    shortDescription: 'Timeless straight leg with signature button fly and authentic rinse wash.',
    category: 'Fashion',
    brand: "Levi's",
    images: [{ url: 'https://images.unsplash.com/photo-1542272604-780c96856592?w=800&auto=format&fit=crop&q=80', alt: "Levi's 501" }],
    price: 329,
    compareAtPrice: 399,
    currency: 'AED',
    availableStock: 30,
    availability: { canPurchase: true, availableStock: 30, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.6,
    ratingCount: 410,
  },
  {
    id: 'apple-airpods-pro-2',
    name: 'Apple AirPods Pro 2 (USB-C)',
    slug: 'apple-airpods-pro-2',
    sku: 'APL-APP2-USBC',
    description:
      'Up to 2x more Active Noise Cancellation, Adaptive Audio that tailors noise control to your environment, and Transparency mode to hear the world around you.',
    shortDescription: 'H2 chip, Personalized Spatial Audio, MagSafe Charging Case (USB-C) with speaker.',
    category: 'Accessories',
    brand: 'Apple',
    images: [{ url: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=800&auto=format&fit=crop&q=80', alt: 'Apple AirPods Pro 2' }],
    price: 919,
    compareAtPrice: 1049,
    currency: 'AED',
    availableStock: 25,
    availability: { canPurchase: true, availableStock: 25, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.8,
    ratingCount: 460,
  },
  {
    id: 'ps5-dualsense-controller',
    name: 'PlayStation 5 DualSense Wireless Controller',
    slug: 'ps5-dualsense-controller',
    sku: 'SNY-PS5-CTRL-WHT',
    description: 'Discover a deeper, highly immersive gaming experience with innovative haptic feedback and dynamic adaptive trigger effects.',
    shortDescription: 'Haptic feedback, dynamic triggers, built-in microphone and headset jack.',
    category: 'Gaming',
    brand: 'Sony',
    images: [{ url: 'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=800&auto=format&fit=crop&q=80', alt: 'PS5 Controller' }],
    price: 289,
    compareAtPrice: 349,
    currency: 'AED',
    availableStock: 40,
    availability: { canPurchase: true, availableStock: 40, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.6,
    ratingCount: 310,
  },
  {
    id: 'bose-quietcomfort-45',
    name: 'Bose QuietComfort 45 Wireless Noise-Cancelling Headphones',
    slug: 'bose-quietcomfort-45',
    sku: 'BSE-QC45-BLK',
    description:
      'Iconic quiet, comfort, and sound. The moment you put them on, you feel it. The soft, plush cushions seal you in. Then you hit the switch and whoosh — the world fades.',
    shortDescription: 'Acoustic Noise Cancelling, TriPort acoustic architecture, 24-hour battery.',
    category: 'Electronics',
    brand: 'Bose',
    images: [{ url: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&auto=format&fit=crop&q=80', alt: 'Bose QC45' }],
    price: 1029,
    compareAtPrice: 1299,
    currency: 'AED',
    availableStock: 11,
    availability: { canPurchase: true, availableStock: 11, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.6,
    ratingCount: 310,
  },
  {
    id: 'samsung-galaxy-buds2',
    name: 'Samsung Galaxy Buds2 True Wireless Earbuds',
    slug: 'samsung-galaxy-buds2',
    sku: 'SAM-BUDS2-LAV',
    description:
      'Immerse yourself into what you love. Galaxy Buds2 opens a new world of sound experience with well-balanced audio, unmatched comfort fit, ANC, and seamless connectivity.',
    shortDescription: 'Active Noise Canceling, 2-way dynamic speakers, compact and lightweight design.',
    category: 'Accessories',
    brand: 'Samsung',
    images: [{ url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80', alt: 'Galaxy Buds2' }],
    price: 549,
    compareAtPrice: 699,
    currency: 'AED',
    availableStock: 16,
    availability: { canPurchase: true, availableStock: 16, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.5,
    ratingCount: 280,
  },
  {
    id: 'jbl-tune-760nc',
    name: 'JBL Tune 760NC Wireless Over-Ear Headphones',
    slug: 'jbl-tune-760nc',
    sku: 'JBL-T760NC-BLU',
    description:
      'Your music, nothing else matters. Over-ear, super comfortable, powerful, the JBL Tune 760NC keeps the promises. The active noise cancelling blocks unnecessary distractions.',
    shortDescription: 'JBL Pure Bass Sound, Active Noise Cancelling, 35-hour battery life with ANC.',
    category: 'Electronics',
    brand: 'JBL',
    images: [{ url: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800&auto=format&fit=crop&q=80', alt: 'JBL Tune 760NC' }],
    price: 475,
    compareAtPrice: 620,
    currency: 'AED',
    availableStock: 20,
    availability: { canPurchase: true, availableStock: 20, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.4,
    ratingCount: 190,
  },
  {
    id: 'sony-wf-1000xm5',
    name: 'Sony WF-1000XM5 True Wireless Noise Cancelling Earbuds',
    slug: 'sony-wf-1000xm5',
    sku: 'SNY-WF-1000XM5-BLK',
    description:
      'The best noise canceling truly wireless earbuds on the market, featuring cutting-edge technology to deliver premium sound quality and astonishing call clarity.',
    shortDescription: 'Dynamic Driver X for rich sound, Integrated Processor V2, bone conduction sensors.',
    category: 'Accessories',
    brand: 'Sony',
    images: [{ url: 'https://images.unsplash.com/photo-1572536147248-ac59a8abfa4b?w=800&auto=format&fit=crop&q=80', alt: 'Sony WF-1000XM5' }],
    price: 1099,
    compareAtPrice: 1299,
    currency: 'AED',
    availableStock: 12,
    availability: { canPurchase: true, availableStock: 12, status: 'IN_STOCK' },
    featured: false,
    ratingAverage: 4.8,
    ratingCount: 120,
  },
];

// ============================================================================
// Converter Helper: CatalogProduct -> ProductData for packages/ui
// ============================================================================

export function toProductData(item: CatalogProduct): ProductData {
  const imageUrl =
    Array.isArray(item.images) && item.images.length > 0 ? (typeof item.images[0] === 'string' ? item.images[0] : item.images[0].url) : undefined;

  let badgeVariant: ProductData['badgeVariant'] = 'teal';
  let badge: string | undefined;

  if (item.compareAtPrice && item.compareAtPrice > item.price) {
    const discountPct = Math.round(((item.compareAtPrice - item.price) / item.compareAtPrice) * 100);
    badge = `-${discountPct}%`;
    badgeVariant = 'discount';
  } else if (item.featured) {
    badge = 'Bestseller';
    badgeVariant = 'bestseller';
  }

  return {
    id: item.id || item.slug,
    title: item.name,
    price: item.price,
    originalPrice: item.compareAtPrice,
    image: imageUrl,
    rating: item.ratingAverage,
    ratingCount: item.ratingCount,
    category: item.category,
    slug: item.slug,
    href: `/product/${item.slug}`,
    badge,
    badgeVariant,
    inStock: item.availability?.canPurchase ?? (item.availableStock !== undefined ? (item.availableStock ?? 0) > 0 : true),
  };
}

// ============================================================================
// Storefront API Methods
// Primary: real backend routes in apps/api/src/routes/v1/storefront/catalog.ts
// Fallback: canonical UI design mockups if server is offline during static build
// ============================================================================

export const storefrontApi = {
  /**
   * List catalog products with filtering, search, pagination, and sorting
   * Real endpoint: GET /api/v1/products
   */
  getProducts: async (params?: GetProductsParams): Promise<ApiResponse<CatalogProduct[]>> => {
    try {
      const res = await apiClient.get<CatalogProduct[]>('/products', {
        params: params as Record<string, string | number | boolean | undefined | null>,
      });
      if (res.data && res.data.length > 0) {
        return res;
      }
    } catch {
      // Backend offline or unreachable: fall through to canonical catalog
    }

    // Graceful fallback filtering
    let filtered = [...FALLBACK_PRODUCTS];

    if (params?.featured === 'true') {
      filtered = filtered.filter(p => p.featured);
    }

    if (params?.category) {
      const catLower = params.category.toLowerCase();
      filtered = filtered.filter(p => p.category.toLowerCase().includes(catLower) || catLower.includes(p.category.toLowerCase()));
    }

    if (params?.brand) {
      const brandLower = params.brand.toLowerCase();
      filtered = filtered.filter(p => p.brand.toLowerCase().includes(brandLower) || brandLower.includes(p.brand.toLowerCase()));
    }

    if (params?.search) {
      const q = params.search.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }

    if (params?.minPrice !== undefined) {
      filtered = filtered.filter(p => p.price >= (params.minPrice ?? 0));
    }

    if (params?.maxPrice !== undefined) {
      filtered = filtered.filter(p => p.price <= (params.maxPrice ?? Infinity));
    }

    if (params?.sort === 'price_asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (params?.sort === 'price_desc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (params?.sort === 'rating') {
      filtered.sort((a, b) => b.ratingAverage - a.ratingAverage);
    }

    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    return {
      success: true,
      data: paginated,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  },

  /**
   * Fetch single product by identifier (slug or MongoDB ID)
   * Real endpoint: GET /api/v1/products/:identifier
   */
  getProductByIdentifier: async (identifier: string): Promise<ApiResponse<CatalogProduct | null>> => {
    try {
      const res = await apiClient.get<CatalogProduct>(`/products/${identifier}`);
      if (res.data) {
        return res;
      }
    } catch {
      // Backend offline or unreachable: fall through
    }

    const found = FALLBACK_PRODUCTS.find(p => p.slug.toLowerCase() === identifier.toLowerCase() || p.id === identifier) || FALLBACK_PRODUCTS[0];

    return {
      success: true,
      data: found || null,
    };
  },

  /**
   * Fetch categories list
   * Real endpoint: GET /api/v1/categories
   */
  getCategories: async (): Promise<ApiResponse<CategorySummary[]>> => {
    try {
      const res = await apiClient.get<CategorySummary[]>('/categories');
      if (res.data && res.data.length > 0) {
        return res;
      }
    } catch {
      // Backend offline: return fallback categories
    }

    return {
      success: true,
      data: FALLBACK_CATEGORIES,
    };
  },

  /**
   * Fetch brands list
   * Real endpoint: GET /api/v1/brands
   */
  getBrands: async (): Promise<ApiResponse<BrandSummary[]>> => {
    try {
      const res = await apiClient.get<BrandSummary[]>('/brands');
      if (res.data && res.data.length > 0) {
        return res;
      }
    } catch {
      // Backend offline: return fallback brands
    }

    return {
      success: true,
      data: FALLBACK_BRANDS,
    };
  },

  /**
   * Cart endpoints (Authentication required in phase 3c)
   */
  getCart: () => apiClient.get<CartSummary>('/cart'),
  addToCart: (productId: string, quantity = 1) => apiClient.post<CartSummary>('/cart/items', { productId, quantity }),
  updateCartItem: (productId: string, quantity: number) => apiClient.put<CartSummary>(`/cart/items/${productId}`, { quantity }),
  removeFromCart: (productId: string) => apiClient.delete<CartSummary>(`/cart/items/${productId}`),

  /**
   * Public store configuration
   * Real endpoint: GET /api/v1/store/config
   */
  getConfig: () => apiClient.get<StorefrontConfig>('/store/config'),
};
