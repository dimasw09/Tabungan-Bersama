export interface MonthTogetherness {
  key: string;
  year: number;
  month: number;
  completeTogether: boolean;
  isFuture: boolean;
  isCurrent: boolean;
  required: number;
  paid: number;
  progress: number;
  memberStates: Array<{ name: string; complete: boolean }>;
}

export interface TimelineItem {
  id: string;
  date: string;
  kind: 'deposit' | 'story';
  title: string;
  description: string;
  amount: number;
  photoCount?: number;
}

export function monthPosition(year: number, month: number) {
  return year * 12 + month;
}

export function periodDescription(filterYear: string) {
  return filterYear === 'all' ? 'Semua periode yang sudah tersimpan' : `Januari–Desember ${filterYear}`;
}
