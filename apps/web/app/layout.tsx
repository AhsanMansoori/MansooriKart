import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '../components/providers';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { storefrontApi } from '../lib/api/storefront';
import type { StorefrontConfig } from '../lib/api/types';

export const metadata: Metadata = {
  title: 'MansooriKart | UAE Premier Marketplace',
  description:
    'MansooriKart is the leading UAE marketplace offering authentic electronics, lifestyle, fashion, and home essentials with express delivery across Dubai, Abu Dhabi, and all Emirates.',
  keywords: ['MansooriKart', 'UAE ecommerce', 'Dubai online shopping', 'Electronics UAE', 'AED shopping'],
  openGraph: {
    title: 'MansooriKart | UAE Premier Marketplace',
    description: 'Fast, secure shopping across the United Arab Emirates in AED.',
    locale: 'en_AE',
    type: 'website',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let initialConfig: StorefrontConfig | undefined;
  try {
    const res = await storefrontApi.getConfig();
    if (res?.data) {
      initialConfig = res.data;
    }
  } catch {
    // API server may not be reachable during build or offline environment
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-screen flex flex-col bg-surface-canvas text-text-primary">
        <Providers initialConfig={initialConfig}>
          <Header />
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
