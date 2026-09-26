import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MansooriKart Storefront',
  description: 'MansooriKart Customer Storefront',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
