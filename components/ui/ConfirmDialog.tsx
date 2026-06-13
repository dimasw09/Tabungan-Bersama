'use client';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
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

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({ open, title, description, confirmLabel = 'Iya, lanjut', cancelLabel = 'Nanti dulu', loading = false, tone = 'primary', children, onConfirm, onClose }: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => cancelRef.current?.focus());

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !loading) onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [loading, onClose, open]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
      <div ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onKeyDown={trapFocus} className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/80 bg-white p-5 shadow-lg">
        <div className="-mx-5 -mt-5 mb-5 h-1.5 bg-[#4267d6]" />
        <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
        {description ? <p id={descriptionId} className="mt-2 text-sm font-medium leading-6 text-slate-600">{description}</p> : null}
        {children ? <div className="mt-4 rounded-3xl bg-slate-50 p-4 text-sm font-medium text-slate-600">{children}</div> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={onClose} disabled={loading} className="w-full">{cancelLabel}</Button>
          <Button type="button" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading} className="w-full">{loading ? 'Lagi diproses...' : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
