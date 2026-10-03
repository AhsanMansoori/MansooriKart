'use client';

import * as React from 'react';
import Link from 'next/link';
import { Truck, ShieldCheck, RotateCcw, Headphones, ShoppingBag, Send, Globe, Instagram, Facebook, Twitter, Linkedin } from 'lucide-react';
import { Button, Input, TrustBadge, formatCurrency } from '@mansoorikart/ui';
import { useStoreConfig } from './providers';

export function Footer() {
  const { config } = useStoreConfig();
  const [email, setEmail] = React.useState('');
  const [subscribed, setSubscribed] = React.useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubscribed(true);
      setEmail('');
    }
  };

  const exploreLinks = [
    { label: 'All Products', href: '/shop' },
    { label: 'Electronics & Audio', href: '/categories/electronics' },
    { label: 'Smartphones & Watches', href: '/categories/smartphones' },
    { label: 'Fashion & Apparel', href: '/categories/fashion' },
    { label: 'Home & Kitchen', href: '/categories/home' },
    { label: 'Flash Deals & Discounts', href: '/deals' },
  ];

  const customerCareLinks = [
    { label: 'Help & Support Center', href: '/support' },
    { label: 'Track Your Order', href: '/orders/track' },
    { label: 'Shipping & Delivery Info', href: '/shipping' },
    { label: 'Returns & Exchange Policy', href: '/returns' },
    { label: 'UAE VAT & Invoicing', href: '/tax-info' },
    { label: 'Contact Us', href: '/contact' },
  ];

  return (
    <footer className="w-full bg-brand-navy text-slate-300">
      {/* Trust Badges Banner Section */}
      <div className="border-b border-slate-800 bg-brand-navy-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <TrustBadge
              icon={<Truck className="w-5 h-5" />}
              title="Free Delivery in UAE"
              subtitle={
                config.shipping.freeShippingEnabled
                  ? `Orders over ${formatCurrency(config.shipping.freeShippingThreshold, config.currency.code, 0)} delivered to your door`
                  : 'Fast delivery to your door'
              }
              variant="horizontal"
              iconVariant="teal"
              className="bg-slate-900/60 border border-slate-800 text-white"
            />
            <TrustBadge
              icon={<ShieldCheck className="w-5 h-5" />}
              title="100% Secure Payment"
              subtitle="Cards, Apple Pay & Cash on Delivery"
              variant="horizontal"
              iconVariant="mint"
              className="bg-slate-900/60 border border-slate-800 text-white"
            />
            <TrustBadge
              icon={<RotateCcw className="w-5 h-5" />}
              title="Hassle-Free Returns"
              subtitle="14-day return & exchange guarantee"
              variant="horizontal"
              iconVariant="teal"
              className="bg-slate-900/60 border border-slate-800 text-white"
            />
            <TrustBadge
              icon={<Headphones className="w-5 h-5" />}
              title="24/7 Customer Support"
              subtitle="Live chat & dedicated UAE phone line"
              variant="horizontal"
              iconVariant="mint"
              className="bg-slate-900/60 border border-slate-800 text-white"
            />
          </div>
        </div>
      </div>

      {/* Main Footer Links & Newsletter */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-8">
          {/* Brand Info Column */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="inline-flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-teal to-brand-mint flex items-center justify-center text-white shadow-md shadow-brand-mint/20">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <span className="text-xl font-extrabold text-white tracking-tight">
                Mansoori<span className="text-brand-mint">Kart</span>
              </span>
            </Link>

            <p className="text-sm text-slate-400 leading-relaxed max-w-sm">
              The premier e-commerce marketplace in the United Arab Emirates. Delivering verified authentic electronics, stylish lifestyle brands, and everyday
              essentials with fast local fulfilment across Dubai, Abu Dhabi, and all Emirates.
            </p>

            <div className="pt-2 flex items-center gap-3 text-slate-400">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center hover:bg-brand-teal hover:text-white transition-colors"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center hover:bg-brand-teal hover:text-white transition-colors"
              >
                <Facebook className="w-4 h-4" />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Twitter"
                className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center hover:bg-brand-teal hover:text-white transition-colors"
              >
                <Twitter className="w-4 h-4" />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                aria-label="LinkedIn"
                className="w-9 h-9 rounded-full bg-slate-800/80 flex items-center justify-center hover:bg-brand-teal hover:text-white transition-colors"
              >
                <Linkedin className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Explore Column */}
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-white mb-4">Explore</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              {exploreLinks.map(link => (
                <li key={link.label}>
                  <Link href={link.href} className="hover:text-brand-mint transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Customer Care Column */}
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-white mb-4">Customer Care</h4>
            <ul className="space-y-2.5 text-sm text-slate-400">
              {customerCareLinks.map(link => (
                <li key={link.label}>
                  <Link href={link.href} className="hover:text-brand-mint transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Newsletter Column: Join Insider List */}
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-white mb-4">Join Insider List</h4>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Subscribe to unlock weekly exclusive flash sales, new tech drops, and AED 50 off your first purchase.
            </p>

            {subscribed ? (
              <div className="p-3 rounded-xl bg-brand-navy-dark/90 border border-brand-teal/40 text-brand-mint-light text-xs font-medium">
                🎉 Thanks for subscribing! Check your inbox for your exclusive code.
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="space-y-2">
                <Input
                  type="email"
                  placeholder="Enter your email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="bg-slate-900/90 border-slate-700 text-white placeholder:text-slate-500 focus:border-brand-mint text-sm"
                />
                <Button type="submit" variant="primary" size="md" className="w-full gap-2 text-xs font-bold">
                  <Send className="w-3.5 h-3.5" />
                  Subscribe Now
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Legal & Market Selector Bar */}
      <div className="border-t border-slate-800 bg-brand-navy-dark/80 text-xs text-slate-500 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-center sm:text-left">
            <span>© 2026 MansooriKart LLC. All rights reserved.</span>
            <span className="hidden md:inline">•</span>
            <Link href="/privacy" className="hover:text-slate-300 transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-slate-300 transition-colors">
              Terms of Service
            </Link>
            <Link href="/security" className="hover:text-slate-300 transition-colors">
              Security & Compliance
            </Link>
          </div>

          {/* Market & Currency Selector showing AED | English */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/60 text-slate-300">
            <Globe className="w-3.5 h-3.5 text-brand-mint" />
            <span className="font-semibold text-white tracking-wide">AED | English</span>
            <span className="text-[10px] text-slate-400 uppercase font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">UAE</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
