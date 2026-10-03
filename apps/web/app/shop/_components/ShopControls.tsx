'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { LayoutGrid, List } from 'lucide-react';
import { Select } from '@mansoorikart/ui';

interface ShopControlsProps {
  total: number;
  currentCount: number;
  currentSort?: string;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
}

export function ShopControls({ total, currentCount, currentSort = 'newest', viewMode, onViewModeChange }: ShopControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newSort === 'newest') {
      params.delete('sort');
    } else {
      params.set('sort', newSort);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
      <div className="text-xs sm:text-sm text-slate-500 font-medium">
        Showing <span className="font-bold text-brand-navy">1-{currentCount}</span> of <span className="font-bold text-brand-navy">{total}</span> products
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Sort by</span>
          <Select
            value={currentSort}
            onChange={e => handleSortChange(e.target.value)}
            options={[
              { label: 'Featured / Top Picks', value: 'newest' },
              { label: 'Price: Low to High', value: 'price_asc' },
              { label: 'Price: High to Low', value: 'price_desc' },
              { label: 'Highest Rated', value: 'rating' },
            ]}
            className="w-48 text-xs py-1.5 bg-white border-slate-200"
          />
        </div>

        <div className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200/60">
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            aria-label="Grid view"
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'grid' ? 'bg-brand-teal text-white shadow-xs' : 'text-slate-600 hover:text-brand-navy'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            aria-label="List view"
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'list' ? 'bg-brand-teal text-white shadow-xs' : 'text-slate-600 hover:text-brand-navy'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
