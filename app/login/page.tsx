'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  mustChangePassword?: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('passwordChanged') === '1') {
      setSuccess('Password baru berhasil disimpan. Silakan masuk kembali.');
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: currentUserData } = await supabase.auth.getUser();
      if (!currentUserData.user) return;
      router.replace(currentUserData.user.app_metadata?.must_change_password === true ? '/change-password' : '/dashboard');
    });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      setError('Supabase belum dikonfigurasi. Isi environment variables terlebih dahulu.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ username: username.trim(), password })
      });

      const result = (await response.json()) as LoginResponse;
      if (!response.ok || !result.accessToken || !result.refreshToken) {
        setError(result.error || 'Username atau password salah.');
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken
      });

      if (sessionError) {
        setError('Session login gagal dibuat. Coba masuk lagi.');
        return;
      }

      if (result.mustChangePassword) {
        window.location.replace('/change-password');
        return;
      }

      const next = new URLSearchParams(window.location.search).get('next');
      const destination = next?.startsWith('/') ? next : '/dashboard';
      window.location.replace(destination);
    } catch {
      setError('Tidak dapat terhubung ke server login. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="login-love-card w-full max-w-md rounded-[2rem] border border-white/80 bg-white p-6 shadow-soft md:p-8" aria-labelledby="login-title">
        <div className="blue-hero rounded-[1.5rem] bg-[#4267d6] p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Tabungan Cinta</p>
          <h1 id="login-title" className="mt-2 text-2xl font-bold">Masuk sebagai Kakak atau Mpip</h1>
          <p className="mt-2 text-sm font-medium text-white/80">Pakai username pribadi dan password akun masing-masing.</p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="form-label" htmlFor="username">Username</label>
            <input
              id="username"
              className="form-input mt-2"
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Contoh: 020802"
            />
          </div>
          <div>
            <label className="form-label" htmlFor="password">Password</label>
            <input id="password" className="form-input mt-2" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {!isSupabaseConfigured ? <p role="alert" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Isi NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, dan SUPABASE_SERVICE_ROLE_KEY terlebih dahulu.</p> : null}
          {success ? <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{success}</p> : null}
          {error ? <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
          <Button className="min-h-12 w-full" type="submit" disabled={loading || !isSupabaseConfigured}>{loading ? 'Lagi masuk...' : 'Masuk'}</Button>
        </form>
      </section>
    </main>
  );
}
