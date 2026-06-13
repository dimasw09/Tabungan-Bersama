'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface ToastInput {
  title: string;
  message?: string;
  type?: ToastType;
}
interface ToastItem extends ToastInput {
  id: number;
  type: ToastType;
}

const ToastContext = createContext<{ toast: (input: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((input: ToastInput) => {
    const id = Date.now();
    const item: ToastItem = { ...input, id, type: input.type ?? 'info' };
    setToasts((current) => [...current, item]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toastItem) => toastItem.id !== id));
    }, 3500);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[80] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div
            key={item.id}
            role={item.type === 'error' ? 'alert' : 'status'}
            className={`toast-pop rounded-3xl border bg-white p-4 text-sm shadow-lg ${
              item.type === 'success'
                ? 'border-skysoft-200'
                : item.type === 'error'
                  ? 'border-blush-200'
                  : 'border-stone-200'
            }`}
          >
            <p className="font-bold text-stone-800">{item.title}</p>
            {item.message ? <p className="mt-1 text-stone-500">{item.message}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast harus dipakai di dalam ToastProvider');
  return context;
}
