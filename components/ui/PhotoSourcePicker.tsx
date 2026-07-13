'use client';

import type { ChangeEvent } from 'react';
import { AppIcon } from './AppIcon';

interface PhotoSourcePickerProps {
  accept: string;
  disabled?: boolean;
  multipleGallery?: boolean;
  className?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function PhotoSourcePicker({
  accept,
  disabled = false,
  multipleGallery = false,
  className = '',
  onChange
}: PhotoSourcePickerProps) {
  const disabledClass = disabled
    ? 'cursor-not-allowed opacity-60'
    : 'cursor-pointer focus-within:ring-4 focus-within:ring-blue-100';
  const cameraInteractionClass = disabled ? '' : 'hover:bg-[#3557bf]';
  const galleryInteractionClass = disabled ? '' : 'hover:bg-slate-50';

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      <label
        className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#4267d6] px-3 py-3 text-center text-sm font-bold text-white transition ${cameraInteractionClass} ${disabledClass}`}
        aria-disabled={disabled || undefined}
      >
        <AppIcon name="camera" size={18} />
        Ambil foto
        <input
          type="file"
          accept={accept}
          capture="environment"
          className="sr-only"
          disabled={disabled}
          onChange={onChange}
        />
      </label>

      <label
        className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-center text-sm font-bold text-slate-700 transition ${galleryInteractionClass} ${disabledClass}`}
        aria-disabled={disabled || undefined}
      >
        <AppIcon name="image" size={18} />
        Pilih galeri
        <input
          type="file"
          accept={accept}
          multiple={multipleGallery}
          className="sr-only"
          disabled={disabled}
          onChange={onChange}
        />
      </label>
    </div>
  );
}
