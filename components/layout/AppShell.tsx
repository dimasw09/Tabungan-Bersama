'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { AppIcon } from '@/components/ui/AppIcon';

const links = [
  { href: '/dashboard', label: 'Beranda', icon: 'home' as const },
  { href: '/deposits', label: 'Setoran', icon: 'wallet' as const },
  { href: '/mutations', label: 'Cerita', icon: 'heart' as const },
  { href: '/recap', label: 'Laporan', icon: 'chart' as const }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user || !active) return;
      const { data: membership } = await supabase.from('household_members').select('display_name').eq('user_id', data.user.id).maybeSingle();
      if (active) setDisplayName(membership?.display_name || data.user.email || '');
    });
    return () => { active = false; };
  }, []);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) console.error('Gagal logout dari Supabase:', error.message);
    } finally {
      window.location.replace('/login');
    }
  }

  return (
    <div className="relative min-h-screen px-3 py-3 pb-28 md:px-6 md:py-6">
      <div className="mx-auto max-w-5xl">
        <header className="blue-hero soft-pop mb-4 overflow-hidden rounded-[26px] p-4 text-white shadow-sm md:mb-5 md:rounded-[30px] md:p-5" style={{ boxShadow: '0 18px 40px rgba(52, 77, 147, 0.24)' }}>
          <span aria-hidden="true" className="heart-beat pointer-events-none absolute right-24 top-4 hidden text-4xl text-white/15 sm:block">♥</span>
          <span aria-hidden="true" className="pointer-events-none absolute bottom-4 right-10 text-xl text-white/10">♥</span>
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/75 md:text-xs">Tabungan Bersama</p>
              <p className="mt-1 text-xl font-bold leading-tight md:text-2xl">Kakak sayang Mpip</p>
              <p className="mt-1 hidden text-sm font-medium text-white/80 sm:block">Pelan-pelan, mimpi kita jadi nyata.</p>
              {displayName ? <p className="mt-2 truncate text-xs font-semibold text-white/75">Masuk sebagai {displayName}</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href="/members" aria-label="Buka pengaturan" className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-white/20 px-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30 focus:outline-none focus:ring-2 focus:ring-white">
                <AppIcon name="settings" size={18} />
                <span className="hidden sm:inline">Pengaturan</span>
              </Link>
              <button type="button" onClick={signOut} disabled={signingOut} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-semibold text-[#3557bf] transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-60">
                <AppIcon name="logout" size={18} />
                <span className="hidden sm:inline">{signingOut ? 'Keluar...' : 'Keluar'}</span>
              </button>
            </div>
          </div>

          <nav className="mt-4 hidden grid-cols-4 gap-2 md:grid" aria-label="Navigasi utama">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined} className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-white ${active ? 'nav-active-love bg-white text-[#3557bf]' : 'bg-white/15 text-white hover:bg-white/25'}`}>
                  <AppIcon name={link.icon} size={19} />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <div key={pathname} className="page-enter space-y-5">{children}</div>
      </div>

      <nav className="bottom-safe-area fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 gap-1 rounded-[24px] border border-slate-200/80 bg-white/95 p-2 shadow-xl backdrop-blur md:hidden" aria-label="Navigasi utama">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center rounded-2xl px-1 py-2 text-[11px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${active ? 'nav-active-love bg-[#4267d6] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              <AppIcon name={link.icon} size={20} />
              <span className="mt-1">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
