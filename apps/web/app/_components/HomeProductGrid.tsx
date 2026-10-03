'use client';

import * as React from 'react';
import { ProductCard, type ProductData } from '@mansoorikart/ui';
import { AddToCartModal, type AddedProductInfo } from '../../components/AddToCartModal';
import { useCart } from '../../components/providers';

interface HomeProductGridProps {
  products: ProductData[];
  actionVariant?: 'button' | 'iconOnly';
}

export function HomeProductGrid({ products, actionVariant = 'button' }: HomeProductGridProps) {
  const { addItem } = useCart();
  const [addedProduct, setAddedProduct] = React.useState<AddedProductInfo | null>(null);
  const [wishlistedIds, setWishlistedIds] = React.useState<Set<string>>(new Set());

  const handleAddToCart = (_e: React.MouseEvent, product: ProductData) => {
    addItem({
      productId: product.id,
      title: product.title,
      price: product.price,
      quantity: 1,
      image: product.image,
    });
    setAddedProduct({
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image,
      quantity: 1,
    });
  };

  const handleToggleWishlist = (_e: React.MouseEvent, productId: string) => {
    setWishlistedIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6">
        {products.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            actionVariant={actionVariant}
            isWishlisted={wishlistedIds.has(product.id)}
            onAddToCart={handleAddToCart}
            onToggleWishlist={handleToggleWishlist}
          />
        ))}
      </div>

      <AddToCartModal product={addedProduct} onClose={() => setAddedProduct(null)} />
    </>
  );
}
