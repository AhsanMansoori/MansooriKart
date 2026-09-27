'use client';

import * as React from 'react';
import {
  Button,
  Input,
  Select,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Rating,
  TrustBadge,
  PriceDisplay,
  ProductCard,
} from '@mansoorikart/ui';
import { Sparkles, ShieldCheck, Search, CheckCircle2 } from 'lucide-react';

export default function FoundationShowcase() {
  const [selectedEmirate, setSelectedEmirate] = React.useState('dxb');
  const [wishlisted, setWishlisted] = React.useState(false);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
      {/* Foundation Status Banner */}
      <div className="rounded-2xl p-6 bg-gradient-to-r from-teal-900 to-slate-900 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> Phase 3a: Storefront Foundation Verified
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Design System & Shared Component Library</h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              All core UI components, design tokens, typography, and API client layers have been established in{' '}
              <code className="text-emerald-400">packages/ui</code> and verified in the <code className="text-emerald-400">apps/web</code> shell.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="bestseller" size="lg">
              AED Native
            </Badge>
            <Badge variant="new" size="lg">
              UAE 5% VAT
            </Badge>
          </div>
        </div>
      </div>

      {/* Grid of Shared Components Verification */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Column 1: ProductCard Showcase */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Shared Component: ProductCard</span>
            <Badge variant="mint" size="sm">
              Single Source of Truth
            </Badge>
          </div>

          <ProductCard
            product={{
              id: 'demo-prod-1',
              title: 'Sony WH-1000XM5 Wireless Noise-Cancelling Headphones',
              category: 'Audio & Wearables',
              price: 1199,
              originalPrice: 1499,
              rating: 4.9,
              ratingCount: 284,
              badge: '-20%',
              badgeVariant: 'discount',
              image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80',
            }}
            isWishlisted={wishlisted}
            onToggleWishlist={() => setWishlisted(!wishlisted)}
            onAddToCart={() => alert('Add to cart triggered')}
          />
        </div>

        {/* Column 2: Form Controls (Input, Select, Button) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Form Controls & Buttons</span>
            <Badge variant="outline" size="sm">
              Form Inputs
            </Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Delivery & Preferences</CardTitle>
              <CardDescription>Testing Input, Select, and Button components from packages/ui.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">Select Delivery Emirate</label>
                <Select
                  value={selectedEmirate}
                  onChange={e => setSelectedEmirate(e.target.value)}
                  options={[
                    { label: 'Dubai (Same Day Delivery)', value: 'dxb' },
                    { label: 'Abu Dhabi (Next Day Delivery)', value: 'auh' },
                    { label: 'Sharjah (Next Day Delivery)', value: 'shj' },
                    { label: 'Ajman & Northern Emirates', value: 'ajm' },
                  ]}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">Coupon / Discount Code</label>
                <Input placeholder="Enter UAE promotional code" leftIcon={<Search className="w-4 h-4 text-slate-400" />} />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="primary" size="md">
                  Primary Action
                </Button>
                <Button variant="secondary" size="md">
                  Secondary
                </Button>
                <Button variant="outline" size="md">
                  Outline
                </Button>
              </div>
            </CardContent>
            <CardFooter className="bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Validation OK
              </span>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Column 3: Badges, PriceDisplay, Rating, TrustBadge */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Display & Value Badges</span>
            <Badge variant="teal" size="sm">
              Displays
            </Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pricing & Trust System</CardTitle>
              <CardDescription>AED single source of truth and trust credentials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <span className="text-xs font-bold text-slate-500 block mb-2">PriceDisplay Sizes:</span>
                <div className="space-y-2">
                  <PriceDisplay amount={149} originalAmount={199} size="sm" showDiscount />
                  <br />
                  <PriceDisplay amount={1299} originalAmount={1599} size="md" showDiscount />
                  <br />
                  <PriceDisplay amount={4899} originalAmount={5499} size="xl" showDiscount />
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-500 block mb-2">Rating Component:</span>
                <Rating value={4.8} count={342} size="md" showValue showCount />
              </div>

              <div>
                <span className="text-xs font-bold text-slate-500 block mb-2">TrustBadge Component:</span>
                <TrustBadge
                  icon={<ShieldCheck className="w-5 h-5" />}
                  title="UAE Warranty Included"
                  subtitle="1-Year official manufacturer warranty"
                  variant="horizontal"
                  iconVariant="teal"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
