'use client';

import * as React from 'react';
import { storefrontApi } from '../lib/api/storefront';
import { StorefrontConfig } from '../lib/api/types';

export const DEFAULT_STORE_CONFIG: StorefrontConfig = {
  storeName: 'MansooriKart',
  legalName: 'MansooriKart LLC',
  tagline: 'UAE Premier Marketplace',
  logoUrl: null,
  faviconUrl: null,
  currency: {
    code: 'AED',
    display: 'SYMBOL',
  },
  timezone: 'Asia/Dubai',
  locale: 'en-AE',
  contact: {
    supportEmail: null,
    supportPhone: null,
    whatsapp: null,
    supportHours: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    stateProvince: null,
    postalCode: null,
    country: 'AE',
  },
  socialLinks: [],
  seo: {
    metaTitle: 'MansooriKart | UAE Premier Marketplace',
    metaDescription: null,
    metaKeywords: [],
    canonicalUrl: null,
    robots: 'index,follow',
    socialImageUrl: null,
  },
  shipping: {
    enabled: true,
    standardFee: 15,
    freeShippingEnabled: true,
    freeShippingThreshold: 200,
    codEnabled: true,
    deliveryEstimate: null,
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

interface CartContextValue {
  itemCount: number;
  subtotal: number;
  addItem: (item: unknown) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
}

const CartContext = React.createContext<CartContextValue>({
  itemCount: 0,
  subtotal: 0,
  addItem: () => {},
  removeItem: () => {},
  clearCart: () => {},
});

export function useCart() {
  return React.useContext(CartContext);
}

interface ProvidersProps {
  children: React.ReactNode;
  initialConfig?: StorefrontConfig;
}

export function Providers({ children, initialConfig }: ProvidersProps) {
  const [config, setConfig] = React.useState<StorefrontConfig>(initialConfig ?? DEFAULT_STORE_CONFIG);
  const [isLoading, setIsLoading] = React.useState(!initialConfig);
  const [itemCount, setItemCount] = React.useState(0);
  const [subtotal, setSubtotal] = React.useState(0);

  const refreshConfig = React.useCallback(async () => {
    try {
      const res = await storefrontApi.getConfig();
      if (res && res.data) {
        setConfig(res.data);
      }
    } catch {
      // Backend may be offline during SSR / dev; maintain baseline UAE configuration
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let ignore = false;
    storefrontApi
      .getConfig()
      .then(res => {
        if (!ignore && res?.data) {
          setConfig(res.data);
        }
      })
      .catch(() => {
        // Maintain baseline UAE configuration
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const addItem = React.useCallback(() => {
    setItemCount(prev => prev + 1);
  }, []);

  const removeItem = React.useCallback(() => {
    setItemCount(prev => Math.max(0, prev - 1));
  }, []);

  const clearCart = React.useCallback(() => {
    setItemCount(0);
    setSubtotal(0);
  }, []);

  const cartContextValue = React.useMemo(
    () => ({
      itemCount,
      subtotal,
      addItem,
      removeItem,
      clearCart,
    }),
    [itemCount, subtotal, addItem, removeItem, clearCart]
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
      <CartContext.Provider value={cartContextValue}>{children}</CartContext.Provider>
    </ConfigContext.Provider>
  );
}
