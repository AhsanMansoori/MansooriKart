import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, MessageSquare, Sparkles, ShoppingBag, ArrowRight } from 'lucide-react';
import { Button } from '@mansoorikart/ui';
import { storefrontApi, toProductData } from '../../lib/api/storefront';
import { TrustBadgeStrip } from '../../components/TrustBadgeStrip';
import { ShopClientShell } from './_components/ShopClientShell';

interface ShopPageProps {
  searchParams: Promise<{
    category?: string;
    brand?: string;
    search?: string;
    minPrice?: string;
    maxPrice?: string;
    sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating';
    page?: string;
  }>;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const resolvedParams = await searchParams;

  const minPriceNum = resolvedParams.minPrice ? Number(resolvedParams.minPrice) : undefined;
  const maxPriceNum = resolvedParams.maxPrice ? Number(resolvedParams.maxPrice) : undefined;
  const pageNum = resolvedParams.page ? Number(resolvedParams.page) : 1;

  // Fetch filtered catalog, categories, and brands
  const [productsRes, categoriesRes, brandsRes] = await Promise.all([
    storefrontApi.getProducts({
      category: resolvedParams.category,
      brand: resolvedParams.brand,
      search: resolvedParams.search,
      minPrice: minPriceNum,
      maxPrice: maxPriceNum,
      sort: resolvedParams.sort,
      page: pageNum,
      limit: 24,
    }),
    storefrontApi.getCategories(),
    storefrontApi.getBrands(),
  ]);

  const products = (productsRes.data || []).map(toProductData);
  const total = productsRes.meta?.total ?? products.length;
  const categories = categoriesRes.data || [];
  const brands = brandsRes.data || [];

  return (
    <div className="space-y-10 pb-16">
      {/* ==================================================================== */}
      {/* 1. HERO / INTRO BANNER                                               */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <div className="relative rounded-3xl bg-gradient-to-r from-surface-teal via-surface-mint to-teal-50 border border-border-mint/80 p-8 sm:p-12 overflow-hidden shadow-[0_10px_35px_-5px_rgba(13,148,136,0.1)]">
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4 text-center lg:text-left">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 text-brand-teal text-xs font-bold uppercase tracking-wider border border-border-mint shadow-xs">
                <Sparkles className="w-3.5 h-3.5" /> DISCOVER MORE
              </span>

              <h1 className="text-3xl sm:text-5xl font-black text-brand-navy tracking-tight leading-tight">
                Shop Smarter <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-teal via-brand-mint to-brand-mint-dark">Live Better</span>
              </h1>

              <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Explore our curated collection of verified tech essentials, modern home electronics, and lifestyle must-haves — with fast, authentic UAE
                fulfilment.
              </p>
            </div>

            {/* Right Badge Pill / Visual */}
            <div className="lg:col-span-4 flex items-center justify-center lg:justify-end">
              <div className="p-4 rounded-2xl bg-white/90 backdrop-blur-xs border border-white/80 shadow-lg text-left space-y-1">
                <span className="text-xs font-bold text-brand-navy block">Quality Products</span>
                <span className="text-xs font-semibold text-brand-teal block">Better Prices</span>
                <div className="flex items-center gap-1.5 pt-1 text-brand-mint text-xs font-bold">
                  Happier You <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 2. TRUST BADGE STRIP                                                 */}
      {/* ==================================================================== */}
      <TrustBadgeStrip />

      {/* ==================================================================== */}
      {/* 3. BREADCRUMB & MAIN CATALOG CONTENT                                 */}
      {/* ==================================================================== */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Breadcrumb Bar */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Link href="/" className="hover:text-brand-teal transition-colors">
            Home
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-brand-navy font-semibold">Shop</span>
          {resolvedParams.category && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
              <span className="capitalize text-brand-teal font-semibold">{resolvedParams.category}</span>
            </>
          )}
        </nav>

        {/* Sidebar Filters + Product Grid Shell */}
        <ShopClientShell
          products={products}
          total={total}
          categories={categories}
          brands={brands}
          currentCategory={resolvedParams.category}
          currentBrand={resolvedParams.brand}
          currentMinPrice={minPriceNum}
          currentMaxPrice={maxPriceNum}
          currentSort={resolvedParams.sort}
        />

        {/* ==================================================================== */}
        {/* 4. CAN'T FIND WHAT YOU'RE LOOKING FOR? CTA BAND                     */}
        {/* ==================================================================== */}
        <div className="rounded-3xl bg-gradient-to-r from-surface-mint via-teal-50 to-surface-teal border border-border-mint p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm">
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-12 h-12 rounded-2xl bg-white shadow-xs border border-border-mint flex items-center justify-center text-brand-mint shrink-0">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-brand-navy">Can&apos;t find what you&apos;re looking for?</h3>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">Let our verified shopping advisors help you source the perfect model.</p>
            </div>
          </div>

          <a href="https://wa.me/971501234567" target="_blank" rel="noreferrer" className="shrink-0">
            <Button variant="primary" size="md" className="rounded-full px-6 gap-2 text-xs font-bold shadow-md shadow-brand-mint/20">
              <MessageSquare className="w-4 h-4" />
              Talk to a Specialist
            </Button>
          </a>
        </div>
      </main>
    </div>
  );
}
