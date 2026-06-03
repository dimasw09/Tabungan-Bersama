import type { PropsWithChildren } from 'react';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/80 p-5 shadow-soft backdrop-blur-xl ${className}`}>
      <div className="palette-strip absolute inset-x-0 top-0 h-1.5" />
      <div className="relative">{children}</div>
    </div>
  );
}
