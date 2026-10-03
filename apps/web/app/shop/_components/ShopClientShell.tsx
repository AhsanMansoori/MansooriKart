'use client';

import * as React from 'react';
import type { ProductData } from '@mansoorikart/ui';
import type { CategorySummary, BrandSummary } from '../../../lib/api/types';
import { ShopControls } from './ShopControls';
import { ShopSidebarFilters } from './ShopSidebarFilters';
import { ShopProductGrid } from './ShopProductGrid';

interface ShopClientShellProps {
  products: ProductData[];
  total: number;
  categories: CategorySummary[];
  brands: BrandSummary[];
  currentCategory?: string;
  currentBrand?: string;
  currentMinPrice?: number;
  currentMaxPrice?: number;
  currentSort?: string;
}

export function ShopClientShell({
  products,
  total,
  categories,
  brands,
  currentCategory,
  currentBrand,
  currentMinPrice,
  currentMaxPrice,
  currentSort,
}: ShopClientShellProps) {
  const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid');

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Sidebar Filters */}
      <ShopSidebarFilters
        categories={categories}
        brands={brands}
        currentCategory={currentCategory}
        currentBrand={currentBrand}
        currentMinPrice={currentMinPrice}
        currentMaxPrice={currentMaxPrice}
      />

      {/* Main Content Area */}
      <div className="flex-1 w-full space-y-6">
        <ShopControls total={total} currentCount={products.length} currentSort={currentSort} viewMode={viewMode} onViewModeChange={setViewMode} />

        <ShopProductGrid products={products} viewMode={viewMode} />
      </div>
    </div>
  );
}
