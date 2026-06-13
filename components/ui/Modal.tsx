'use client';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  mobileSheet?: boolean;
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, description, children, onClose, mobileSheet = false }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus());

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

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
    <div className={`fixed inset-0 z-50 flex bg-slate-950/45 backdrop-blur-sm ${mobileSheet ? 'items-end p-0 sm:items-center sm:justify-center sm:p-4' : 'items-center justify-center p-4'}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={trapFocus}
        className={`max-h-[92dvh] w-full max-w-2xl overflow-auto bg-white shadow-2xl ${mobileSheet ? 'rounded-t-[2rem] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[2rem]' : 'rounded-[2rem] p-5'}`}
      >
        {mobileSheet ? <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" /> : null}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-xl font-bold text-slate-900">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm font-medium leading-5 text-slate-500">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl leading-none text-slate-600 transition hover:bg-slate-200 focus:outline-none focus:ring-4 focus:ring-blue-100" aria-label={`Tutup ${title}`}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
