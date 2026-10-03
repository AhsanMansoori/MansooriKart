'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { Truck, CheckCircle2, Clock, Download, RotateCcw, Package, CreditCard, ArrowLeft, Phone } from 'lucide-react';
import { Button, formatCurrency, Badge } from '@mansoorikart/ui';
import { useStoreConfig } from '../../../components/providers';

const TRACKING_STEPS = [
  {
    step: 1,
    title: 'Order Placed',
    description: 'We received your order and payment verification.',
    time: 'Today, 10:15 AM',
    status: 'completed',
  },
  {
    step: 2,
    title: 'Packed & Dispatched',
    description: 'Processed at MansooriKart Dubai Fulfilment Center.',
    time: 'Today, 2:45 PM',
    status: 'completed',
  },
  {
    step: 3,
    title: 'In Transit with Courier',
    description: 'Aramex Express Courier has picked up your package.',
    time: 'Today, 5:30 PM',
    status: 'active',
  },
  {
    step: 4,
    title: 'Out for Delivery',
    description: 'Courier agent is on the way to your address.',
    time: 'Tomorrow, morning',
    status: 'upcoming',
  },
  {
    step: 5,
    title: 'Delivered',
    description: 'Package handed over with OTP / signature verification.',
    time: 'Estimated tomorrow by 6:00 PM',
    status: 'upcoming',
  },
];

interface OrderDetailItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
  color?: string;
  sku?: string;
}

interface OrderDetailRecord {
  orderId: string;
  date: string;
  status: string;
  grandTotal: number;
  items: OrderDetailItem[];
}

