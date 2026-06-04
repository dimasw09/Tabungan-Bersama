import type { PropsWithChildren } from 'react';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <div className={`rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm ${className}`} style={{ boxShadow: '0 12px 30px rgba(52, 77, 147, 0.10)' }}>{children}</div>;
}
