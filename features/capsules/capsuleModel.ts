import type { LoveCapsule, LoveCapsuleContent, LoveCapsulePhoto, LoveCapsuleTheme } from '@/lib/types';
import { isoToJakartaInputs } from '@/lib/loveCapsule';

export const MAX_CAPSULE_PHOTOS = 10;

export interface CapsulePhotoView extends LoveCapsulePhoto {
  signed_url: string | null;
  thumbnail_url: string | null;
}

export interface PendingCapsulePhoto {
  key: string;
  file: File;
  previewUrl: string;
}

export interface CapsuleReveal {
  capsule: LoveCapsule;
  content: LoveCapsuleContent;
  senderName: string;
  photos: CapsulePhotoView[];
}

export interface CapsuleForm {
  recipient_user_id: string;
  title: string;
  message: string;
  teaser: string;
  unlock_date: string;
  unlock_time: string;
  theme: LoveCapsuleTheme;
  is_anniversary: boolean;
}

export const themeMeta: Record<LoveCapsuleTheme, { label: string; card: string; soft: string; dot: string }> = {
  rose: { label: 'Rose', card: 'from-rose-400 via-pink-400 to-fuchsia-500', soft: 'bg-rose-50 text-rose-700', dot: 'bg-rose-400' },
  lavender: { label: 'Lavender', card: 'from-violet-400 via-purple-400 to-indigo-500', soft: 'bg-violet-50 text-violet-700', dot: 'bg-violet-400' },
  sky: { label: 'Langit', card: 'from-sky-400 via-blue-400 to-indigo-500', soft: 'bg-sky-50 text-sky-700', dot: 'bg-sky-400' },
  sunset: { label: 'Senja', card: 'from-orange-400 via-rose-400 to-pink-500', soft: 'bg-orange-50 text-orange-700', dot: 'bg-orange-400' }
};

export function emptyCapsuleForm(recipientId = ''): CapsuleForm {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const input = isoToJakartaInputs(tomorrow.toISOString());
  return {
    recipient_user_id: recipientId,
    title: '',
    message: '',
    teaser: '',
    unlock_date: input.date,
    unlock_time: '08:00',
    theme: 'rose',
    is_anniversary: false
  };
}

export function capsuleStatusLabel(capsule: LoveCapsule, currentUserId: string) {
  const isSender = capsule.sender_user_id === currentUserId;
  const isDue = new Date(capsule.unlock_at).getTime() <= Date.now();
  if (capsule.opened_at) return 'Sudah dibuka';
  if (isDue) return isSender ? 'Menunggu pasangan membuka' : 'Siap dibuka';
  return isSender ? 'Sedang menunggu waktunya' : 'Masih terkunci';
}
