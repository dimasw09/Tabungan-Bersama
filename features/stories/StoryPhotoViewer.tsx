'use client';

import { useEffect } from 'react';
import { AppIcon } from '@/components/ui/AppIcon';
import { LazyStorageImage } from '@/components/ui/LazyStorageImage';
import type { PhotoViewerState } from './StoryAlbum';

export function StoryPhotoViewer({ viewer, onClose, onChange }: { viewer: PhotoViewerState | null; onClose: () => void; onChange: (index: number) => void }) {
  useEffect(() => {
    if (!viewer) return;
    const currentViewer = viewer;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onChange((currentViewer.index - 1 + currentViewer.photos.length) % currentViewer.photos.length);
      if (event.key === 'ArrowRight') onChange((currentViewer.index + 1) % currentViewer.photos.length);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [viewer, onClose, onChange]);

  if (!viewer) return null;
  const photo = viewer.photos[viewer.index];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-3 mobile-light-backdrop" role="dialog" aria-modal="true" aria-label={`Album ${viewer.title}`}>
      <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 focus:outline-none focus:ring-4 focus:ring-white/20" aria-label="Tutup album"><AppIcon name="x" size={22} /></button>
      {viewer.photos.length > 1 ? <button type="button" onClick={() => onChange((viewer.index - 1 + viewer.photos.length) % viewer.photos.length)} className="absolute left-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 focus:outline-none focus:ring-4 focus:ring-white/20 sm:left-6" aria-label="Foto sebelumnya"><AppIcon name="chevron-left" size={27} /></button> : null}
      <div className="flex max-h-[92dvh] w-full max-w-5xl flex-col items-center justify-center">
        {photo ? <div className="h-[72dvh] w-full max-w-5xl"><LazyStorageImage bucket="story-albums" path={photo.storage_path} eager alt={`${viewer.title}, foto ${viewer.index + 1}`} className="h-full w-full object-contain" fallbackClassName="rounded-2xl bg-white/10" /></div> : null}
        <div className="mt-4 rounded-full bg-white/10 px-4 py-2 text-center text-sm font-semibold text-white">{viewer.title} · {viewer.index + 1}/{viewer.photos.length}</div>
      </div>
      {viewer.photos.length > 1 ? <button type="button" onClick={() => onChange((viewer.index + 1) % viewer.photos.length)} className="absolute right-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 focus:outline-none focus:ring-4 focus:ring-white/20 sm:right-6" aria-label="Foto berikutnya"><AppIcon name="chevron-right" size={27} /></button> : null}
    </div>
  );
}
