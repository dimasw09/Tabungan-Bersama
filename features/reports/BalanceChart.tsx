import type { MonthlyRecap } from '@/lib/types';
import { monthLabel, rupiah, shortMonthLabel } from '@/lib/format';

export function BalanceChart({ recaps }: { recaps: MonthlyRecap[] }) {
  if (!recaps.length) return null;
  const width = 760;
  const height = 260;
  const padding = { top: 22, right: 22, bottom: 44, left: 72 };
  const values = recaps.map((item) => item.endingBalance);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(...values, 1);
  const range = Math.max(maxValue - minValue, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (recaps.length === 1 ? plotWidth / 2 : (index / (recaps.length - 1)) * plotWidth);
  const y = (value: number) => padding.top + ((maxValue - value) / range) * plotHeight;
  const points = recaps.map((item, index) => `${x(index)},${y(item.endingBalance)}`).join(' ');
  const yTicks = [maxValue, minValue + range / 2, minValue];
  const labelStep = recaps.length > 8 ? Math.ceil(recaps.length / 6) : 1;

  return <div className="overflow-x-auto pb-1"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik pertumbuhan saldo per bulan" className="min-w-[680px] w-full"><defs><linearGradient id="balanceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4267d6" stopOpacity="0.28" /><stop offset="100%" stopColor="#4267d6" stopOpacity="0.02" /></linearGradient></defs>{yTicks.map((tick, index) => <g key={`${tick}-${index}`}><line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeDasharray="5 5" /><text x={padding.left - 10} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(tick)}</text></g>)}<polygon className="chart-area-in" points={`${padding.left},${height - padding.bottom} ${points} ${width - padding.right},${height - padding.bottom}`} fill="url(#balanceArea)" /><polyline className="chart-line-draw" points={points} fill="none" stroke="#4267d6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{recaps.map((item, index) => <g key={item.key}><circle className="chart-point-pop" style={{ animationDelay: `${500 + index * 70}ms` }} cx={x(index)} cy={y(item.endingBalance)} r="5" fill="#ffffff" stroke="#4267d6" strokeWidth="3"><title>{`${monthLabel(item.year, item.month)}: ${rupiah(item.endingBalance)}`}</title></circle>{index % labelStep === 0 || index === recaps.length - 1 ? <text x={x(index)} y={height - 16} textAnchor="middle" fontSize="11" fill="#64748b">{shortMonthLabel(item.year, item.month)}</text> : null}</g>)}</svg></div>;
}
