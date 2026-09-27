import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '../components/providers';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
        <Providers>
          <Header />
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
