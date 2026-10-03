import Link from 'next/link';
import { Search, Home, Compass } from 'lucide-react';
import { Button, Input } from '@mansoorikart/ui';

export default function NotFound() {
  return (
    <div className="bg-surface-canvas min-h-[calc(100vh-140px)] flex items-center justify-center py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl w-full bg-white rounded-3xl p-8 sm:p-12 border border-slate-100 shadow-xl text-center space-y-6">
        {/* Creative Badge & Number */}
        <div className="relative inline-block">
          <span className="text-7xl sm:text-9xl font-black text-brand-navy tracking-tighter block select-none">
            4<span className="text-brand-teal">0</span>4
          </span>
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-brand-mint/20 text-brand-mint-dark text-xs font-bold whitespace-nowrap">
            LOST, NOT FORGOTTEN
          </span>
        </div>

        <div className="space-y-2 pt-2">
          <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">Looks like you took a wrong turn</h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            The page you are looking for might have been moved, renamed, or is temporarily unavailable. Let us help you find what you need.
          </p>
        </div>

        {/* Quick Search */}
        <form action="/shop" method="GET" className="max-w-md mx-auto relative">
          <Input
            type="search"
            name="q"
            placeholder="Search thousands of tech products..."
            leftIcon={<Search className="w-4 h-4 text-slate-400" />}
            className="bg-slate-50 border-slate-200 text-xs rounded-2xl pr-20"
          />
          <Button type="submit" variant="primary" size="sm" className="absolute right-1 top-1 bottom-1 rounded-xl text-xs px-3.5">
            Search
          </Button>
        </form>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/">
            <Button variant="primary" size="md" className="rounded-full px-6 text-xs font-bold gap-2 shadow-sm">
              <Home className="w-4 h-4" /> Back to Homepage
            </Button>
          </Link>
          <Link href="/shop">
            <Button variant="outline" size="md" className="rounded-full px-6 text-xs font-bold gap-2 border-slate-200">
              <Compass className="w-4 h-4" /> Explore Categories
            </Button>
          </Link>
        </div>

        {/* Quick Category Chips */}
        <div className="pt-6 border-t border-slate-100 space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Popular UAE Categories</span>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { name: 'Headphones', href: '/shop?category=Audio' },
              { name: 'Smartwatches', href: '/shop?category=Wearables' },
              { name: 'Cameras', href: '/shop?category=Cameras' },
              { name: 'Accessories', href: '/shop?category=Accessories' },
            ].map(cat => (
              <Link
                key={cat.name}
                href={cat.href}
                className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 hover:bg-surface-mint hover:text-brand-teal text-slate-600 transition-colors"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
