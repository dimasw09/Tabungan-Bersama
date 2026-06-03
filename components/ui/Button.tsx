import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
}

const variants = {
  primary:
    'bg-gradient-to-r from-blush-300 via-blush-200 to-skysoft-300 text-stone-900 shadow-sm ring-1 ring-white/70 hover:-translate-y-0.5 hover:shadow-dreamy',
  secondary:
    'bg-white/90 text-stone-700 border border-white hover:-translate-y-0.5 hover:bg-creamsoft-50 hover:shadow-sm',
  success: 'bg-skysoft-300 text-stone-900 hover:-translate-y-0.5 hover:bg-skysoft-400 hover:shadow-sm',
  danger: 'bg-blush-300 text-stone-900 hover:-translate-y-0.5 hover:bg-blush-400 hover:shadow-sm',
  ghost: 'bg-transparent text-stone-600 hover:bg-white/70'
};

export function Button({ children, className = '', variant = 'primary', ...props }: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
