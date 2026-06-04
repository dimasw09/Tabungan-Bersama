'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/deposits', label: 'Setoran', icon: '💸' },
  { href: '/mutations', label: 'Mutasi', icon: '🧾' },
  { href: '/recap', label: 'Rekap', icon: '📊' }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen px-3 py-4 pb-24 md:px-6 md:py-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 overflow-hidden rounded-[30px] blue-hero p-4 text-white shadow-sm md:p-5" style={{ boxShadow: '0 18px 40px rgba(52, 77, 147, 0.24)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Tabungan Berdua</p>
              <p className="mt-1 text-2xl font-bold leading-tight">Kakak & Mpip</p>
              <p className="mt-1 text-sm font-medium text-white/80">Simple tracker buat tabungan bersama.</p>
            </div>
            <Link href="/members" className="rounded-2xl bg-white/18 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/24">
              Setting
            </Link>
          </div>

          <nav className="mt-4 grid grid-cols-4 gap-2">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-2xl px-2 py-3 text-center text-xs font-semibold transition md:text-sm ${
                    active ? 'bg-white text-[#3557bf]' : 'bg-white/16 text-white hover:bg-white/22'
                  }`}
                >
                  <div className="text-base">{link.icon}</div>
                  <div className="mt-1">{link.label}</div>
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="space-y-5">{children}</div>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 gap-2 rounded-[24px] border border-slate-200 bg-white p-2 shadow-lg md:hidden">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link key={link.href} href={link.href} className={`rounded-2xl px-2 py-2 text-center text-[11px] font-semibold ${active ? 'bg-[#4267d6] text-white' : 'text-slate-500'}`}>
              <div className="text-base">{link.icon}</div>
              <div className="mt-1">{link.label}</div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
