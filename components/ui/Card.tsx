import type { PropsWithChildren } from 'react';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <div className={`motion-card rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm ${className}`} style={{ boxShadow: 'var(--card-shadow)' }}>{children}</div>;
}
