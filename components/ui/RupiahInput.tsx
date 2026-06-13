'use client';

import type { InputHTMLAttributes } from 'react';

interface RupiahInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'inputMode'> {
  value: number;
  onValueChange: (value: number) => void;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.trunc(value));
}

export function RupiahInput({ value, onValueChange, className = '', disabled, ...props }: RupiahInputProps) {
  return (
    <div className={`relative ${disabled ? 'opacity-70' : ''}`}>
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-bold text-slate-500">Rp</span>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={formatNumber(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 13);
          onValueChange(digits ? Number(digits) : 0);
        }}
        className={`form-input pl-12 text-base font-bold tabular-nums ${className}`}
      />
    </div>
  );
}
