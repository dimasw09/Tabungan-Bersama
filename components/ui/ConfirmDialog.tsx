'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  tone?: 'danger' | 'primary';
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Iya, lanjut',
  cancelLabel = 'Nanti dulu',
  loading = false,
  tone = 'primary',
  children,
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/80 bg-white p-5 shadow-lg">
        <div className="-mx-5 -mt-5 mb-5 h-1.5 bg-[#4267d6]" />
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {description ? <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{description}</p> : null}
        {children ? <div className="mt-4 rounded-3xl bg-slate-50 p-4 text-sm font-medium text-slate-600">{children}</div> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading} className="w-full">
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading} className="w-full">
            {loading ? 'Lagi diproses...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
