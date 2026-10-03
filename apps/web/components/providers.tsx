'use client';

import * as React from 'react';
import { storefrontApi } from '../lib/api/storefront';
import { StorefrontConfig } from '../lib/api/types';

export const DEFAULT_STORE_CONFIG: StorefrontConfig = {
  storeName: 'MansooriKart',
  legalName: 'MansooriKart LLC',
  tagline: 'UAE Premier Marketplace',
  logoUrl: '/logo.png',
  faviconUrl: null,
  currency: {
    code: 'AED',
    display: 'SYMBOL',
  },
  timezone: 'Asia/Dubai',
  locale: 'en-AE',
  contact: {
    supportEmail: 'support@mansoorikart.ae',
    supportPhone: '+971 4 123 4567',
    whatsapp: '+971 50 123 4567',
    supportHours: 'Daily 8:00 AM - 10:00 PM GST',
    addressLine1: 'Business Bay, Tower 1',
    addressLine2: 'Level 14',
    city: 'Dubai',
    stateProvince: 'Dubai',
    postalCode: '00000',
    country: 'AE',
  },
  socialLinks: [],
  seo: {
    metaTitle: 'MansooriKart | UAE Premier Marketplace',
    metaDescription: 'Authentic electronics, lifestyle, fashion, and home essentials with express delivery across Dubai and UAE.',
    metaKeywords: ['MansooriKart', 'UAE ecommerce', 'Dubai online shopping', 'Electronics UAE', 'AED shopping'],
    canonicalUrl: null,
    robots: 'index,follow',
    socialImageUrl: null,
  },
  shipping: {
    enabled: true,
    standardFee: 15,
    freeShippingEnabled: true,
    freeShippingThreshold: 150,
    codEnabled: true,
    deliveryEstimate: '1-2 business days in Dubai, 2-3 days across UAE',
  },
  tax: {
    enabled: true,
    label: 'VAT',
    displayTaxSeparately: true,
    pricesIncludeTax: false,
  },
  maintenance: {
    enabled: false,
    message: 'MansooriKart is briefly unavailable while we make improvements. Please check back shortly.',
  },
};

// ==========================================
// 1. CONFIG CONTEXT
// ==========================================
interface ConfigContextValue {
  config: StorefrontConfig;
  isLoading: boolean;
  refreshConfig: () => Promise<void>;
}

const ConfigContext = React.createContext<ConfigContextValue>({
  config: DEFAULT_STORE_CONFIG,
  isLoading: false,
  refreshConfig: async () => {},
});

export function useStoreConfig() {
  return React.useContext(ConfigContext);
}

// ==========================================
// 2. CART CONTEXT
// ==========================================
export interface CartItem {
  id: string;
  productId: string;
  title: string;
  price: number;
  originalPrice?: number;
  quantity: number;
  image?: string;
  color?: string;
  slug?: string;
}

export interface CartItemInput {
  productId: string;
  title: string;
  price: number;
  originalPrice?: number;
  quantity?: number;
  image?: string;
  color?: string;
  slug?: string;
}

interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (item: CartItemInput) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  isCartDrawerOpen: boolean;
  setIsCartDrawerOpen: (open: boolean) => void;
}

const CartContext = React.createContext<CartContextValue>({
  items: [],
  itemCount: 0,
  subtotal: 0,
  addItem: () => {},
  updateQuantity: () => {},
  removeItem: () => {},
  clearCart: () => {},
  isCartDrawerOpen: false,
  setIsCartDrawerOpen: () => {},
});

export function useCart() {
  return React.useContext(CartContext);
}

// ==========================================
// 3. WISHLIST CONTEXT
// ==========================================
export interface WishlistItem {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating?: number;
  reviewsCount?: number;
  slug?: string;
  badge?: string;
  category?: string;
}

interface WishlistContextValue {
  items: WishlistItem[];
  wishlistCount: number;
  toggleWishlist: (item: WishlistItem) => void;
  isInWishlist: (id: string) => boolean;
  removeFromWishlist: (id: string) => void;
  clearWishlist: () => void;
}

