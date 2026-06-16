'use client';

import { AppIcon } from '@/components/ui/AppIcon';
import { LazyStorageImage } from '@/components/ui/LazyStorageImage';
import type { StoryPhoto } from '@/lib/types';

export type StoryPhotoView = StoryPhoto & {
  signed_url: string | null;
  thumbnail_url: string | null;
};

export type PhotoViewerState = {
  photos: StoryPhotoView[];
  index: number;
  title: string;
};

function collageCellClass(count: number, index: number) {
  if (count === 1) return 'col-span-2 row-span-2';
  if (count === 2) return 'row-span-2';
  if (count === 3 && index === 0) return 'row-span-2';
  return '';
}

export function StoryAlbumCollage({ photos, title, onOpen }: { photos: StoryPhotoView[]; title: string; onOpen: (index: number) => void }) {
  if (photos.length === 0) {
    return (
      <div className="flex h-44 flex-col items-center justify-center rounded-[24px] bg-gradient-to-br from-rose-50 via-blue-50 to-indigo-100 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/80 text-rose-400 shadow-sm"><AppIcon name="heart" size={23} /></span>
        <p className="mt-3 text-sm font-bold text-slate-600">Belum ada foto di cerita ini</p>
        <p className="mt-1 text-xs font-medium text-slate-400">Tambahkan kenangan saat mengedit cerita.</p>
      </div>
    );
  }

  const visible = photos.slice(0, 4);
  return (
    <div className="grid h-52 grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-[24px] bg-slate-100">
      {visible.map((photo, index) => {
        const remaining = photos.length - 4;
        const isLastVisible = index === 3 && remaining > 0;
        return (
          <button key={photo.id} type="button" onClick={() => onOpen(index)} className={`relative min-h-0 overflow-hidden bg-slate-100 focus:outline-none focus:ring-4 focus:ring-inset focus:ring-blue-200 ${collageCellClass(visible.length, index)}`} aria-label={`Buka foto ${index + 1} dari cerita ${title}`}>
            <LazyStorageImage bucket="story-albums" path={photo.thumbnail_path || photo.storage_path} alt={`Kenangan ${index + 1}: ${title}`} className="h-full w-full object-cover transition duration-300 hover:scale-105" />
            {isLastVisible ? <span className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-xl font-bold text-white">+{remaining}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

