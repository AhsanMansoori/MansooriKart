import * as React from 'react';
import Link from 'next/link';
import { ShieldCheck, Truck, Sparkles, Building2, ArrowRight } from 'lucide-react';
import { Button } from '@mansoorikart/ui';
import { TrustBadgeStrip } from '../../components/TrustBadgeStrip';

export const metadata = {
  title: 'About Us | MansooriKart UAE',
  description: 'Learn about MansooriKart story, mission, and commitment to genuine products and express delivery across the United Arab Emirates.',
};

export default function AboutPage() {
  return (
    <div className="bg-surface-canvas min-h-screen py-10 sm:py-16 space-y-16">
      {/* 1. Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl bg-brand-navy text-white p-8 sm:p-16 overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-brand-teal/20 blur-3xl" />
          <div className="relative z-10 max-w-3xl space-y-5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-mint/20 text-brand-mint-light text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5" /> OUR STORY & VISION
            </span>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">Empowering UAE Commerce with Authenticity & Speed</h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Founded in Dubai, MansooriKart was born with a single conviction: customers in the United Arab Emirates deserve guaranteed 100% genuine products,
              transparent local pricing, and reliable next-day delivery right to their doorstep.
            </p>
            <div className="pt-2 flex flex-wrap gap-4">
              <Link href="/shop">
                <Button variant="primary" size="lg" className="rounded-full px-8 text-xs font-bold shadow-md shadow-brand-mint/25">
                  Explore Catalog <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button variant="outline" size="lg" className="rounded-full px-8 text-xs font-bold border-slate-700 text-white hover:bg-slate-800">
                  Contact Dubai HQ
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Key Metrics Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs text-center space-y-2">
            <span className="text-3xl sm:text-4xl font-black text-brand-teal block">10,000+</span>
            <span className="text-xs sm:text-sm font-bold text-brand-navy block">Authentic Products</span>
            <p className="text-[11px] text-slate-500">Directly sourced from verified global brands</p>
          </div>

          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs text-center space-y-2">
            <span className="text-3xl sm:text-4xl font-black text-brand-mint block">99.8%</span>
            <span className="text-xs sm:text-sm font-bold text-brand-navy block">On-Time Deliveries</span>
            <p className="text-[11px] text-slate-500">Express logistics across Dubai and Abu Dhabi</p>
          </div>

          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs text-center space-y-2">
            <span className="text-3xl sm:text-4xl font-black text-brand-navy block">7</span>
            <span className="text-xs sm:text-sm font-bold text-brand-navy block">Emirates Covered</span>
            <p className="text-[11px] text-slate-500">From Ras Al Khaimah to Al Ain and Abu Dhabi</p>
          </div>

          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs text-center space-y-2">
            <span className="text-3xl sm:text-4xl font-black text-brand-gold block">50k+</span>
            <span className="text-xs sm:text-sm font-bold text-brand-navy block">Happy Customers</span>
            <p className="text-[11px] text-slate-500">Rated 4.9/5 across verified UAE shopper reviews</p>
          </div>
        </div>
      </section>

      {/* 3. Core Values & Trust Pillars */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto space-y-2 mb-12">
          <span className="text-xs font-bold text-brand-teal uppercase tracking-widest">WHY SHOP WITH US</span>
          <h2 className="text-2xl sm:text-3xl font-black text-brand-navy">Built for the Modern UAE Lifestyle</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            We operate our own local fulfilment network to ensure you never receive gray-market goods or slow cross-border shipments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-xs space-y-4 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-2xl bg-surface-mint text-brand-mint flex items-center justify-center shadow-xs">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-brand-navy">Guaranteed Genuine Stock</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Every single product cataloged in MansooriKart carries official UAE distributor warranty and serial authentication.
            </p>
          </div>

          <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-xs space-y-4 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-2xl bg-surface-teal text-brand-teal flex items-center justify-center shadow-xs">
              <Truck className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-brand-navy">Express Local Logistics</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              With dispatch centers in Dubai and Sharjah, we offer same-day delivery across Dubai and next-day courier service everywhere in UAE.
            </p>
          </div>

          <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-xs space-y-4 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center shadow-xs">
              <Building2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-brand-navy">UAE Headquarters & Support</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Our bilingual customer concierge team is based in Business Bay, Dubai, ready to assist via phone, email, and live WhatsApp.
            </p>
          </div>
        </div>
      </section>

      {/* 4. Trust Badge Strip */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <TrustBadgeStrip />
      </section>
    </div>
  );
}