const WishlistContext = React.createContext<WishlistContextValue>({
  items: [],
  wishlistCount: 0,
  toggleWishlist: () => {},
  isInWishlist: () => false,
  removeFromWishlist: () => {},
  clearWishlist: () => {},
});

export function useWishlist() {
  return React.useContext(WishlistContext);
}

// ==========================================
// 4. AUTH CONTEXT
// ==========================================
export interface SavedAddress {
  id: string;
  label: string; // 'Home' | 'Office'
  fullName: string;
  phone: string;
  street: string;
  building: string;
  emirate: string; // 'Dubai', 'Abu Dhabi', etc.
  city: string;
  isDefault: boolean;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  addresses: SavedAddress[];
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password?: string) => Promise<boolean>;
  register: (name: string, email: string, phone: string, password?: string) => Promise<boolean>;
  logout: () => void;
  updateUser: (data: Partial<AuthUser>) => void;
  addAddress: (address: Omit<SavedAddress, 'id'>) => void;
  deleteAddress: (id: string) => void;
  setDefaultAddress: (id: string) => void;
}

const AuthContext = React.createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  login: async () => false,
  register: async () => false,
  logout: () => {},
  updateUser: () => {},
  addAddress: () => {},
  deleteAddress: () => {},
  setDefaultAddress: () => {},
});

export function useAuth() {
  return React.useContext(AuthContext);
}

// ==========================================
// 5. COMBINED PROVIDERS
// ==========================================
interface ProvidersProps {
  children: React.ReactNode;
  initialConfig?: StorefrontConfig;
}

const INITIAL_CART_ITEMS: CartItem[] = [
  {
    id: 'cart-1',
    productId: 'prod-headphones-pro',
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    price: 1199,
    originalPrice: 1499,
    quantity: 1,
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
    color: 'Midnight Black',
    slug: 'sony-wh-1000xm5',
  },
  {
    id: 'cart-2',
    productId: 'prod-smartwatch-ultra',
    title: 'Apple Watch Ultra 2 GPS + Cellular 49mm Titanium',
    price: 2999,
    originalPrice: 3299,
    quantity: 1,
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80',
    color: 'Orange Ocean Band',
    slug: 'apple-watch-ultra-2',
  },
];

const INITIAL_WISHLIST: WishlistItem[] = [
  {
    id: 'prod-headphones-pro',
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    price: 1199,
    originalPrice: 1499,
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
    rating: 4.8,
    reviewsCount: 328,
    slug: 'sony-wh-1000xm5',
    badge: '15% OFF',
    category: 'Electronics',
  },
  {
    id: 'prod-camera-alpha',
    title: 'Fujifilm X-T5 Mirrorless Camera with 16-80mm Lens',
    price: 6499,
    originalPrice: 6999,
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80',
    rating: 4.9,
    reviewsCount: 142,
    slug: 'fujifilm-x-t5',
    badge: 'TOP RATED',
    category: 'Cameras',
  },
];

const DEFAULT_USER: AuthUser = {
  id: 'usr-uae-1',
  name: 'Ahmed Mansoori',
  email: 'ahmed.mansoori@mansoorikart.ae',
  phone: '+971 50 123 4567',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
  addresses: [
    {
      id: 'addr-1',
      label: 'Home',
      fullName: 'Ahmed Mansoori',
      phone: '+971 50 123 4567',
      street: 'Al Wasl Road, Villa 42',
      building: 'Villa 42',
      emirate: 'Dubai',
      city: 'Jumeirah 1',
      isDefault: true,
    },
    {
      id: 'addr-2',
      label: 'Office',
      fullName: 'Ahmed Mansoori',
      phone: '+971 4 987 6543',
      street: 'Sheikh Zayed Road, Rolex Tower',
      building: 'Level 28, Suite 2804',
      emirate: 'Dubai',
      city: 'DIFC',
      isDefault: false,
    },
  ],
};

