import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChangePasswordBody {
  newPassword?: unknown;
  confirmPassword?: unknown;
}

function noStoreJson(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' }
  });
}

function readBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function validatePassword(password: string) {
  if (password.length < 8) return 'Password baru minimal 8 karakter.';
  if (password.length > 72) return 'Password baru maksimal 72 karakter.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password baru harus memiliki huruf dan angka.';
  }
  return '';
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('Ganti password belum dikonfigurasi: environment Supabase server tidak lengkap.');
    return noStoreJson({ error: 'Konfigurasi server belum lengkap.' }, 500);
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) return noStoreJson({ error: 'Session login tidak ditemukan. Silakan masuk ulang.' }, 401);

  let body: ChangePasswordBody;
  try {
    body = (await request.json()) as ChangePasswordBody;
  } catch {
    return noStoreJson({ error: 'Data password tidak valid.' }, 400);
  }

  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  const passwordError = validatePassword(newPassword);

  if (passwordError) return noStoreJson({ error: passwordError }, 400);
  if (newPassword !== confirmPassword) return noStoreJson({ error: 'Konfirmasi password belum sama.' }, 400);

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: verifiedUser, error: verifyError } = await authClient.auth.getUser(accessToken);

  if (verifyError || !verifiedUser.user) {
    return noStoreJson({ error: 'Session sudah tidak berlaku. Silakan masuk ulang.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: adminUserData, error: adminUserError } = await admin.auth.admin.getUserById(verifiedUser.user.id);
  const authUser = adminUserData.user;

  if (adminUserError || !authUser?.email) {
    console.error('Akun untuk ganti password tidak ditemukan:', adminUserError?.message || verifiedUser.user.id);
    return noStoreJson({ error: 'Akun tidak ditemukan. Silakan masuk ulang.' }, 401);
  }

  if (authUser.app_metadata?.must_change_password !== true) {
    return noStoreJson({ error: 'Password akun ini sudah pernah diganti.' }, 409);
  }

  const { data: usernameRow } = await admin
    .from('login_usernames')
    .select('username_normalized')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (usernameRow?.username_normalized && newPassword.toLowerCase() === usernameRow.username_normalized) {
    return noStoreJson({ error: 'Password baru tidak boleh sama dengan username.' }, 400);
  }

  // Tolak penggunaan ulang password sementara yang sedang aktif.
  const currentPasswordCheck = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { error: samePasswordError } = await currentPasswordCheck.auth.signInWithPassword({
    email: authUser.email,
    password: newPassword
  });
  if (!samePasswordError) {
    return noStoreJson({ error: 'Password baru tidak boleh sama dengan password bawaan.' }, 400);
  }

  const nextAppMetadata = {
    ...authUser.app_metadata,
    must_change_password: false,
    password_changed_at: new Date().toISOString()
  };
  const { error: updateError } = await admin.auth.admin.updateUserById(authUser.id, {
    password: newPassword,
    app_metadata: nextAppMetadata
  });

  if (updateError) {
    console.error('Gagal memperbarui password:', updateError.message);
    const message = updateError.message.toLowerCase().includes('password')
      ? 'Password baru ditolak oleh aturan keamanan Supabase.'
      : 'Password belum berhasil disimpan. Coba lagi.';
    return noStoreJson({ error: message }, 400);
  }

  return noStoreJson({ success: true }, 200);
}
