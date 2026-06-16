import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { consumeRateLimit, getClientIp } from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

const GENERIC_LOGIN_ERROR = 'Username atau password salah.';

function noStoreJson(body: Record<string, unknown>, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('Username login belum dikonfigurasi: environment Supabase server tidak lengkap.');
    return noStoreJson({ error: 'Konfigurasi login server belum lengkap.' }, 500);
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return noStoreJson({ error: GENERIC_LOGIN_ERROR }, 400);
  }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const clientIp = getClientIp(request);
  const [ipLimit, accountLimit, usernameLimit] = await Promise.all([
    consumeRateLimit(admin, `login:ip:${clientIp}`, 20, 15 * 60),
    consumeRateLimit(admin, `login:account:${clientIp}:${username || 'invalid'}`, 8, 15 * 60),
    consumeRateLimit(admin, `login:username:${username || 'invalid'}`, 12, 15 * 60)
  ]);
  const denied = !ipLimit.allowed ? ipLimit : !accountLimit.allowed ? accountLimit : !usernameLimit.allowed ? usernameLimit : null;
  if (denied) {
    return noStoreJson(
      { error: 'Terlalu banyak percobaan login. Coba lagi beberapa saat.' },
      429,
      { 'Retry-After': String(denied.retryAfterSeconds) }
    );
  }

  if (!/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 1 || password.length > 256) {
    return noStoreJson({ error: GENERIC_LOGIN_ERROR }, 401);
  }

  const { data: loginIdentity, error: usernameError } = await admin
    .from('login_usernames')
    .select('user_id')
    .eq('username_normalized', username)
    .maybeSingle();

  if (usernameError) {
    console.error('Gagal membaca username login:', usernameError.message);
    return noStoreJson({ error: 'Login sedang tidak tersedia. Coba lagi.' }, 500);
  }

  if (!loginIdentity?.user_id) return noStoreJson({ error: GENERIC_LOGIN_ERROR }, 401);

  const { data: authUserData, error: authUserError } = await admin.auth.admin.getUserById(loginIdentity.user_id);
  const email = authUserData.user?.email;
  if (authUserError || !email) {
    console.error('Akun username tidak memiliki user Auth yang valid:', authUserError?.message || loginIdentity.user_id);
    return noStoreJson({ error: GENERIC_LOGIN_ERROR }, 401);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.session) return noStoreJson({ error: GENERIC_LOGIN_ERROR }, 401);

  return noStoreJson({
    accessToken: signInData.session.access_token,
    refreshToken: signInData.session.refresh_token,
    mustChangePassword: authUserData.user.app_metadata?.must_change_password === true
  }, 200);
}
