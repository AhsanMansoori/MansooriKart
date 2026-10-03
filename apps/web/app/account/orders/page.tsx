'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Package, Truck, ShoppingBag, Search } from 'lucide-react';
import { Button, formatCurrency, Badge, Input } from '@mansoorikart/ui';
import { useStoreConfig, useCart } from '../../../components/providers';

const STATUS_FILTERS = ['All', 'In Transit', 'Delivered', 'Cancelled'];

interface OrderItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
  color?: string;
}

interface OrderRecord {
  orderId: string;
  date: string;
  status: string;
  statusVariant?: string;
  total?: number;
  grandTotal?: number;
  items: OrderItem[];
}

const SAMPLE_ORDERS: OrderRecord[] = [
  {
    orderId: 'MK-89421',
    date: 'Oct 3, 2026',
    status: 'In Transit',
    statusVariant: 'teal',
    total: 4407.9,
    items: [
      {
        id: 'o1',
        title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80',
        price: 1199,
        quantity: 1,
        color: 'Midnight Black',
      },
      {
        id: 'o2',
        title: 'Apple Watch Ultra 2 GPS + Cellular 49mm Titanium',
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80',
        price: 2999,
        quantity: 1,
        color: 'Orange Ocean Band',
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
        price: 1299,
        quantity: 1,
        color: 'Smoke White',
      },
    ],
  },
  {
    orderId: 'MK-76519',
    date: 'Aug 14, 2026',
    status: 'Delivered',
    statusVariant: 'mint',
    total: 6499.0,
    items: [
      {
        id: 'o4',
        title: 'Fujifilm X-T5 Mirrorless Camera with 16-80mm Lens',
        image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=400&q=80',
        price: 6499,
        quantity: 1,
        color: 'Black Body',
      },
    ],
  },
];

export default function MyOrdersPage() {
  const { config } = useStoreConfig();
  const { addItem, setIsCartDrawerOpen } = useCart();

  const [activeTab, setActiveTab] = React.useState('All');
  const [searchQuery, setSearchQuery] = React.useState('');

  const [orders] = React.useState<OrderRecord[]>(() => {
    if (typeof window === 'undefined') return SAMPLE_ORDERS;
    try {
      const stored = localStorage.getItem('mk_user_orders');
      return stored ? JSON.parse(stored) : SAMPLE_ORDERS;
    } catch {
      return SAMPLE_ORDERS;
    }
  });

  const handleBuyAgain = (item: OrderItem) => {
    addItem({
      productId: item.id,
      title: item.title,
      price: item.price,
      image: item.image,
      color: item.color,
    });
    setIsCartDrawerOpen(true);
  };

  const filteredOrders = orders.filter(ord => {
    if (activeTab !== 'All' && ord.status !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = ord.orderId.toLowerCase().includes(q);
      const matchItem = (ord.items || []).some((it: OrderItem) => it.title.toLowerCase().includes(q));
      return matchId || matchItem;
    }
    return true;
  });

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">My Orders</h1>
          <p className="text-xs text-slate-500 mt-0.5">View and track all your purchases across the UAE</p>
        </div>

        {/* Search */}
        <div className="w-full sm:w-64">
          <Input
            type="search"
            placeholder="Search by order ID or item..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-4 h-4 text-slate-400" />}
            className="bg-slate-50 border-slate-200 text-xs rounded-xl"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-100">
        {STATUS_FILTERS.map(tab => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                isActive ? 'bg-brand-navy text-white shadow-xs' : 'text-slate-500 hover:text-brand-navy hover:bg-slate-50'
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Orders List */}
      <div className="space-y-6">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Package className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-brand-navy">No orders found</h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              There are no orders matching your current filter. Explore our shop to place your next order!
            </p>
            <Link href="/shop" className="inline-block pt-2">
              <Button variant="primary" size="md" className="rounded-full px-6 text-xs font-bold">
                Start Shopping
              </Button>
            </Link>
          </div>
        ) : (
          filteredOrders.map(ord => (
            <div key={ord.orderId} className="rounded-3xl border border-slate-200/80 overflow-hidden shadow-xs hover:border-slate-300 transition-colors">
              {/* Order Card Header */}
              <div className="p-4 sm:p-5 bg-surface-canvas border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">Order ID</span>
                    <span className="font-black text-brand-navy text-sm">#{ord.orderId}</span>
                  </div>
                  <div className="hidden sm:block w-px h-8 bg-slate-200" />
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">Date Placed</span>
                    <span className="font-semibold text-slate-700">{ord.date}</span>
                  </div>
                  <div className="hidden sm:block w-px h-8 bg-slate-200" />
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">Total</span>
                    <span className="font-black text-brand-teal">{formatCurrency(ord.grandTotal ?? ord.total ?? 0, config.currency.code, 2)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant={ord.status === 'Delivered' ? 'mint' : 'teal'} size="sm">
                    {ord.status.toUpperCase()}
                  </Badge>
                  <Link href={`/orders/${ord.orderId}`}>
                    <Button variant="primary" size="sm" className="rounded-xl text-xs font-bold gap-1 shadow-xs">
                      <Truck className="w-3.5 h-3.5" /> Track
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Order Card Items */}
              <div className="p-4 sm:p-6 divide-y divide-slate-100">
                {(ord.items || []).map((it: OrderItem, idx: number) => (
                  <div key={idx} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="relative w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                        {it.image ? (
                          <Image src={it.image} alt={it.title} fill sizes="64px" className="object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <ShoppingBag className="w-6 h-6" />
                          </div>
                        )}
                      </div>

                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-brand-navy line-clamp-1">{it.title}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Quantity: {it.quantity} {it.color && `• Color: ${it.color}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                      <span className="text-sm font-bold text-brand-navy">{formatCurrency(it.price * it.quantity, config.currency.code, 2)}</span>
                      <Button
                        type="button"
                        onClick={() => handleBuyAgain(it)}
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs font-bold border-slate-200 hover:bg-slate-50"
                      >
                        Buy Again
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
