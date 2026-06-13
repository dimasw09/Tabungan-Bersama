'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [membershipError, setMembershipError] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setChecking(false); setMembershipError(true); return; }
    let active = true;

    async function verifyAccess() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;

      if (!sessionData.session) {
        setChecking(false);
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      // getUser membaca metadata terbaru dari server, bukan hanya JWT lokal yang mungkin masih lama.
      const { data: currentUserData, error: currentUserError } = await supabase.auth.getUser();
      if (!active) return;
      if (currentUserError || !currentUserData.user) {
        setAuthorized(false);
        setChecking(false);
        window.location.replace('/login');
        return;
      }

      if (currentUserData.user.app_metadata?.must_change_password === true) {
        setAuthorized(false);
        setChecking(false);
        window.location.replace('/change-password');
        return;
      }

      const { data, error } = await supabase
        .from('household_members')
        .select('user_id')
        .eq('user_id', currentUserData.user.id)
        .maybeSingle();

      if (!active) return;

      if (data && !error) {
        const currentYear = new Date().getFullYear();
        const ensureKey = `yearly-deposits:${currentUserData.user.id}:${currentYear}`;

        if (!window.sessionStorage.getItem(ensureKey)) {
          const { error: ensureError } = await supabase.rpc('ensure_current_year_deposits');
          if (!active) return;

          if (ensureError) {
            console.error('Gagal menyiapkan setoran tahunan otomatis:', ensureError.message);
          } else {
            window.sessionStorage.setItem(ensureKey, 'done');
          }
        }
      }

      setAuthorized(Boolean(data) && !error);
      setMembershipError(!data || Boolean(error));
      setChecking(false);
    }

    verifyAccess();
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthorized(false);
        setChecking(false);
        window.location.replace('/login');
        return;
      }
      if (event === 'SIGNED_IN') verifyAccess();
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (checking) return <LoadingState />;

  if (membershipError || !authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-slate-100 bg-white p-6 text-center shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#3557bf]">Akses belum terhubung</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">{isSupabaseConfigured ? 'Akun ini belum terdaftar sebagai Kakak atau Mpip' : 'Supabase belum dikonfigurasi'}</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{isSupabaseConfigured ? 'Tambahkan akun ini ke tabel household_members melalui SQL setup Tahap 1, lalu login ulang.' : 'Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local atau Environment Variables Vercel.'}</p>
          {isSupabaseConfigured ? <Button className="mt-5 w-full" onClick={() => supabase.auth.signOut()}>Keluar</Button> : null}
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
