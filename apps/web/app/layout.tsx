import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';
import { Providers } from '../components/providers';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { CartDrawer } from '../components/CartDrawer';
import { storefrontApi } from '../lib/api/storefront';
import type { StorefrontConfig } from '../lib/api/types';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MansooriKart | Shop More · Live Better',
  description: 'Curating gadgets, smart-home essentials, and premium accessories to help you live smarter every day with fast UAE delivery.',
  keywords: ['MansooriKart', 'UAE ecommerce', 'Dubai online shopping', 'Electronics UAE', 'AED shopping'],
  openGraph: {
    title: 'MansooriKart | Shop More · Live Better',
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
    <html lang="en" className={`h-full antialiased ${poppins.variable}`}>
      <body className={`${poppins.className} min-h-screen flex flex-col bg-surface-canvas text-text-foreground font-sans`}>
        <Providers initialConfig={initialConfig}>
          <Header />
          <CartDrawer />
          <main className="flex-1 w-full">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
