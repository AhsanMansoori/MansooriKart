'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Truck, Download, ArrowRight, MapPin, CreditCard, Clock, Sparkles, HelpCircle } from 'lucide-react';
import { Button, formatCurrency } from '@mansoorikart/ui';
import { useStoreConfig } from '../../components/providers';

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
  estimatedDelivery?: string;
  shippingAddress?: {
    fullName: string;
    street?: string;
    emirate?: string;
  };
  paymentMethod?: string;
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  items: OrderItem[];
}

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const { config } = useStoreConfig();

  const [order] = React.useState<OrderRecord | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('mk_last_order');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const orderId = searchParams.get('orderId') || order?.orderId || 'MK-89421';

  return (
    <div className="bg-surface-canvas min-h-screen py-10 sm:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Success Header Banner */}
        <div className="bg-white rounded-3xl p-8 sm:p-12 border border-slate-100 shadow-sm text-center space-y-4 mb-8">
          <div className="w-20 h-20 rounded-full bg-surface-mint text-brand-mint mx-auto flex items-center justify-center shadow-md shadow-brand-mint/20">
            <CheckCircle2 className="w-12 h-12" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-mint/20 text-brand-mint-dark text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" /> ORDER CONFIRMED
          </span>

          <h1 className="text-2xl sm:text-4xl font-black text-brand-navy tracking-tight">Thank you for your order!</h1>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Your order <strong className="text-brand-navy">#{orderId}</strong> has been received and is being prepared for express dispatch in our Dubai
            fulfilment center.
          </p>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Link href={`/orders/${orderId}`}>
              <Button variant="primary" size="md" className="rounded-full px-6 gap-2 text-xs font-bold shadow-sm">
                <Truck className="w-4 h-4" /> Track Live Order
              </Button>
            </Link>
            <Button
              variant="outline"
              size="md"
              onClick={() => window.print()}
              className="rounded-full px-6 gap-2 text-xs font-bold border-slate-200 hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> Download Tax Invoice
            </Button>
            <Link href="/shop">
              <Button variant="ghost" size="md" className="rounded-full px-5 text-xs font-semibold text-slate-600">
                Continue Shopping <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Order Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Estimated Delivery */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-surface-teal flex items-center justify-center text-brand-teal shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Estimated Delivery</span>
              <span className="text-xs sm:text-sm font-bold text-brand-navy mt-0.5 block">{order?.estimatedDelivery || 'Tomorrow, 9:00 AM - 6:00 PM'}</span>
              <span className="text-[11px] text-brand-mint font-semibold">Express UAE Service</span>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-surface-mint flex items-center justify-center text-brand-mint shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Delivering To</span>
              <span className="text-xs sm:text-sm font-bold text-brand-navy mt-0.5 block truncate max-w-[180px]">
                {order?.shippingAddress?.fullName || 'Ahmed Mansoori'}
              </span>
              <span className="text-[11px] text-slate-500 line-clamp-1">
                {order?.shippingAddress?.street ? `${order.shippingAddress.street}, ${order.shippingAddress.emirate}` : 'Al Wasl Road, Villa 42, Dubai'}
              </span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Payment</span>
              <span className="text-xs sm:text-sm font-bold text-brand-navy mt-0.5 block">{order?.paymentMethod || 'Visa Card (•••• 4242)'}</span>
              <span className="text-[11px] text-brand-mint font-semibold">Paid & Verified</span>
            </div>
          </div>
        </div>

        {/* Purchased Items Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-5">
          <h2 className="text-base font-black text-brand-navy pb-3 border-b border-slate-100">Items in This Order</h2>

          <div className="divide-y divide-slate-100">
            {(order?.items && order.items.length > 0
              ? order.items
              : [
                  {
                    id: 'sample-1',
                    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
                    price: 1199,
                    quantity: 1,
                    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80',
                    color: 'Midnight Black',
                  },
                ]
            ).map((item: OrderItem) => (
              <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                    {item.image && <Image src={item.image} alt={item.title} fill sizes="64px" className="object-cover" />}
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-brand-navy line-clamp-1">{item.title}</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Qty: {item.quantity} {item.color && `• Color: ${item.color}`}
                    </p>
                  </div>
                </div>

                <span className="text-sm font-bold text-brand-teal shrink-0">{formatCurrency(item.price * item.quantity, config.currency.code, 2)}</span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-bold text-brand-navy">{formatCurrency(order?.subtotal || 1199, config.currency.code, 2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Delivery Fee</span>
              <span className="font-bold text-brand-mint">FREE</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>UAE VAT (5%)</span>
              <span className="font-medium text-slate-700">{formatCurrency(order?.vatAmount || 59.95, config.currency.code, 2)}</span>
            </div>
            <div className="pt-3 border-t border-slate-200 flex justify-between text-base font-black text-brand-navy">
              <span>Total Paid</span>
              <span className="text-xl text-brand-teal">{formatCurrency(order?.grandTotal || 1258.95, config.currency.code, 2)}</span>
            </div>
          </div>
        </div>

        {/* Support Help Banner */}
        <div className="mt-8 p-4 rounded-2xl bg-surface-mint border border-border-mint flex items-center justify-between text-xs text-brand-navy">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-brand-teal shrink-0" />
            <span>Questions about your order? Our 24/7 Dubai Support Team is here to help.</span>
          </div>
          <Link href="/contact" className="font-bold text-brand-teal hover:underline shrink-0">
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <React.Suspense
      fallback={
        <div className="bg-surface-canvas min-h-screen py-16 flex items-center justify-center">
          <div className="p-8 text-center text-slate-500 font-medium">Loading order details...</div>
        </div>
      }
    >
      <OrderSuccessContent />
    </React.Suspense>
  );
}
