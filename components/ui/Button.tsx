import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
}

const variants = {
  primary: 'bg-[#4267d6] text-white hover:bg-[#3557bf]',
  secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  success: 'bg-[#dfe8ff] text-[#3557bf] hover:bg-[#cfdcff]',
  danger: 'bg-[#ffe3ea] text-[#b44967] hover:bg-[#ffd3df]',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100'
};

export function Button({ children, className = '', variant = 'primary', ...props }: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
