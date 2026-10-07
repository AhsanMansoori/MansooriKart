'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Package, MapPin, Settings, Heart, LogOut, ShieldCheck, ChevronRight } from 'lucide-react';
import { useAuth } from '../../components/providers';

interface AccountLayoutProps {
  children: React.ReactNode;
}

export default function AccountLayout({ children }: AccountLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const navItems = [
    { label: 'Dashboard', href: '/account', icon: LayoutDashboard },
    { label: 'My Orders', href: '/account/orders', icon: Package },
    { label: 'Saved Addresses', href: '/account/addresses', icon: MapPin },
    { label: 'Account Settings', href: '/account/settings', icon: Settings },
    { label: 'My Wishlist', href: '/account/wishlist', icon: Heart },
  ];

  return (
    <div className="bg-surface-canvas min-h-screen py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-6 font-medium">
          <Link href="/" className="hover:text-brand-teal transition-colors">
            Home
          </Link>
          <span>/</span>
          <span className="text-brand-navy font-bold">My Account</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Sidebar Navigation */}
          <aside className="lg:col-span-3 bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-6">
            {/* User Profile Mini Card */}
            <div className="flex items-center gap-3.5 pb-6 border-b border-slate-100">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-teal to-brand-mint text-white flex items-center justify-center font-black text-lg shadow-sm">
                {user?.name ? user.name.charAt(0) : 'U'}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-brand-navy truncate">{user?.name || 'Customer'}</h3>
                <p className="text-[11px] text-slate-400 truncate">{user?.email || 'customer@mansoorikart.ae'}</p>
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-brand-mint-dark bg-surface-mint px-2 py-0.5 rounded-full">
                  <ShieldCheck className="w-3 h-3" /> UAE Verified
                </span>
              </div>
            </div>

            {/* Menu Links */}
            <nav className="space-y-1">
              {navItems.map(item => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                      isActive ? 'bg-surface-mint text-brand-teal' : 'text-slate-600 hover:text-brand-navy hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-brand-teal' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </div>
                    {isActive && <ChevronRight className="w-4 h-4 text-brand-teal" />}
                  </Link>
                );
              })}

              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-brand-red hover:bg-red-50/50 transition-colors mt-4 text-left cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-slate-400" />
                <span>Log Out</span>
              </button>
            </nav>
          </aside>

          {/* Main Area */}
          <main className="lg:col-span-9">{children}</main>
        </div>
      </div>
    </div>
  );
}
