'use client';

import * as React from 'react';
import Link from 'next/link';
import { Search, Heart, ShoppingBag, User, Menu, X, Sparkles, ChevronDown } from 'lucide-react';
import { Button, Badge, Input, formatCurrency } from '@mansoorikart/ui';
import { useCart, useStoreConfig, useWishlist, useAuth } from './providers';
import type { StorefrontConfig } from '../lib/api/types';

interface HeaderProps {
  wishlistCount?: number;
  config?: StorefrontConfig;
}

export function Header({ wishlistCount: propWishlistCount, config: propConfig }: HeaderProps) {
  const { itemCount, subtotal, setIsCartDrawerOpen } = useCart();
  const { wishlistCount: contextWishlistCount } = useWishlist();
  const { user, isAuthenticated } = useAuth();
  const { config: contextConfig } = useStoreConfig();
  const config = propConfig ?? contextConfig;
  const wishlistCount = propWishlistCount ?? contextWishlistCount;

  const [isScrolled, setIsScrolled] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'Home', href: '/' },
    { label: 'Shop', href: '/shop' },
    { label: 'Categories', href: '/categories', hasDropdown: true },
    { label: 'Deals', href: '/deals', isHighlighted: true },
    { label: 'About', href: '/about' },
    { label: 'Support', href: '/support' },
  ];

  return (
    <header className="w-full z-40 sticky top-0 transition-all duration-300">
      {/* Top Announcement Bar */}
      <div className="bg-brand-navy text-slate-300 text-xs py-2 px-4 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-brand-mint animate-pulse" />
            <span className="font-medium text-white">Free Express Delivery in UAE</span>
            {config.shipping.freeShippingEnabled && (
              <span className="hidden sm:inline text-slate-400">
                on all orders above {formatCurrency(config.shipping.freeShippingThreshold, config.currency.code, 0)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs">
            <span className="hidden md:inline text-slate-400">
              Deliver to: <span className="font-semibold text-white">Dubai, UAE</span>
            </span>
            <span className="text-slate-600">|</span>
            <span className="font-medium text-brand-mint-light flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> UAE VAT Included (5%)
            </span>
          </div>
        </div>
      </div>

      {/* Main Header Container */}
      <div
        className={`bg-white/95 backdrop-blur-md transition-shadow duration-300 ${
          isScrolled ? 'shadow-[0_4px_20px_-2px_rgba(11,25,44,0.08)] border-b border-slate-100' : 'border-b border-slate-100'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex items-center justify-between gap-4 lg:gap-8">
            {/* Mobile Menu Button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden text-slate-700 hover:bg-slate-100"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </Button>

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 shrink-0 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-teal to-brand-mint flex items-center justify-center text-white shadow-md shadow-brand-mint/20 group-hover:scale-105 transition-transform">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-extrabold tracking-tight text-brand-navy">
                  Mansoori<span className="text-brand-teal">Kart</span>
                </span>
                <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold -mt-1">UAE Store</span>
              </div>
            </Link>

            {/* Search Bar */}
            <div className="hidden md:flex flex-1 max-w-xl mx-4">
              <form
                onSubmit={e => {
                  e.preventDefault();
                }}
                className="w-full relative"
              >
                <Input
                  type="search"
                  placeholder="Search over 10,000+ products in electronics, fashion..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  leftIcon={<Search className="w-4 h-4 text-slate-400" />}
                  className="w-full pr-24 bg-slate-50 border-slate-200 focus:bg-white"
                />
                <Button type="submit" variant="primary" size="sm" className="absolute right-1 top-1 bottom-1 rounded-lg px-3.5 text-xs shadow-none">
                  Search
                </Button>
              </form>
            </div>

            {/* Action Buttons: Wishlist, Account, Cart */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Wishlist */}
              <Link
                href="/wishlist"
                className="relative p-2 text-slate-700 hover:text-brand-teal rounded-xl hover:bg-slate-50 transition-colors"
                aria-label="Wishlist"
              >
                <Heart className="w-5 h-5" />
                {wishlistCount > 0 && (
                  <Badge variant="discount" size="sm" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center">
                    {wishlistCount}
                  </Badge>
                )}
              </Link>

              {/* Account */}
              <Link
                href={isAuthenticated ? '/account' : '/login'}
                className="flex items-center gap-2 p-2 text-slate-700 hover:text-brand-teal rounded-xl hover:bg-slate-50 transition-colors"
                aria-label="Customer Account"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                  <User className="w-4 h-4" />
                </div>
                <div className="hidden xl:flex flex-col text-left">
                  <span className="text-[11px] text-slate-400 leading-tight">{isAuthenticated ? 'Hello' : 'Welcome'}</span>
                  <span className="text-xs font-semibold text-brand-navy leading-tight truncate max-w-[100px]">
                    {isAuthenticated ? user?.name?.split(' ')[0] : 'Sign In'}
                  </span>
                </div>
              </Link>

              {/* Cart Button with Drawer Trigger */}
              <button
                type="button"
                onClick={() => setIsCartDrawerOpen(true)}
                className="relative flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 hover:bg-surface-mint border border-slate-200/80 hover:border-border-mint transition-all text-slate-800 cursor-pointer"
                aria-label="Shopping Cart"
              >
                <div className="relative">
                  <ShoppingBag className="w-5 h-5 text-brand-teal" />
                  {itemCount > 0 && (
                    <Badge
                      variant="primary"
                      size="sm"
                      className="absolute -top-2 -right-2 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center shadow-xs"
                    >
                      {itemCount}
                    </Badge>
                  )}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider leading-tight">Cart</span>
                  <span className="text-xs font-bold text-brand-navy leading-tight">{formatCurrency(subtotal, config.currency.code, 2)}</span>
                </div>
              </button>
            </div>
          </div>

          {/* Navigation Links Bar */}
          <nav className="hidden lg:flex items-center justify-between pt-3 mt-2 border-t border-slate-100">
            <div className="flex items-center gap-8">
              {navLinks.map(link => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`text-sm font-medium transition-colors hover:text-brand-teal flex items-center gap-1 ${
                    link.isHighlighted ? 'text-brand-gold font-semibold' : 'text-slate-700'
                  }`}
                >
                  {link.label}
                  {link.hasDropdown && <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
              <span>Track Orders</span>
              <span className="text-slate-300">•</span>
              <span>Daily Flash Deals</span>
            </div>
          </nav>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-100 bg-white px-4 py-4 space-y-3">
            <form onSubmit={e => e.preventDefault()} className="w-full relative mb-3">
              <Input
                type="search"
                placeholder="Search products..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                leftIcon={<Search className="w-4 h-4 text-slate-400" />}
              />
            </form>

            <nav className="flex flex-col space-y-2">
              {navLinks.map(link => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 ${
                    link.isHighlighted ? 'text-brand-gold font-bold bg-brand-gold/10' : 'text-slate-700'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
