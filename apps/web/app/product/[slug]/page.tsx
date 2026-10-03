import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, Share2, Sparkles, Headphones, BatteryCharging, PhoneCall, Sliders, Volume2, Plane, Leaf, Video } from 'lucide-react';
import { Badge, Rating } from '@mansoorikart/ui';
import { storefrontApi, toProductData } from '../../../lib/api/storefront';
import { TrustBadgeStrip } from '../../../components/TrustBadgeStrip';
import { HomeProductGrid } from '../../_components/HomeProductGrid';
import { ProductGallery } from './_components/ProductGallery';
import { ProductBuyBox } from './_components/ProductBuyBox';
import { ProductTabs } from './_components/ProductTabs';

interface ProductPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const resolvedParams = await params;
  const productRes = await storefrontApi.getProductByIdentifier(resolvedParams.slug);

  if (!productRes.data) {
    notFound();
  }

  const product = productRes.data;

  // Fetch "You may also like" related products from the same category
  const relatedRes = await storefrontApi.getProducts({
    category: product.category,
    limit: 6,
  });

  const relatedProducts = (relatedRes.data || [])
    .filter(p => p.id !== product.id && p.slug !== product.slug)
    .slice(0, 5)
    .map(toProductData);

  const images = (Array.isArray(product.images) ? product.images : []).map(img =>
    typeof img === 'string' ? { url: img, alt: product.name } : { url: img.url, alt: img.alt || product.name }
  );

  const discountAmount = product.compareAtPrice ? product.compareAtPrice - product.price : 0;
  const discountPct = product.compareAtPrice ? Math.round((discountAmount / product.compareAtPrice) * 100) : 0;
  const badgeText = discountPct > 0 ? `-${discountPct}%` : undefined;

  return (
    <div className="space-y-12 pb-16">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8">
        {/* ==================================================================== */}
        {/* 1. BREADCRUMBS & SHARE                                               */}
        {/* ==================================================================== */}
        <div className="flex items-center justify-between gap-4 text-xs text-slate-500 pb-2 border-b border-slate-100">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 flex-wrap font-medium">
            <Link href="/" className="hover:text-brand-teal transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <Link href="/shop" className="hover:text-brand-teal transition-colors">
              Shop
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <Link href={`/shop?category=${product.category.toLowerCase()}`} className="hover:text-brand-teal transition-colors">
              {product.category}
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <span className="text-brand-navy font-semibold line-clamp-1">{product.name}</span>
          </nav>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors shrink-0"
            aria-label="Share product"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>

        {/* ==================================================================== */}
        {/* 2. GALLERY + MAIN DETAILS & BUY BOX                                  */}
        {/* ==================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: Image Gallery (5 Cols) */}
          <div className="lg:col-span-5">
            <ProductGallery images={images} title={product.name} badge={badgeText} />
          </div>

          {/* Right Column: Title, Rating, Feature Micro-chips & Buy Box (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Title & Brand Header */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-teal">{product.brand}</span>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-brand-navy tracking-tight leading-snug">{product.name}</h1>
              {product.shortDescription && <p className="text-xs sm:text-sm text-slate-500 font-medium">{product.shortDescription}</p>}
            </div>

            {/* Rating Stars & Stock Badge */}
            <div className="flex items-center gap-3">
              <Rating value={product.ratingAverage || 4.8} count={product.ratingCount || 320} size="md" showValue showCount />
              <Badge variant="mint" size="sm" className="gap-1">
                In Stock
              </Badge>
            </div>

            {/* Description Excerpt */}
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-3">{product.description}</p>

            {/* 4 Feature Micro-Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="p-2.5 rounded-2xl bg-surface-teal border border-border-teal flex items-center gap-2 text-xs text-brand-navy font-semibold">
                <Headphones className="w-4 h-4 text-brand-teal shrink-0" />
                <span className="line-clamp-1">Noise Cancelling</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-surface-mint border border-border-mint flex items-center gap-2 text-xs text-brand-navy font-semibold">
                <BatteryCharging className="w-4 h-4 text-brand-mint shrink-0" />
                <span className="line-clamp-1">30h Battery</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-surface-teal border border-border-teal flex items-center gap-2 text-xs text-brand-navy font-semibold">
                <PhoneCall className="w-4 h-4 text-brand-teal shrink-0" />
                <span className="line-clamp-1">Hands-free Calls</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-surface-mint border border-border-mint flex items-center gap-2 text-xs text-brand-navy font-semibold">
                <Sliders className="w-4 h-4 text-brand-mint shrink-0" />
                <span className="line-clamp-1">Comfort Fit</span>
              </div>
            </div>

            {/* Interactive Buy Box */}
            <div className="pt-2">
              <ProductBuyBox product={product} />
            </div>
          </div>
        </div>

        {/* ==================================================================== */}
        {/* 3. FEATURE HIGHLIGHT BANNER                                         */}
        {/* ==================================================================== */}
        <div className="rounded-3xl bg-gradient-to-r from-surface-mint via-teal-50 to-surface-teal border border-border-mint p-6 sm:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-brand-teal shadow-xs shrink-0">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-brand-navy">Immersive Sound</h4>
                <p className="text-[11px] text-slate-500">Hi-Res Audio verified</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-brand-mint shadow-xs shrink-0">
                <Plane className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-brand-navy">Perfect for Travel</h4>
                <p className="text-[11px] text-slate-500">Block distractions</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-brand-teal shadow-xs shrink-0">
                <Leaf className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-brand-navy">Sustainable Choice</h4>
                <p className="text-[11px] text-slate-500">Eco-friendly materials</p>
              </div>
            </div>
          </div>

          <div className="md:col-span-5 p-4 rounded-2xl bg-white border border-border-mint flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-brand-navy block">A Smarter Way to Listen</span>
              <span className="text-[11px] text-slate-500 block">Premium audio engineered for daily excellence.</span>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-navy text-white text-xs font-semibold shrink-0 hover:bg-brand-navy-light transition-colors"
            >
              <Video className="w-3.5 h-3.5" />
              Watch Video
            </button>
          </div>
        </div>

        {/* ==================================================================== */}
        {/* 4. TABS SECTION                                                      */}
        {/* ==================================================================== */}
        <ProductTabs product={product} />

        {/* ==================================================================== */}
        {/* 5. YOU MAY ALSO LIKE                                                 */}
        {/* ==================================================================== */}
        <section className="space-y-6 pt-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-teal mb-1">
                <Sparkles className="w-3.5 h-3.5" /> Recommended
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-navy">You may also like</h2>
              <p className="text-sm text-slate-500 mt-1">Similar products handpicked for you in {product.category}.</p>
            </div>
            <Link href="/shop" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal hover:text-brand-teal-dark transition-colors">
              View all products <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <HomeProductGrid products={relatedProducts} actionVariant="button" />
        </section>
      </main>

      {/* ==================================================================== */}
      {/* 6. BOTTOM TRUST STRIP                                                */}
      {/* ==================================================================== */}
      <TrustBadgeStrip />
    </div>
  );
}
