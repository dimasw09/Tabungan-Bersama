'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/members', label: 'Anggota', icon: '👩‍❤️‍👨' },
  { href: '/deposits', label: 'Setoran', icon: '💸' },
  { href: '/mutations', label: 'Mutasi', icon: '🧾' },
  { href: '/recap', label: 'Rekap', icon: '📊' }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen px-3 py-4 pb-24 md:px-8 md:pb-8">
      <div className="fixed inset-x-0 top-0 z-[55] h-2 palette-strip" />
      <div className="mx-auto max-w-7xl pt-2">
        <header className="sticky top-4 z-40 mb-6 overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 p-3 shadow-soft backdrop-blur-xl">
          <div className="palette-strip absolute inset-x-0 top-0 h-1.5" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/dashboard" className="flex items-center gap-3 px-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-gradient-to-br from-blush-300 via-creamsoft-100 to-skysoft-300 text-2xl shadow-sm ring-2 ring-white/70">
                💞
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-blush-500">Kakak & Mpip</p>
                <p className="text-lg font-black text-stone-800">Tabungan Bersama</p>
              </div>
            </Link>
            <nav className="hidden gap-2 overflow-x-auto pb-1 md:flex md:pb-0">
              {links.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-2xl px-4 py-2 text-sm font-black transition ${
                      active
                        ? 'bg-gradient-to-r from-blush-300 via-creamsoft-100 to-skysoft-300 text-stone-900 shadow-sm ring-1 ring-white/70'
                        : 'text-stone-500 hover:bg-white/80 hover:text-stone-800'
                    }`}
                  >
                    <span className="mr-1">{link.icon}</span>
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="hidden rounded-2xl bg-gradient-to-r from-blush-100 via-creamsoft-50 to-skysoft-100 px-4 py-2 text-sm font-black text-stone-700 ring-1 ring-white/70 md:block">
              Mode link berdua 💞
            </div>
          </div>
        </header>

        {children}
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-5 gap-1 overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 p-2 shadow-soft backdrop-blur-xl md:hidden">
        <div className="palette-strip absolute inset-x-0 top-0 h-1" />
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex flex-col items-center justify-center rounded-2xl px-2 py-2 text-[11px] font-black transition ${
                active ? 'bg-gradient-to-r from-blush-300 via-creamsoft-100 to-skysoft-300 text-stone-900' : 'text-stone-500'
              }`}
            >
              <span className="text-base leading-none">{link.icon}</span>
              <span className="mt-1 truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
