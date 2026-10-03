'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, RotateCcw, ChevronDown, Search } from 'lucide-react';
import { Button, Input, formatCurrency } from '@mansoorikart/ui';
import type { CategorySummary, BrandSummary } from '../../../lib/api/types';

interface ShopSidebarFiltersProps {
  categories: CategorySummary[];
  brands: BrandSummary[];
  currentCategory?: string;
  currentBrand?: string;
  currentMinPrice?: number;
  currentMaxPrice?: number;
}

export function ShopSidebarFilters({ categories, brands, currentCategory, currentBrand, currentMinPrice, currentMaxPrice }: ShopSidebarFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [categoryOpen, setCategoryOpen] = React.useState(true);
  const [priceOpen, setPriceOpen] = React.useState(true);
  const [brandOpen, setBrandOpen] = React.useState(true);
  const [brandSearch, setBrandSearch] = React.useState('');

  const minPrice = currentMinPrice ?? 0;
  const [maxPrice, setMaxPrice] = React.useState<number>(currentMaxPrice ?? 5000);

  const applyParam = (key: string, value: string | undefined | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  const handlePriceCommit = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (minPrice > 0) params.set('minPrice', String(minPrice));
    else params.delete('minPrice');
    if (maxPrice < 5000) params.set('maxPrice', String(maxPrice));
    else params.delete('maxPrice');
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleResetAll = () => {
    router.push(pathname);
  };

  const filteredBrands = brands.filter(b => b.name.toLowerCase().includes(brandSearch.toLowerCase()));

  const hasActiveFilters = Boolean(currentCategory || currentBrand || currentMinPrice !== undefined || currentMaxPrice !== undefined);

  return (
    <aside className="w-full lg:w-64 space-y-6">
      {/* Filters Title Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2 text-brand-navy font-bold text-base">
          <SlidersHorizontal className="w-4 h-4 text-brand-teal" />
          <span>Filters</span>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleResetAll} className="h-7 px-2 text-xs text-brand-teal font-semibold gap-1 hover:bg-slate-100">
            <RotateCcw className="w-3 h-3" /> Reset All
          </Button>
        )}
      </div>

      {/* 1. Category Section */}
      <div className="space-y-3 pb-5 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setCategoryOpen(!categoryOpen)}
          className="w-full flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-brand-navy"
        >
          <span>Category</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${categoryOpen ? 'rotate-180' : ''}`} />
        </button>

        {categoryOpen && (
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer hover:text-brand-teal select-none">
              <input
                type="radio"
                name="category"
                checked={!currentCategory}
                onChange={() => applyParam('category', undefined)}
                className="w-4 h-4 text-brand-teal border-slate-300 rounded focus:ring-brand-mint"
              />
              <span className="font-semibold">All Categories</span>
            </label>

            {categories.map(cat => {
              const isChecked = currentCategory?.toLowerCase() === cat.slug.toLowerCase();
              return (
                <label key={cat.id} className="flex items-center justify-between text-xs text-slate-700 cursor-pointer hover:text-brand-teal select-none">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="category"
                      checked={isChecked}
                      onChange={() => applyParam('category', cat.slug)}
                      className="w-4 h-4 text-brand-teal border-slate-300 rounded focus:ring-brand-mint"
                    />
                    <span className={isChecked ? 'font-bold text-brand-teal' : 'font-normal'}>{cat.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">{cat.productCount ?? 15}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Price Range Section */}
      <div className="space-y-3 pb-5 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setPriceOpen(!priceOpen)}
          className="w-full flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-brand-navy"
        >
          <span>Price Range</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${priceOpen ? 'rotate-180' : ''}`} />
        </button>

        {priceOpen && (
          <div className="space-y-3 pt-1">
            <input
              type="range"
              min="0"
              max="5000"
              step="50"
              value={maxPrice}
              onChange={e => setMaxPrice(Number(e.target.value))}
              onMouseUp={handlePriceCommit}
              onTouchEnd={handlePriceCommit}
              className="w-full accent-brand-mint h-1.5 bg-slate-200 rounded-lg cursor-pointer"
            />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-500">{formatCurrency(minPrice, 'AED', 0)}</span>
              <span className="text-slate-400">—</span>
              <span className="font-bold text-brand-navy">{formatCurrency(maxPrice, 'AED', 0)}</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Brand Section */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setBrandOpen(!brandOpen)}
          className="w-full flex items-center justify-between text-xs font-extrabold uppercase tracking-wider text-brand-navy"
        >
          <span>Brand</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${brandOpen ? 'rotate-180' : ''}`} />
        </button>

        {brandOpen && (
          <div className="space-y-2 pt-1">
            <Input
              type="search"
              placeholder="Search brands..."
              value={brandSearch}
              onChange={e => setBrandSearch(e.target.value)}
              leftIcon={<Search className="w-3.5 h-3.5 text-slate-400" />}
              className="text-xs py-1.5 h-8 bg-slate-50 border-slate-200 focus:bg-white"
            />

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer hover:text-brand-teal select-none">
                <input
                  type="radio"
                  name="brand"
                  checked={!currentBrand}
                  onChange={() => applyParam('brand', undefined)}
                  className="w-4 h-4 text-brand-teal border-slate-300 rounded focus:ring-brand-mint"
                />
                <span className="font-semibold">All Brands</span>
              </label>

              {filteredBrands.map(b => {
                const isChecked = currentBrand?.toLowerCase() === b.slug.toLowerCase();
                return (
                  <label key={b.id} className="flex items-center justify-between text-xs text-slate-700 cursor-pointer hover:text-brand-teal select-none">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="brand"
                        checked={isChecked}
                        onChange={() => applyParam('brand', b.slug)}
                        className="w-4 h-4 text-brand-teal border-slate-300 rounded focus:ring-brand-mint"
                      />
                      <span className={isChecked ? 'font-bold text-brand-teal' : 'font-normal'}>{b.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{b.productCount ?? 10}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
