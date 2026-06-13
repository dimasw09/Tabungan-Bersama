'use client';

import { FormEvent, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';

interface ChangePasswordResponse {
  success?: boolean;
  error?: string;
}

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        window.location.replace('/login');
        return;
      }

      const { data: currentUserData, error: currentUserError } = await supabase.auth.getUser();
      if (!active) return;
      if (currentUserError || !currentUserData.user) {
        window.location.replace('/login');
        return;
      }
      if (currentUserData.user.app_metadata?.must_change_password !== true) {
        window.location.replace('/dashboard');
        return;
      }
      setChecking(false);
    });

    return () => { active = false; };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password baru minimal 8 karakter.');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Password baru harus memiliki huruf dan angka.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi password belum sama.');
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        window.location.replace('/login');
        return;
      }

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        cache: 'no-store',
        body: JSON.stringify({ newPassword, confirmPassword })
      });
      const result = (await response.json()) as ChangePasswordResponse;

      if (!response.ok || !result.success) {
        setError(result.error || 'Password belum berhasil diganti.');
        return;
      }

      // Login ulang diperlukan supaya token baru memuat flag must_change_password=false.
      await supabase.auth.signOut({ scope: 'local' });
      window.location.replace('/login?passwordChanged=1');
    } catch {
      setError('Tidak dapat terhubung ke server. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <LoadingState />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft md:p-8" aria-labelledby="change-password-title">
        <div className="rounded-[1.5rem] bg-[#4267d6] p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Langkah pertama</p>
          <h1 id="change-password-title" className="mt-2 text-2xl font-bold">Buat password pribadi</h1>
          <p className="mt-2 text-sm font-medium leading-6 text-white/80">Password bawaan hanya dipakai sekali. Setelah ini, masuklah dengan password yang hanya kamu ketahui.</p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="form-label" htmlFor="new-password">Password baru</label>
            <input
              id="new-password"
              className="form-input mt-2"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Minimal 8 karakter"
            />
            <p className="mt-2 text-xs font-medium text-slate-500">Gunakan minimal 8 karakter serta gabungan huruf dan angka.</p>
          </div>
          <div>
            <label className="form-label" htmlFor="confirm-password">Ulangi password baru</label>
            <input
              id="confirm-password"
              className="form-input mt-2"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Tampilkan password
          </label>
          {error ? <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
          <Button className="min-h-12 w-full" type="submit" disabled={loading}>{loading ? 'Menyimpan...' : 'Simpan password baru'}</Button>
          <Button className="min-h-12 w-full" type="button" variant="ghost" disabled={loading} onClick={async () => { await supabase.auth.signOut({ scope: 'local' }); window.location.replace('/login'); }}>Keluar dan pakai akun lain</Button>
        </form>
      </section>
    </main>
  );
}
