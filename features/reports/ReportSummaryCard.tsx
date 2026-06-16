import type { ReactNode } from 'react';

export function SummaryCard({ label, value, helper, tone = 'blue' }: { label: string; value: ReactNode; helper?: string; tone?: 'blue' | 'green' | 'rose' | 'slate' }) {
  const toneClass = { blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700', rose: 'bg-rose-50 text-rose-700', slate: 'bg-slate-50 text-slate-700' }[tone];
  return <div className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${toneClass}`}>{label}</span><p className="mt-3 text-xl font-bold text-slate-900 md:text-2xl">{value}</p>{helper ? <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">{helper}</p> : null}</div>;
}
