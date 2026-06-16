export type DepositSyncMode = 'current' | 'next' | 'custom' | 'none';

export function monthStartText(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Periode setoran tidak valid.');
  }
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function nextYearMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function resolveDepositSyncStart(
  mode: DepositSyncMode,
  customMonth: string,
  current: { year: number; month: number }
) {
  if (mode === 'none') return null;
  if (mode === 'current') return monthStartText(current.year, current.month);
  if (mode === 'next') {
    const next = nextYearMonth(current.year, current.month);
    return monthStartText(next.year, next.month);
  }

  if (!/^\d{4}-\d{2}$/.test(customMonth)) throw new Error('Pilih periode mulai yang valid.');
  const [year, month] = customMonth.split('-').map(Number);
  const selected = monthStartText(year, month);
  const minimum = monthStartText(current.year, current.month);
  if (selected < minimum) throw new Error('Perubahan target tidak boleh diterapkan ke periode yang sudah lewat.');
  return selected;
}
