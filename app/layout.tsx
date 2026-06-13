import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { LoveAtmosphere } from '@/components/ui/LoveAtmosphere';

export const metadata: Metadata = {
  title: 'Tabungan Bersama Kakak & Mpip',
  description: 'Catatan tabungan cinta Kakak dan Mpip.'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <LoveAtmosphere />
        <div className="relative z-10"><ToastProvider>{children}</ToastProvider></div>
      </body>
    </html>
  );
}
