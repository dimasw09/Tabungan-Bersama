import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildReportExcel } from '@/lib/reportExcelServer';
import { calculateMonthlyRecaps } from '@/lib/calculations';
import { consumeRateLimit } from '@/lib/server/rateLimit';
import type { Member, MonthlyDeposit, OtherMutation, StoryPhoto } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function jsonError(message: string, status: number, retryAfter?: number) {
  return NextResponse.json(
    { message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {})
      }
    }
  );
}

function validFilterYear(value: unknown) {
  if (value === 'all') return 'all';
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 2020 && year <= 2100 ? value : null;
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonError('Konfigurasi server belum lengkap.', 500);

  const accessToken = readBearerToken(request);
  if (!accessToken) return jsonError('Session login tidak ditemukan. Silakan masuk ulang.', 401);

  let filterYear: string | null = null;
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 10_000) return jsonError('Permintaan export terlalu besar.', 413);
    const body = await request.json() as { filterYear?: unknown };
    filterYear = validFilterYear(body.filterYear);
  } catch {
    return jsonError('Format permintaan export tidak valid.', 400);
  }
  if (!filterYear) return jsonError('Periode laporan tidak valid.', 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonError('Session sudah tidak berlaku. Silakan masuk ulang.', 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const rateLimit = await consumeRateLimit(admin, `excel:user:${userData.user.id}`, 6, 60);
  if (!rateLimit.allowed) return jsonError('Export terlalu sering. Coba lagi sebentar.', 429, rateLimit.retryAfterSeconds);

  const { data: membership, error: membershipError } = await userClient
    .from('household_members')
    .select('household_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (membershipError || !membership?.household_id) return jsonError('Household akun tidak ditemukan.', 403);

  const householdId = membership.household_id;
  const [membersResult, depositsResult, mutationsResult, photosResult] = await Promise.all([
    userClient.from('members').select('*').eq('household_id', householdId).order('name'),
    userClient.from('monthly_deposits').select('*, members(*)').eq('household_id', householdId).is('deleted_at', null).order('year').order('month'),
    userClient.from('other_mutations').select('*').eq('household_id', householdId).is('deleted_at', null).order('mutation_date'),
    userClient.from('story_photos').select('mutation_id').eq('household_id', householdId)
  ]);

  const queryError = membersResult.error || depositsResult.error || mutationsResult.error || photosResult.error;
  if (queryError) {
    console.error('Gagal mengambil data export:', queryError.message);
    return jsonError('Data laporan belum berhasil diambil.', 500);
  }

  const members = (membersResult.data || []) as Member[];
  const deposits = (depositsResult.data || []) as MonthlyDeposit[];
  const mutations = (mutationsResult.data || []) as OtherMutation[];
  const photos = (photosResult.data || []) as Array<Pick<StoryPhoto, 'mutation_id'>>;
  if (members.length > 20 || deposits.length > 5000 || mutations.length > 5000 || photos.length > 10000) {
    return jsonError('Jumlah data laporan melewati batas export.', 413);
  }

  const photoCounts = photos.reduce<Record<string, number>>((result, photo) => {
    result[photo.mutation_id] = (result[photo.mutation_id] || 0) + 1;
    return result;
  }, {});

  try {
    const { buffer, filename } = await buildReportExcel({
      members,
      deposits,
      mutations,
      recaps: calculateMonthlyRecaps(deposits, mutations),
      filterYear,
      photoCounts
    });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Gagal membuat export Excel:', error);
    return jsonError('Gagal membuat file Excel. Silakan coba lagi.', 500);
  }
}
