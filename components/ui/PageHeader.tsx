import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-2 md:mb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900 md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-500 md:text-base">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
