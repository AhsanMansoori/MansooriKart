'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Package, Truck, MapPin, Heart, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button, formatCurrency, Badge } from '@mansoorikart/ui';
import { useAuth, useWishlist, useStoreConfig } from '../../components/providers';

interface AccountOrderItem {
  id: string;
  title: string;
  image?: string;
  quantity: number;
}

interface AccountOrderRecord {
  orderId: string;
  date: string;
  status: string;
  statusVariant?: string;
  total?: number;
  grandTotal?: number;
  items: AccountOrderItem[];
}

const SAMPLE_ORDERS: AccountOrderRecord[] = [
  {
    orderId: 'MK-89421',
    date: 'Oct 3, 2026',
    status: 'In Transit',
    statusVariant: 'teal',
    total: 4407.9,
    items: [
      {
        id: 'o1',
        title: 'Sony WH-1000XM5 Wireless Headphones',
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80',
        quantity: 1,
      },
      {
        id: 'o2',
        title: 'Apple Watch Ultra 2 GPS + Cellular 49mm',
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80',
        quantity: 1,
      },
    ],
  },
  {
    orderId: 'MK-81204',
    date: 'Sep 21, 2026',
    status: 'Delivered',
    statusVariant: 'mint',
    total: 1299.0,
    items: [
      {
        id: 'o3',
        title: 'Bose QuietComfort 45 Bluetooth Headphones',
        image: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=400&q=80',
        quantity: 1,
      },
    ],
  },
];

export default function AccountDashboardPage() {
  const { user } = useAuth();
  const { wishlistCount } = useWishlist();
  const { config } = useStoreConfig();

  const [orders] = React.useState<AccountOrderRecord[]>(() => {
    if (typeof window === 'undefined') return SAMPLE_ORDERS;
    try {
      const stored = localStorage.getItem('mk_user_orders');
      return stored ? JSON.parse(stored) : SAMPLE_ORDERS;
    } catch {
      return SAMPLE_ORDERS;
    }
  });

  const defaultAddr = user?.addresses?.find(a => a.isDefault) || user?.addresses?.[0];

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-teal block mb-1">Account Overview</span>
          <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">Welcome back, {user?.name || 'Customer'}!</h1>
          <p className="text-xs text-slate-500 mt-1">Manage your orders, tracking information, and UAE delivery addresses from one place.</p>
        </div>

        <Link href="/shop">
          <Button variant="primary" size="md" className="rounded-full px-6 text-xs font-bold shrink-0">
            Browse New Arrivals
          </Button>
        </Link>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Total Orders */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs space-y-2">
          <div className="w-10 h-10 rounded-xl bg-surface-mint flex items-center justify-center text-brand-teal">
            <Package className="w-5 h-5" />
          </div>
          <span className="text-2xl font-black text-brand-navy block">{orders.length || 2}</span>
          <span className="text-xs text-slate-500 block">Total Orders</span>
        </div>

        {/* In Transit */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs space-y-2">
          <div className="w-10 h-10 rounded-xl bg-surface-teal flex items-center justify-center text-brand-teal">
            <Truck className="w-5 h-5" />
          </div>
          <span className="text-2xl font-black text-brand-teal block">1</span>
          <span className="text-xs text-slate-500 block">In Transit</span>
        </div>

        {/* Saved Addresses */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs space-y-2">
          <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-600">
            <MapPin className="w-5 h-5" />
          </div>
          <span className="text-2xl font-black text-brand-navy block">{user?.addresses?.length || 2}</span>
          <span className="text-xs text-slate-500 block">Saved Addresses</span>
        </div>

        {/* Wishlist */}
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs space-y-2">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-brand-red">
            <Heart className="w-5 h-5" />
          </div>
          <span className="text-2xl font-black text-brand-navy block">{wishlistCount}</span>
          <span className="text-xs text-slate-500 block">Saved in Wishlist</span>
        </div>
      </div>

      {/* Recent Orders Section */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-black text-brand-navy">Recent Orders</h2>
            <p className="text-xs text-slate-500 mt-0.5">Check status and tracking of your recent purchases</p>
          </div>
          <Link href="/account/orders" className="text-xs font-bold text-brand-teal hover:underline flex items-center gap-1">
            View All Orders <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="space-y-4">
          {orders.slice(0, 2).map((ord: AccountOrderRecord) => (
            <div
              key={ord.orderId}
              className="p-4 sm:p-5 rounded-2xl bg-surface-canvas border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-black text-brand-navy">#{ord.orderId}</span>
                  <span className="text-xs text-slate-400">• {ord.date}</span>
                  <Badge variant={ord.status === 'Delivered' ? 'mint' : 'teal'} size="sm">
                    {ord.status.toUpperCase()}
                  </Badge>
                </div>

                {/* Items preview */}
                <div className="flex items-center gap-2">
                  {(ord.items || []).slice(0, 3).map((it: AccountOrderItem, idx: number) => (
                    <div key={idx} className="relative w-12 h-12 rounded-xl bg-white border border-slate-200 overflow-hidden shrink-0">
                      {it.image && <Image src={it.image} alt={it.title} fill sizes="48px" className="object-cover" />}
                    </div>
                  ))}
                  {(ord.items || []).length > 3 && <span className="text-[11px] font-bold text-slate-400 pl-1">+{(ord.items || []).length - 3} more</span>}
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200/60">
                <span className="text-base font-black text-brand-navy">{formatCurrency(ord.grandTotal ?? ord.total ?? 0, config.currency.code, 2)}</span>
                <Link href={`/orders/${ord.orderId}`}>
                  <Button variant="outline" size="sm" className="rounded-xl text-xs font-bold gap-1 border-slate-200">
                    <Truck className="w-3.5 h-3.5" /> Track Order
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Default Address & Account Shortcuts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Default Shipping Address */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-brand-navy flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand-teal" /> Default Shipping Address
            </h3>
            <Link href="/account/addresses" className="text-xs font-semibold text-brand-teal hover:underline">
              Manage
            </Link>
          </div>

          {defaultAddr ? (
            <div className="space-y-1 text-xs text-slate-600">
              <p className="font-bold text-brand-navy text-sm">{defaultAddr.fullName}</p>
              <p>{defaultAddr.street}</p>
              <p>
                {defaultAddr.building}, {defaultAddr.city}, {defaultAddr.emirate}, UAE
              </p>
              <p className="text-slate-400 pt-1">{defaultAddr.phone}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-400">No default address specified.</p>
          )}
        </div>

        {/* Security & Preferences */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-brand-navy flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand-mint" /> Security & Profile
            </h3>
            <Link href="/account/settings" className="text-xs font-semibold text-brand-teal hover:underline">
              Edit
            </Link>
          </div>

          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span className="text-slate-400">Full Name</span>
              <span className="font-bold text-brand-navy">{user?.name || 'Customer'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email</span>
              <span className="font-bold text-brand-navy">{user?.email || 'customer@mansoorikart.ae'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Phone</span>
              <span className="font-bold text-brand-navy">{user?.phone || '+971 50 123 4567'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Password</span>
              <span className="font-bold text-brand-navy">••••••••••••</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
