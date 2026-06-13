export const ANNIVERSARY_MONTH = 9;
export const ANNIVERSARY_DAY = 25;
export const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

export function formatCapsuleDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: JAKARTA_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date).replace('.', ':');
}

export function jakartaDateTimeToIso(dateText: string, timeText: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return null;
  const parsed = new Date(`${dateText}T${timeText}:00+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isoToJakartaInputs(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function nextAnniversary(now = new Date()) {
  const jakartaYear = Number(new Intl.DateTimeFormat('en', { timeZone: JAKARTA_TIME_ZONE, year: 'numeric' }).format(now));
  let target = new Date(`${jakartaYear}-09-25T00:00:00+07:00`);
  if (target.getTime() <= now.getTime()) target = new Date(`${jakartaYear + 1}-09-25T00:00:00+07:00`);
  return target;
}

export function anniversaryCountdown(now = new Date()) {
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const month = Number(localParts.find((part) => part.type === 'month')?.value || 0);
  const day = Number(localParts.find((part) => part.type === 'day')?.value || 0);
  if (month === ANNIVERSARY_MONTH && day === ANNIVERSARY_DAY) return { target: now, totalDays: 0 };

  const target = nextAnniversary(now);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const totalDays = Math.ceil(diff / 86_400_000);
  return { target, totalDays };
}

export function dateInputInJakarta(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function nextAnniversaryInputs(now = new Date()) {
  const target = nextAnniversary(now);
  return { ...isoToJakartaInputs(target.toISOString()), time: '00:00' };
}
