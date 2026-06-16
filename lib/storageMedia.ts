import { supabase } from './supabase/client';

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function getSignedUrlCached(bucket: string, path: string | null | undefined, expiresInSeconds = 60 * 60) {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  const key = `${bucket}:${path}`;
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  signedUrlCache.set(key, {
    url: data.signedUrl,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
  });
  return data.signedUrl;
}

export function invalidateSignedUrl(bucket: string, path: string) {
  signedUrlCache.delete(`${bucket}:${path}`);
}

export async function removeStoragePaths(bucket: string, paths: Array<string | null | undefined>) {
  const uniquePaths = Array.from(new Set(paths.filter((path): path is string => Boolean(path && !path.startsWith('http')))));
  if (uniquePaths.length === 0) return null;
  const result = await supabase.storage.from(bucket).remove(uniquePaths);
  if (!result.error) uniquePaths.forEach((path) => invalidateSignedUrl(bucket, path));
  return result.error;
}