export default function OrderDetailsPage() {
  const params = useParams();
  const { config } = useStoreConfig();
  const orderId = (params?.id as string) || 'MK-89421';

  const [order] = React.useState<OrderDetailRecord | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('mk_last_order');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.orderId === orderId || !params?.id) {
          return parsed;
        }
      }
    } catch {
      // storage
    }
    return null;
  });

  const items = order?.items || [
    {
      id: 'item-1',
      title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
      price: 1199,
      quantity: 1,
      image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80',
      color: 'Midnight Black',
      sku: 'MK-SNY-XM5-BLK',
    },
    {
      id: 'item-2',
      title: 'Apple Watch Ultra 2 GPS + Cellular 49mm Titanium',
      price: 2999,
      quantity: 1,
      image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80',
      color: 'Orange Ocean Band',
      sku: 'MK-APL-WTR2-ORG',
    },
  ];

  return (
    <div className="bg-surface-canvas min-h-screen py-8 sm:py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center justify-between mb-6">
          <Link href="/account" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-brand-teal transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Orders
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="rounded-xl text-xs font-bold gap-1.5 border-slate-200 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> Download Tax Invoice
            </Button>
          </div>
        </div>

        {/* Order Header Summary Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">Order #{orderId}</h1>
                <Badge variant="teal" size="sm">
                  IN TRANSIT
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>Placed on Oct 3, 2026</span>
                <span>•</span>
                <span>Payment: Verified</span>
                <span>•</span>
                <span>Express Dispatch</span>
              </p>
            </div>

            <div className="text-left sm:text-right">
              <span className="text-xs text-slate-400 block">Total Amount Paid</span>
              <span className="text-xl sm:text-2xl font-black text-brand-teal">{formatCurrency(order?.grandTotal || 4407.9, config.currency.code, 2)}</span>
            </div>
          </div>

          {/* Courier Details Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-mint flex items-center justify-center text-brand-teal">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Courier</span>
                <span className="text-xs sm:text-sm font-bold text-brand-navy">Aramex UAE Express</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-teal flex items-center justify-center text-brand-teal">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Tracking ID</span>
                <span className="text-xs sm:text-sm font-bold text-brand-navy font-mono">AE-EXP-84729104</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-mint flex items-center justify-center text-brand-mint">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Expected By</span>
                <span className="text-xs sm:text-sm font-bold text-brand-mint-dark">Tomorrow, by 6:00 PM</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Stepper Tracker Card (matching OrderDetails + Tracking_page.png) */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs mb-8">
          <h2 className="text-base font-black text-brand-navy pb-4 border-b border-slate-100">Live Package Tracking</h2>

          <div className="pt-6 relative">
            <div className="space-y-6 sm:space-y-8">
              {TRACKING_STEPS.map(item => {
                const isCompleted = item.status === 'completed';
                const isActive = item.status === 'active';

                return (
                  <div key={item.step} className="flex items-start gap-4 sm:gap-6 relative">
                    {/* Stepper Dot / Icon */}
                    <div className="relative z-10 shrink-0">
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold transition-all shadow-xs ${
                          isCompleted
                            ? 'bg-brand-mint text-white'
                            : isActive
                              ? 'bg-brand-teal text-white ring-4 ring-brand-teal/20 animate-pulse'
                              : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : item.step}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <h3 className={`text-sm sm:text-base font-bold ${isActive ? 'text-brand-teal' : isCompleted ? 'text-brand-navy' : 'text-slate-400'}`}>
                          {item.title}
                        </h3>
                        <span className="text-xs text-slate-400 font-medium">{item.time}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Two Columns: Items Breakdown & Delivery Addresses */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Items Table */}
          <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
            <h2 className="text-base font-black text-brand-navy pb-3 border-b border-slate-100">Items in this Shipment ({items.length})</h2>

            <div className="divide-y divide-slate-100">
              {items.map((item: OrderDetailItem) => (
                <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                      {item.image && <Image src={item.image} alt={item.title} fill sizes="64px" className="object-cover" />}
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-brand-navy line-clamp-1">{item.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Qty: {item.quantity} {item.color && `• Color: ${item.color}`}
                      </p>
                      {item.sku && <span className="text-[10px] text-slate-400 font-mono">SKU: {item.sku}</span>}
                    </div>
                  </div>

                  <span className="text-sm font-bold text-brand-teal shrink-0">{formatCurrency(item.price * item.quantity, config.currency.code, 2)}</span>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-500">Need to return an item from this order?</span>
              <Button variant="outline" size="sm" className="rounded-xl text-xs font-bold border-slate-200">
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Start Return / Exchange
              </Button>
            </div>
          </div>

          {/* Shipping & Payment Cards */}
          <div className="lg:col-span-4 space-y-4">
            {/* Delivery Address */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Delivery Address</span>
              <div className="space-y-1 text-xs">
                <p className="font-bold text-brand-navy">Ahmed Mansoori</p>
                <p className="text-slate-600">Al Wasl Road, Villa 42</p>
                <p className="text-slate-600">Jumeirah 1, Dubai, UAE</p>
                <p className="text-slate-400 pt-1 flex items-center gap-1.5">
                  <Phone className="w-3 h-3" /> +971 50 123 4567
                </p>
              </div>
            </div>

            {/* Payment Details */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Payment Breakdown</span>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-semibold text-brand-navy">AED 4,198.00</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Delivery</span>
                  <span className="font-bold text-brand-mint">FREE</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>UAE VAT (5%)</span>
                  <span className="font-medium text-slate-700">AED 209.90</span>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-between font-black text-brand-navy text-sm">
                  <span>Total Paid</span>
                  <span className="text-brand-teal">AED 4,407.90</span>
                </div>
              </div>

              <div className="pt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> Visa ending in 4242
              </div>
            </div>

            {/* Support Box */}
            <div className="p-5 rounded-3xl bg-surface-mint border border-border-mint space-y-2">
              <span className="text-xs font-bold text-brand-navy block">Have questions about this delivery?</span>
              <p className="text-[11px] text-slate-600">Our team can check live courier telemetry or update drop-off notes.</p>
              <Link href="/contact" className="inline-block text-xs font-bold text-brand-teal hover:underline pt-1">
                Contact Customer Support →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
