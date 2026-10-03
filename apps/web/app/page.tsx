import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Sparkles, ShoppingBag, Star, ShieldCheck, Zap, TrendingUp } from 'lucide-react';
import { Button } from '@mansoorikart/ui';
import { storefrontApi, toProductData } from '../lib/api/storefront';
import { TrustBadgeStrip } from '../components/TrustBadgeStrip';
import { HomeProductGrid } from './_components/HomeProductGrid';
import { RecentlyViewedRow } from './_components/RecentlyViewedRow';
import { NewsletterSignup } from './_components/NewsletterSignup';

export default async function HomePage() {
  // Fetch real catalog data from backend API (with canonical fallback)
  const [featuredRes, newArrivalsRes, categoriesRes] = await Promise.all([
    storefrontApi.getProducts({ featured: 'true', limit: 5 }),
    storefrontApi.getProducts({ sort: 'newest', limit: 5 }),
    storefrontApi.getCategories(),
  ]);

  const featuredProducts = (featuredRes.data || []).map(toProductData);
  const newArrivals = (newArrivalsRes.data || []).map(toProductData);
  const categories = categoriesRes.data || [];

  const initialRecentlyViewed = [
    featuredProducts[1] || featuredProducts[0],
    featuredProducts[0],
    featuredProducts[2],
    featuredProducts[3],
    featuredProducts[4],
  ].filter(Boolean);

  const testimonials = [
    {
      id: 't-1',
      name: 'Ali Raza',
      verified: true,
      text: 'Amazing quality and super fast delivery! MansooriKart has become my go-to store for all my tech and daily essentials across Dubai.',
      rating: 5,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    },
    {
      id: 't-2',
      name: 'Sara Khan',
      verified: true,
      text: 'Great prices, authentic products with UAE warranty, and smooth checkout experience. Customer support responded within 2 minutes!',
      rating: 5,
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
    },
    {
      id: 't-3',
      name: 'Usman Sheikh',
      verified: true,
      text: 'Wide product range and genuine brands. Never had an issue with any orders and the return policy is completely hassle-free.',
      rating: 5,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
    },
  ];

  const trustedBrands = [
    { name: 'Apple', slug: 'apple', icon: '' },
    { name: 'Samsung', slug: 'samsung', icon: 'SAMSUNG' },
    { name: 'Nike', slug: 'nike', icon: 'NIKE' },
    { name: 'Adidas', slug: 'adidas', icon: 'ADIDAS' },
    { name: 'Sony', slug: 'sony', icon: 'SONY' },
    { name: 'LG', slug: 'lg', icon: 'LG' },
    { name: 'Philips', slug: 'philips', icon: 'PHILIPS' },
    { name: 'Dyson', slug: 'dyson', icon: 'DYSON' },
    { name: 'Zara', slug: 'zara', icon: 'ZARA' },
    { name: "Levi's", slug: 'levis', icon: "LEVI'S" },
  ];

  return (
    <div className="space-y-16 pb-16">
      {/* ==================================================================== */}
      {/* 1. HERO SECTION                                                      */}
      {/* ==================================================================== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-surface-teal/60 via-surface-mint/30 to-surface-canvas pt-8 pb-12 sm:pt-14 sm:pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Content Column */}
            <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 border border-border-mint shadow-xs text-xs font-semibold text-brand-teal">
                <span className="w-2 h-2 rounded-full bg-brand-mint animate-pulse" />
                Your Everyday Marketplace
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-brand-navy leading-[1.1]">
                Everything you need. <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-teal via-brand-mint to-brand-mint-dark">All in one Kart.</span>
              </h1>

              <p className="text-base sm:text-lg text-slate-600 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Discover top brands, great prices, and a smarter way to shop — authentic lifestyle, electronics, and essentials with fast UAE delivery.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-2">
                <Link href="/shop">
                  <Button variant="primary" size="lg" className="rounded-full px-8 gap-2 text-sm font-bold shadow-lg shadow-brand-mint/25">
                    Shop Now <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="#categories">
                  <Button variant="outline" size="lg" className="rounded-full px-7 text-sm font-semibold bg-white/80 hover:bg-white">
                    Explore Categories
                  </Button>
                </Link>
              </div>

              {/* Trust Metric Chips */}
              <div className="pt-6 border-t border-slate-200/80 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-left">
                <div>
                  <span className="block text-xl font-extrabold text-brand-navy">50K+</span>
                  <span className="text-xs text-slate-500 font-medium">Happy Customers</span>
                </div>
                <div className="h-8 w-px bg-slate-200 hidden sm:block" />
                <div>
                  <span className="block text-xl font-extrabold text-brand-navy">100K+</span>
                  <span className="text-xs text-slate-500 font-medium">Verified Products</span>
                </div>
                <div className="h-8 w-px bg-slate-200 hidden sm:block" />
                <div>
                  <div className="flex items-center gap-1 text-brand-gold">
                    <Star className="w-4 h-4 fill-brand-gold" />
                    <span className="text-xl font-extrabold text-brand-navy">4.8/5</span>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">Customer Rating</span>
                </div>
              </div>
            </div>

            {/* Right Visual Composition */}
            <div className="lg:col-span-6 relative">
              <div className="relative mx-auto max-w-lg lg:max-w-none">
                {/* Floating Discount Badge */}
                <div className="absolute -top-4 right-4 z-20 rounded-2xl bg-brand-gold text-brand-navy font-extrabold p-3 shadow-xl transform rotate-3 hover:rotate-0 transition-transform">
                  <span className="block text-xs uppercase tracking-wider font-bold">Up to</span>
                  <span className="block text-2xl leading-none">40% OFF</span>
                  <span className="block text-[10px] text-brand-navy/80">On Top Brands</span>
                </div>

                {/* Floating Aesthetic Tag */}
                <div className="absolute top-1/2 -left-6 z-20 hidden sm:block bg-white/90 backdrop-blur-md rounded-2xl p-3 shadow-lg border border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-surface-mint flex items-center justify-center text-brand-mint">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-xs font-bold text-brand-navy">Good Things</span>
                      <span className="block text-[11px] text-brand-teal font-medium">Better Prices</span>
                    </div>
                  </div>
                </div>

                {/* Main Hero Showcase Card */}
                <div className="relative rounded-3xl bg-gradient-to-br from-white/95 to-slate-50/80 border border-white/60 p-6 shadow-[0_20px_50px_-10px_rgba(13,148,136,0.15)] overflow-hidden">
                  <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-teal-50 via-mint-50 to-white">
                    <Image
                      src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1000&auto=format&fit=crop&q=80"
                      alt="MansooriKart Tech & Lifestyle Showcase"
                      fill
                      priority
                      className="object-contain object-center p-4 drop-shadow-2xl"
                      sizes="(max-width: 1024px) 100vw, 50vw"
                    />
                  </div>

                  {/* Bottom Mini Product Carousel Strip */}
                  <div className="mt-4 grid grid-cols-4 gap-2 pt-3 border-t border-slate-100">
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-50 border border-slate-100 p-1">
                      <Image
                        src="https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=200&auto=format&fit=crop&q=80"
                        alt="MacBook"
                        fill
                        className="object-contain"
                        sizes="100px"
                      />
                    </div>
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-50 border border-slate-100 p-1">
                      <Image
                        src="https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200&auto=format&fit=crop&q=80"
                        alt="Nike Sneakers"
                        fill
                        className="object-contain"
                        sizes="100px"
                      />
                    </div>
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-50 border border-slate-100 p-1">
                      <Image
                        src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=200&auto=format&fit=crop&q=80"
                        alt="Smartwatch"
                        fill
                        className="object-contain"
                        sizes="100px"
                      />
                    </div>
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-surface-mint border border-border-mint flex flex-col items-center justify-center text-center p-1">
                      <ShoppingBag className="w-5 h-5 text-brand-mint mb-0.5" />
                      <span className="text-[10px] font-bold text-brand-navy">MansooriKart</span>
                    </div>
                  </div>
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
      {/* 3. SHOP BY CATEGORY                                                  */}
      {/* ==================================================================== */}
      <section id="categories" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-navy">Shop by Category</h2>
            <p className="text-sm text-slate-500 mt-1">Explore our most popular categories curated for modern lifestyle.</p>
          </div>
          <Link href="/shop" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal hover:text-brand-teal-dark transition-colors">
            View all categories <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
          {categories.map(cat => (
            <Link
              key={cat.id}
              href={`/shop?category=${cat.slug}`}
              className="group flex flex-col items-center text-center p-3 rounded-2xl bg-white border border-slate-100 hover:border-border-teal hover:shadow-[0_10px_25px_-5px_rgba(13,148,136,0.12)] transition-all duration-300 hover:-translate-y-1"
            >
              <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-50 mb-3 flex items-center justify-center">
                {cat.image ? (
                  <Image
                    src={cat.image}
                    alt={cat.name}
                    fill
                    className="object-cover object-center group-hover:scale-110 transition-transform duration-500"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 12vw"
                  />
                ) : (
                  <ShoppingBag className="w-8 h-8 text-slate-300" />
                )}
              </div>
              <span className="text-xs font-bold text-brand-navy group-hover:text-brand-teal transition-colors line-clamp-1">{cat.name}</span>
              <span className="text-[10px] text-slate-400 mt-0.5">{cat.productCount ?? 20}+ items</span>
              <div className="mt-2 w-6 h-6 rounded-full bg-slate-50 group-hover:bg-brand-teal group-hover:text-white text-slate-400 flex items-center justify-center transition-colors">
                <ArrowRight className="w-3 h-3" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 4. FEATURED PRODUCTS                                                 */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-teal mb-1">
              <Sparkles className="w-3.5 h-3.5" /> Handpicked Collection
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-navy">Featured Products</h2>
            <p className="text-sm text-slate-500 mt-1">Our top picks for this month — tried, tested, and loved.</p>
          </div>
          <Link href="/shop" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal hover:text-brand-teal-dark transition-colors">
            View all products <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <HomeProductGrid products={featuredProducts} actionVariant="button" />
      </section>

      {/* ==================================================================== */}
      {/* 5. PROMOTIONAL BANNER: MEGA DEALS                                   */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl bg-gradient-to-r from-amber-100 via-amber-50 to-orange-50 border border-amber-200/60 p-8 sm:p-12 overflow-hidden shadow-[0_10px_30px_-5px_rgba(245,158,11,0.1)]">
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4 text-center lg:text-left">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-gold text-brand-navy text-xs font-extrabold uppercase tracking-wider shadow-xs">
                <Zap className="w-3.5 h-3.5 fill-brand-navy" /> Limited Time Offer
              </span>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-brand-navy tracking-tight leading-tight">
                Mega Deals are here. <br />
                <span className="text-brand-teal">Save up to 40%</span>
              </h2>
              <p className="text-sm sm:text-base text-slate-700 max-w-lg mx-auto lg:mx-0">
                Unbeatable savings across premium audio, electronics, designer fashion, and home smart appliances.
              </p>
              <div className="pt-2">
                <Link href="/shop">
                  <Button variant="primary" size="lg" className="rounded-full px-8 gap-2 bg-brand-navy hover:bg-brand-navy-light text-white font-bold">
                    Shop the Deals <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5 relative flex items-center justify-center">
              <div className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden shadow-lg border border-white/60 bg-white/40">
                <Image
                  src="https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=800&auto=format&fit=crop&q=80"
                  alt="Mega Deals Collection"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 40vw"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 6. NEW ARRIVALS                                                      */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-mint mb-1">
              <TrendingUp className="w-3.5 h-3.5" /> Latest Catalogue Drops
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-navy">New Arrivals</h2>
            <p className="text-sm text-slate-500 mt-1">Fresh drops from top brands. Updated weekly with authentic UAE warranty.</p>
          </div>
          <Link href="/shop" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal hover:text-brand-teal-dark transition-colors">
            View all products <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <HomeProductGrid products={newArrivals} actionVariant="iconOnly" />
      </section>

      {/* ==================================================================== */}
      {/* 7. TWO-TILE LIFESTYLE BANNERS                                        */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tile 1: Home Setup */}
          <div className="relative rounded-3xl bg-surface-mint border border-border-mint p-8 flex flex-col justify-between overflow-hidden group hover:border-brand-mint transition-all">
            <div className="space-y-3 max-w-xs z-10">
              <span className="text-[11px] font-bold uppercase tracking-wider text-brand-teal">Smart Living</span>
              <h3 className="text-2xl font-black text-brand-navy leading-snug">Upgrade Your Home Setup</h3>
              <p className="text-xs text-slate-600">Smart devices, robotics, and acoustic audio engineered for modern comfort.</p>
              <div className="pt-2">
                <Link href="/shop?category=home-living">
                  <Button variant="primary" size="md" className="rounded-full px-5 text-xs font-bold gap-1.5">
                    Shop Smart Home <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="absolute right-0 bottom-0 w-1/2 h-full opacity-80 group-hover:scale-105 transition-transform duration-500">
              <Image
                src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500&auto=format&fit=crop&q=80"
                alt="Modern Living"
                fill
                className="object-contain object-bottom-right"
                sizes="(max-width: 768px) 100vw, 25vw"
              />
            </div>
          </div>

          {/* Tile 2: Fashion Trends */}
          <div className="relative rounded-3xl bg-amber-50/80 border border-amber-200/60 p-8 flex flex-col justify-between overflow-hidden group hover:border-brand-gold transition-all">
            <div className="space-y-3 max-w-xs z-10">
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-gold text-brand-navy text-[10px] font-extrabold uppercase">
                New Season
              </div>
              <h3 className="text-2xl font-black text-brand-navy leading-snug">Look Good, Feel Great</h3>
              <p className="text-xs text-slate-600">Latest luxury fragrances, outerwear, and footwear at unbeatable UAE prices.</p>
              <div className="pt-2">
                <Link href="/shop?category=fashion">
                  <Button variant="secondary" size="md" className="rounded-full px-5 text-xs font-bold gap-1.5">
                    Explore Fashion <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="absolute right-0 bottom-0 w-1/2 h-full opacity-80 group-hover:scale-105 transition-transform duration-500">
              <Image
                src="https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=500&auto=format&fit=crop&q=80"
                alt="Fashion Collection"
                fill
                className="object-contain object-bottom-right"
                sizes="(max-width: 768px) 100vw, 25vw"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 8. RECENTLY VIEWED ROW                                               */}
      {/* ==================================================================== */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <RecentlyViewedRow initialItems={initialRecentlyViewed} />
      </div>

      {/* ==================================================================== */}
      {/* 9. TESTIMONIALS: LOVED BY OUR CUSTOMERS                              */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-navy">Loved by our customers</h2>
          <p className="text-sm text-slate-500 mt-1">Real stories from people who shop with MansooriKart across the UAE.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map(t => (
            <div key={t.id} className="p-6 rounded-3xl bg-white border border-slate-100 shadow-[0_4px_20px_-2px_rgba(11,25,44,0.04)] space-y-4">
              <div className="flex items-center gap-1 text-brand-gold">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-brand-gold" />
                ))}
              </div>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed italic">&ldquo;{t.text}&rdquo;</p>
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <div className="relative w-9 h-9 rounded-full overflow-hidden bg-slate-100 shrink-0">
                  <Image src={t.avatar} alt={t.name} fill className="object-cover" sizes="36px" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-brand-navy">{t.name}</h4>
                  <span className="text-[10px] text-brand-mint font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Verified Buyer
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 10. TRUSTED BY LEADING BRANDS                                        */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-brand-navy">Trusted by leading brands</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">A curated global marketplace with authentic distributor warranties.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-3">
          {trustedBrands.map(b => (
            <Link
              key={b.slug}
              href={`/shop?brand=${b.slug}`}
              className="p-3 rounded-2xl bg-white border border-slate-100 hover:border-border-teal hover:shadow-xs flex items-center justify-center text-center transition-all group"
            >
              <span className="text-xs font-black tracking-wider text-slate-400 group-hover:text-brand-navy transition-colors">{b.icon}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 11. NEWSLETTER SIGNUP CTA: JOIN OUR INSIDER LIST                     */}
      {/* ==================================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl bg-brand-navy text-white p-8 sm:p-12 overflow-hidden shadow-2xl">
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-mint/20 text-brand-mint-light text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" /> STAY UPDATED
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight">Join our insider list</h2>
              <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
                Get exclusive flash sales, new tech drops, and AED 50 off your first purchase delivered directly to your inbox.
              </p>

              <NewsletterSignup />
            </div>

            <div className="lg:col-span-4 text-center lg:text-right hidden lg:block">
              <span className="text-sm italic font-serif text-brand-goldLight block">Exclusive Deals</span>
              <span className="text-xl font-bold text-white block">Just for You</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
