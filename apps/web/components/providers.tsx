'use client';

import * as React from 'react';

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
}

export function Providers({ children }: ProvidersProps) {
  const [itemCount, setItemCount] = React.useState(0);
  const [subtotal, setSubtotal] = React.useState(0);

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

  const contextValue = React.useMemo(
    () => ({
      itemCount,
      subtotal,
      addItem,
      removeItem,
      clearCart,
    }),
    [itemCount, subtotal, addItem, removeItem, clearCart]
  );

  return <CartContext.Provider value={contextValue}>{children}</CartContext.Provider>;
}
