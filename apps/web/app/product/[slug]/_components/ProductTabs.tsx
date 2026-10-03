'use client';

import * as React from 'react';
import { CheckCircle2, Star, Truck, RotateCcw, PackageCheck } from 'lucide-react';
import { Rating, Button } from '@mansoorikart/ui';
import type { CatalogProduct } from '../../../../lib/api/types';

interface ProductTabsProps {
  product: CatalogProduct;
}

export function ProductTabs({ product }: ProductTabsProps) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'specifications' | 'box' | 'reviews' | 'shipping'>('overview');

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'specifications' as const, label: 'Specifications' },
    { id: 'box' as const, label: "What's in the Box" },
    { id: 'reviews' as const, label: `Reviews (${product.ratingCount || 320})` },
    { id: 'shipping' as const, label: 'Shipping & Returns' },
  ];

  const features = product.features || [
    'Industry-leading active noise cancellation with dual processors',
    'Up to 30 hours battery life with ultra-fast 3-minute quick charge',
    'Crystal clear hands-free calls with 4 beamforming microphones',
    'Multipoint connection to switch effortlessly between devices',
    'Touch sensor controls for volume, playback, and voice assistant',
    'Lightweight ergonomic fit with ultra-soft synthetic leather cushions',
    'Includes protective carrying case and high-resolution audio cable',
  ];

  const specs = product.specs || {
    Brand: product.brand,
    Category: product.category,
    Model: product.sku || product.name,
    Connectivity: 'Bluetooth 5.2 & 3.5mm Audio Jack',
    'Battery Life': 'Up to 30 Hours (ANC On) / 40 Hours (ANC Off)',
    'Charging Port': 'USB Type-C',
    Weight: '250 grams',
    Warranty: '1 Year UAE Official Distributor Warranty',
  };

  const inTheBox = product.inTheBox || [
    product.name,
    'Hard Shell Carrying Case',
    'USB-C Fast Charging Cable',
    '3.5mm Gold-Plated Audio Cable (1.2m)',
    'User Manual & UAE Warranty Card',
  ];

  return (
    <section className="space-y-6 pt-6">
      {/* Tabs Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-px">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-xs sm:text-sm font-bold transition-all border-b-2 whitespace-nowrap ${
                isActive ? 'border-brand-teal text-brand-teal' : 'border-transparent text-slate-500 hover:text-brand-navy hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content Panels */}
      <div className="p-6 rounded-3xl bg-white border border-slate-100 shadow-[0_4px_20px_-2px_rgba(11,25,44,0.03)]">
        {/* 1. Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-7 space-y-4">
              <h3 className="text-base font-bold text-brand-navy">Product Description</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line">{product.description}</p>
            </div>

            <div className="md:col-span-5 space-y-3">
              <h3 className="text-base font-bold text-brand-navy">Key Features</h3>
              <ul className="space-y-2.5">
                {features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-brand-mint shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 2. Specifications */}
        {activeTab === 'specifications' && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-brand-navy">Technical Specifications</h3>
            <div className="rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-100">
              {Object.entries(specs).map(([key, val]) => (
                <div key={key} className="grid grid-cols-1 sm:grid-cols-3 p-3.5 text-xs">
                  <span className="font-bold text-slate-500">{key}</span>
                  <span className="sm:col-span-2 font-medium text-brand-navy">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. What's in the Box */}
        {activeTab === 'box' && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-brand-navy">Package Contents</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {inTheBox.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100 text-xs font-semibold text-brand-navy">
                  <PackageCheck className="w-4 h-4 text-brand-teal" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Reviews Tab */}
        {activeTab === 'reviews' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-extrabold text-brand-navy">{product.ratingAverage || 4.8}</span>
                  <Rating value={product.ratingAverage || 4.8} count={product.ratingCount || 320} size="md" showCount />
                </div>
                <p className="text-xs text-slate-500 mt-1">Based on {product.ratingCount || 320} verified UAE purchases.</p>
              </div>

              <Button variant="outline" size="sm" className="rounded-full text-xs font-semibold">
                Write a Review
              </Button>
            </div>

            {/* Review Cards (Placeholder list until reviews API integration) */}
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-brand-navy">Rashid M. (Dubai)</span>
                  <span className="text-slate-400">2 days ago</span>
                </div>
                <div className="flex items-center gap-1 text-brand-gold">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-brand-gold" />
                  ))}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Best purchase this year. The noise cancellation completely silences metro and office chatter. Battery lasts easily for my entire work week.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-brand-navy">Fatima A. (Abu Dhabi)</span>
                  <span className="text-slate-400">1 week ago</span>
                </div>
                <div className="flex items-center gap-1 text-brand-gold">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-brand-gold" />
                  ))}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Original sealed box, registered the serial number on Sony website without any issues. Delivered next morning in Abu Dhabi!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 5. Shipping & Returns */}
        {activeTab === 'shipping' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-brand-navy">
                <Truck className="w-4 h-4 text-brand-teal" />
                <span>UAE Delivery Timeline</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                • <strong>Dubai & Sharjah:</strong> Same-day or next-day delivery on orders placed before 2 PM.
                <br />• <strong>Abu Dhabi & Northern Emirates:</strong> 1-2 business days with SMS tracking.
                <br />• Free express delivery applies automatically on all orders above AED 100.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-brand-navy">
                <RotateCcw className="w-4 h-4 text-brand-mint" />
                <span>30-Day Return & Exchange</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Eligible for free return or exchange within 30 days of delivery in original condition and packaging. Return pickups are arranged from your
                doorstep.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
