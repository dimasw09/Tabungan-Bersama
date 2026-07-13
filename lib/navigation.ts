export function safeInternalPath(value: string | null | undefined, fallback = '/dashboard') {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;

  try {
    const parsed = new URL(value, 'https://app.local');
    if (parsed.origin !== 'https://app.local') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}