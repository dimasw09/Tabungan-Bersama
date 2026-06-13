'use client';

import { useEffect, useState } from 'react';
import type { LoveCapsuleTheme } from '@/lib/types';
import { formatCapsuleDateTime } from '@/lib/loveCapsule';
import { AppIcon } from '@/components/ui/AppIcon';

export interface CapsulePreviewPhoto {
  id: string;
  url: string | null;
}

export interface CapsulePreviewData {
  senderName: string;
  recipientName: string;
  title: string;
  message: string;
  teaser: string;
  unlockAt: string;
  theme: LoveCapsuleTheme;
  isAnniversary: boolean;
  photos: CapsulePreviewPhoto[];
}

interface CapsuleRecipientPreviewProps {
  data: CapsulePreviewData | null;
  onClose: () => void;
}

const themeClass: Record<LoveCapsuleTheme, string> = {
  rose: 'from-rose-400 via-pink-400 to-fuchsia-500',
  lavender: 'from-violet-400 via-purple-400 to-indigo-500',
  sky: 'from-sky-400 via-blue-400 to-indigo-500',
  sunset: 'from-orange-400 via-rose-400 to-pink-500'
};

export function CapsuleRecipientPreview({ data, onClose }: CapsuleRecipientPreviewProps) {
  const [revealed, setRevealed] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setRevealed(false);
    setViewerIndex(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (viewerIndex !== null) setViewerIndex(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [data, viewerIndex, onClose]);

  if (!data) return null;

  const activeIndex = viewerIndex;
  const activePhoto = activeIndex === null ? null : data.photos[activeIndex];
  if (activePhoto && activeIndex !== null) {
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/95 p-4" role="dialog" aria-modal="true" aria-label="Preview foto Love Capsule">
        <button type="button" onClick={() => setViewerIndex(null)} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Tutup foto"><AppIcon name="x" /></button>
        {data.photos.length > 1 ? <button type="button" onClick={() => setViewerIndex((activeIndex - 1 + data.photos.length) % data.photos.length)} className="absolute left-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Foto sebelumnya"><AppIcon name="chevron-left" size={28} /></button> : null}
        {activePhoto.url ? <img src={activePhoto.url} alt={`Preview foto ${activeIndex + 1}`} className="max-h-[82dvh] max-w-full rounded-3xl object-contain shadow-2xl" /> : null}
        {data.photos.length > 1 ? <button type="button" onClick={() => setViewerIndex((activeIndex + 1) % data.photos.length)} className="absolute right-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Foto berikutnya"><AppIcon name="chevron-right" size={28} /></button> : null}
      </div>
    );
  }

  if (!revealed) {
    return (
      <div className="capsule-backdrop fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="capsule-preview-sealed-title">
        <div className={`capsule-shake relative w-full max-w-md overflow-hidden rounded-[2.25rem] bg-gradient-to-br ${themeClass[data.theme]} p-[1px] shadow-2xl`}>
          <div className="rounded-[calc(2.25rem-1px)] bg-white p-6 text-center md:p-8">
            <span className="mb-5 inline-flex rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-amber-700">Mode preview pengirim</span>
            <div className={`capsule-gift mx-auto flex h-28 w-28 items-center justify-center rounded-[2rem] bg-gradient-to-br ${themeClass[data.theme]} text-white shadow-xl`}>
              <AppIcon name="gift" size={58} />
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-rose-500">Waktunya sudah tiba</p>
            <h2 id="capsule-preview-sealed-title" className="mt-2 text-2xl font-bold text-slate-900">Ada sesuatu dari {data.senderName} untuk {data.recipientName} ❤️</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{data.teaser || 'Sebuah pesan kecil sudah menunggu untuk dibuka.'}</p>
            <p className="mt-3 text-xs font-semibold text-slate-400">Dijadwalkan {formatCapsuleDateTime(data.unlockAt)} WIB</p>
            <button type="button" onClick={() => setRevealed(true)} className="fab-love mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4267d6] px-5 py-3.5 text-sm font-bold text-white hover:bg-[#3557bf] focus:outline-none focus:ring-4 focus:ring-blue-100">
              <AppIcon name="sparkles" /> Simulasikan buka kapsul
            </button>
            <button type="button" onClick={onClose} className="mt-3 text-sm font-semibold text-slate-400 hover:text-slate-600">Kembali mengedit</button>
            <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold leading-5 text-slate-500">Preview tidak mengubah waktu buka, status, atau menandai kapsul sebagai sudah dibuka.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="capsule-backdrop fixed inset-0 z-[140] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="capsule-preview-title">
      <div className="capsule-reveal relative my-auto w-full max-w-2xl overflow-hidden rounded-[2.25rem] bg-white shadow-2xl">
        <div className={`relative bg-gradient-to-br ${themeClass[data.theme]} px-6 py-10 text-center text-white`}>
          <div className="capsule-confetti" aria-hidden="true">♥ ✦ ♥ ✦ ♥</div>
          <span className="absolute left-4 top-4 inline-flex rounded-full bg-slate-950/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] backdrop-blur">Preview penerima</span>
          <button type="button" onClick={onClose} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25" aria-label="Tutup preview"><AppIcon name="x" /></button>
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur"><AppIcon name="gift" size={42} /></span>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-white/75">Love Capsule dari {data.senderName}</p>
          <h2 id="capsule-preview-title" className="mt-3 text-3xl font-bold md:text-4xl">{data.title}</h2>
          {data.isAnniversary ? <p className="mt-3 inline-flex rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">Untuk anniversary kita, 25 September ❤️</p> : null}
        </div>
        <div className="p-6 md:p-8">
          <p className="whitespace-pre-wrap text-base font-medium leading-8 text-slate-700">{data.message}</p>
          {data.photos.length > 0 ? (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.photos.map((photo, index) => (
                <button key={photo.id} type="button" onClick={() => setViewerIndex(index)} className="group aspect-square overflow-hidden rounded-2xl bg-slate-100 focus:outline-none focus:ring-4 focus:ring-rose-100">
                  {photo.url ? <img src={photo.url} alt={`Preview kenangan ${index + 1}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <span className="flex h-full items-center justify-center text-slate-300"><AppIcon name="image" size={30} /></span>}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-6 text-center text-xs font-semibold text-slate-400">Beginilah tampilan yang akan dilihat {data.recipientName} setelah kapsul terbuka.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setRevealed(false)} className="rounded-2xl bg-slate-100 px-5 py-3.5 text-sm font-bold text-slate-600 hover:bg-slate-200">Ulangi pembukaan</button>
            <button type="button" onClick={onClose} className="rounded-2xl bg-[#4267d6] px-5 py-3.5 text-sm font-bold text-white hover:bg-[#3557bf]">Selesai preview</button>
          </div>
        </div>
      </div>
    </div>
  );
}
