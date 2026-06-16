import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

type LocalWindow = { count: number; resetAt: number };
type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const localWindows = new Map<string, LocalWindow>();

export function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
}

function hashKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function consumeLocal(keyHash: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const current = localWindows.get(keyHash);
  if (!current || current.resetAt <= now) {
    localWindows.set(keyHash, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function consumeRateLimit(
  admin: SupabaseClient,
  rawKey: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const keyHash = hashKey(rawKey);
  const local = consumeLocal(keyHash, limit, windowSeconds);
  if (!local.allowed) return local;

  const { data, error } = await admin.rpc('consume_api_rate_limit', {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });

  if (error) {
    // Tetap ada proteksi per instance sebelum SQL P0 dijalankan.
    console.warn('Rate limit database belum tersedia, memakai limiter lokal:', error.message);
    return local;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: row?.allowed !== false,
    retryAfterSeconds: Number(row?.retry_after_seconds || 0)
  };
}
