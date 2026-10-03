'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Clock } from 'lucide-react';
import type { ProductData } from '@mansoorikart/ui';

interface RecentlyViewedRowProps {
  initialItems?: ProductData[];
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getSnapshot() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('mk_recently_viewed') || '';
}

function getServerSnapshot() {
  return '';
}

export function RecentlyViewedRow({ initialItems = [] }: RecentlyViewedRowProps) {
  const raw = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const items = React.useMemo(() => {
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as ProductData[];
        }
      } catch {
        // Fall through
      }
    }
    return initialItems;
  }, [raw, initialItems]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-teal" />
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-brand-navy">Recently Viewed</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">The products you opened most recently, kept in this browser only.</p>
        </div>
        <Link href="/shop" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-teal hover:text-brand-teal-dark transition-colors">
          View all <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {items.slice(0, 5).map(item => (
          <Link
            key={item.id}
            href={`/product/${item.slug || item.id}`}
            className="group flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-100 hover:border-border-teal hover:shadow-[0_8px_24px_-4px_rgba(13,148,136,0.1)] transition-all text-center"
          >
            <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-50 mb-2 flex items-center justify-center">
              {item.image ? (
                <Image
                  src={item.image}
                  alt={item.title}
                  fill
                  className="object-cover object-center group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 640px) 50vw, 20vw"
                />
              ) : (
                <span className="text-xs text-slate-400">Preview</span>
              )}
            </div>
            <span className="text-xs font-semibold text-brand-navy line-clamp-1 group-hover:text-brand-teal transition-colors">{item.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
