import * as React from 'react';
import { Truck, ShieldCheck, RotateCcw, Headphones } from 'lucide-react';
import { TrustBadge, formatCurrency } from '@mansoorikart/ui';
import { storefrontApi } from '../lib/api/storefront';

interface TrustBadgeStripProps {
  className?: string;
  variant?: 'card' | 'horizontal';
}

export async function TrustBadgeStrip({ className = '', variant = 'horizontal' }: TrustBadgeStripProps) {
  let freeShippingThreshold = 100;
  let currencyCode = 'AED';

  try {
    const configRes = await storefrontApi.getConfig();
    if (configRes?.data?.shipping) {
      freeShippingThreshold = configRes.data.shipping.freeShippingThreshold ?? 100;
      currencyCode = configRes.data.currency?.code ?? 'AED';
    }
  } catch {
    // Graceful fallback to default values
  }

  const badges = [
    {
      icon: <Truck className="w-5 h-5 text-brand-teal" />,
      title: 'Free Delivery',
      subtitle: `On orders over ${formatCurrency(freeShippingThreshold, currencyCode, 0)}`,
      iconVariant: 'teal' as const,
    },
    {
      icon: <ShieldCheck className="w-5 h-5 text-brand-mint" />,
      title: 'Secure Payment',
      subtitle: '100% protected checkout',
      iconVariant: 'mint' as const,
    },
    {
      icon: <RotateCcw className="w-5 h-5 text-brand-teal" />,
      title: 'Easy Returns',
      subtitle: 'Within 30 days hassle-free',
      iconVariant: 'teal' as const,
    },
    {
      icon: <Headphones className="w-5 h-5 text-brand-mint" />,
      title: '24/7 Support',
      subtitle: "We're always here to assist",
      iconVariant: 'mint' as const,
    },
  ];

  return (
    <section className={`w-full ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_4px_20px_-2px_rgba(11,25,44,0.04)] p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            {badges.map(b => (
              <div key={b.title} className="pt-3 sm:pt-0 sm:px-4 first:pt-0 first:px-0">
                <TrustBadge icon={b.icon} title={b.title} subtitle={b.subtitle} variant={variant} iconVariant={b.iconVariant} className="p-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
