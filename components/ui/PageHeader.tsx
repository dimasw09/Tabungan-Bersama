import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="mb-2 inline-flex rounded-full bg-gradient-to-r from-blush-300 via-creamsoft-100 to-skysoft-300 px-3 py-1 text-xs font-black uppercase tracking-[0.22em] text-stone-800 shadow-sm ring-1 ring-white/70">
          Tabungan Berdua
        </p>
        <h1 className="text-3xl font-black tracking-tight text-stone-900 md:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-stone-600 md:text-base">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