export function Providers({ children, initialConfig }: ProvidersProps) {
  const [config, setConfig] = React.useState<StorefrontConfig>(initialConfig ?? DEFAULT_STORE_CONFIG);
  const [isLoading, setIsLoading] = React.useState(!initialConfig);

  // Cart State with LocalStorage
  const [cartItems, setCartItems] = React.useState<CartItem[]>(() => {
    if (typeof window === 'undefined') return INITIAL_CART_ITEMS;
    try {
      const storedCart = localStorage.getItem('mk_cart');
      return storedCart ? JSON.parse(storedCart) : INITIAL_CART_ITEMS;
    } catch {
      return INITIAL_CART_ITEMS;
    }
  });
  const [isCartDrawerOpen, setIsCartDrawerOpen] = React.useState(false);

  // Wishlist State with LocalStorage
  const [wishlistItems, setWishlistItems] = React.useState<WishlistItem[]>(() => {
    if (typeof window === 'undefined') return INITIAL_WISHLIST;
    try {
      const storedWishlist = localStorage.getItem('mk_wishlist');
      return storedWishlist ? JSON.parse(storedWishlist) : INITIAL_WISHLIST;
    } catch {
      return INITIAL_WISHLIST;
    }
  });

  // Auth State
  const [user, setUser] = React.useState<AuthUser | null>(() => {
    if (typeof window === 'undefined') return DEFAULT_USER;
    try {
      const storedUser = localStorage.getItem('mk_user');
      return storedUser ? JSON.parse(storedUser) : DEFAULT_USER;
    } catch {
      return DEFAULT_USER;
    }
  });

  const refreshConfig = React.useCallback(async () => {
    try {
      const res = await storefrontApi.getConfig();
      if (res && res.data) {
        setConfig(res.data);
      }
    } catch {
      // Maintain baseline UAE configuration
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Cart Actions
  const addItem = React.useCallback((input: CartItemInput) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === input.productId && item.color === input.color);
      let updated: CartItem[];
      if (existing) {
        updated = prev.map(item => (item.id === existing.id ? { ...item, quantity: item.quantity + (input.quantity || 1) } : item));
      } else {
        const newItem: CartItem = {
          id: `cart-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          productId: input.productId,
          title: input.title,
          price: input.price,
          originalPrice: input.originalPrice,
          quantity: input.quantity || 1,
          image: input.image,
          color: input.color,
          slug: input.slug,
        };
        updated = [...prev, newItem];
      }
      try {
        localStorage.setItem('mk_cart', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const updateQuantity = React.useCallback((id: string, qty: number) => {
    setCartItems(prev => {
      let updated: CartItem[];
      if (qty <= 0) {
        updated = prev.filter(item => item.id !== id);
      } else {
        updated = prev.map(item => (item.id === id ? { ...item, quantity: qty } : item));
      }
      try {
        localStorage.setItem('mk_cart', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const removeItem = React.useCallback((id: string) => {
    setCartItems(prev => {
      const updated = prev.filter(item => item.id !== id);
      try {
        localStorage.setItem('mk_cart', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const clearCart = React.useCallback(() => {
    setCartItems([]);
    try {
      localStorage.removeItem('mk_cart');
    } catch {
      // storage ignored
    }
  }, []);

  const itemCount = React.useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);

  const subtotal = React.useMemo(() => cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0), [cartItems]);

  // Wishlist Actions
  const toggleWishlist = React.useCallback((item: WishlistItem) => {
    setWishlistItems(prev => {
      const exists = prev.some(w => w.id === item.id);
      let updated: WishlistItem[];
      if (exists) {
        updated = prev.filter(w => w.id !== item.id);
      } else {
        updated = [...prev, item];
      }
      try {
        localStorage.setItem('mk_wishlist', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const isInWishlist = React.useCallback((id: string) => wishlistItems.some(item => item.id === id), [wishlistItems]);

  const removeFromWishlist = React.useCallback((id: string) => {
    setWishlistItems(prev => {
      const updated = prev.filter(item => item.id !== id);
      try {
        localStorage.setItem('mk_wishlist', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const clearWishlist = React.useCallback(() => {
    setWishlistItems([]);
    try {
      localStorage.removeItem('mk_wishlist');
    } catch {
      // storage ignored
    }
  }, []);

  // Auth Actions
  const login = React.useCallback(async (email: string) => {
    const loggedUser: AuthUser = {
      ...DEFAULT_USER,
      email,
      name: email.split('@')[0].replace(/[._-]/g, ' '),
    };
    setUser(loggedUser);
    try {
      localStorage.setItem('mk_user', JSON.stringify(loggedUser));
    } catch {
      // storage ignored
    }
    return true;
  }, []);

  const register = React.useCallback(async (name: string, email: string, phone: string) => {
    const newUser: AuthUser = {
      ...DEFAULT_USER,
      id: `usr-${Date.now()}`,
      name,
      email,
      phone,
    };
    setUser(newUser);
    try {
      localStorage.setItem('mk_user', JSON.stringify(newUser));
    } catch {
      // storage ignored
    }
    return true;
  }, []);

  const logout = React.useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem('mk_user');
    } catch {
      // storage ignored
    }
  }, []);

  const updateUser = React.useCallback((data: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...data };
      try {
        localStorage.setItem('mk_user', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const addAddress = React.useCallback((address: Omit<SavedAddress, 'id'>) => {
    setUser(prev => {
      if (!prev) return prev;
      const newAddr: SavedAddress = {
        ...address,
        id: `addr-${Date.now()}`,
      };
      const addresses = address.isDefault ? prev.addresses.map(a => ({ ...a, isDefault: false })).concat(newAddr) : [...prev.addresses, newAddr];
      const updated = { ...prev, addresses };
      try {
        localStorage.setItem('mk_user', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const deleteAddress = React.useCallback((id: string) => {
    setUser(prev => {
      if (!prev) return prev;
      const addresses = prev.addresses.filter(a => a.id !== id);
      const updated = { ...prev, addresses };
      try {
        localStorage.setItem('mk_user', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const setDefaultAddress = React.useCallback((id: string) => {
    setUser(prev => {
      if (!prev) return prev;
      const addresses = prev.addresses.map(a => ({ ...a, isDefault: a.id === id }));
      const updated = { ...prev, addresses };
      try {
        localStorage.setItem('mk_user', JSON.stringify(updated));
      } catch {
        // storage ignored
      }
      return updated;
    });
  }, []);

  const cartContextValue = React.useMemo(
    () => ({
      items: cartItems,
      itemCount,
      subtotal,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      isCartDrawerOpen,
      setIsCartDrawerOpen,
    }),
    [cartItems, itemCount, subtotal, addItem, updateQuantity, removeItem, clearCart, isCartDrawerOpen]
  );

  const wishlistContextValue = React.useMemo(
    () => ({
      items: wishlistItems,
      wishlistCount: wishlistItems.length,
      toggleWishlist,
      isInWishlist,
      removeFromWishlist,
      clearWishlist,
    }),
    [wishlistItems, toggleWishlist, isInWishlist, removeFromWishlist, clearWishlist]
  );

  const authContextValue = React.useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      updateUser,
      addAddress,
      deleteAddress,
      setDefaultAddress,
    }),
    [user, login, register, logout, updateUser, addAddress, deleteAddress, setDefaultAddress]
  );

  const configContextValue = React.useMemo(
    () => ({
      config,
      isLoading,
      refreshConfig,
    }),
    [config, isLoading, refreshConfig]
  );

  return (
    <ConfigContext.Provider value={configContextValue}>
      <AuthContext.Provider value={authContextValue}>
        <WishlistContext.Provider value={wishlistContextValue}>
          <CartContext.Provider value={cartContextValue}>{children}</CartContext.Provider>
        </WishlistContext.Provider>
      </AuthContext.Provider>
    </ConfigContext.Provider>
  );
}
