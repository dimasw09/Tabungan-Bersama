'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { LoveCapsule, LoveCapsulePhoto } from '@/lib/types';
import { AppIcon } from '@/components/ui/AppIcon';
import { formatCapsuleDateTime } from '@/lib/loveCapsule';

interface DueCapsule extends LoveCapsule {
  sender_name: string;
}

interface RevealCapsule extends DueCapsule {
  title: string;
  message: string;
  photos: Array<LoveCapsulePhoto & { signed_url: string | null }>;
}

const themeClass = {
  rose: 'from-rose-400 via-pink-400 to-fuchsia-500',
  lavender: 'from-violet-400 via-purple-400 to-indigo-500',
  sky: 'from-sky-400 via-blue-400 to-indigo-500',
  sunset: 'from-orange-400 via-rose-400 to-pink-500'
} as const;

function vibrationAllowed() {
  return typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function vibrate(pattern: number | number[]) {
  if (vibrationAllowed() && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
}

export function CapsuleDueOverlay() {
  const [due, setDue] = useState<DueCapsule | null>(null);
  const [reveal, setReveal] = useState<RevealCapsule | null>(null);
  const [opening, setOpening] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const fetchDue = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('love_capsules')
      .select('*')
      .eq('recipient_user_id', userId)
      .is('opened_at', null)
      .order('unlock_at', { ascending: true })
      .limit(20);

    if (error) return;
    const capsules = (data || []) as LoveCapsule[];
    const now = Date.now();
    const nextDue = capsules.find((capsule) => {
      const snoozeKey = `love-capsules:snoozed:${capsule.id}`;
      const snoozedUntil = Number(window.sessionStorage.getItem(snoozeKey) || 0);
      if (snoozedUntil > now) return false;
      if (snoozedUntil > 0) window.sessionStorage.removeItem(snoozeKey);
      return new Date(capsule.unlock_at).getTime() <= now;
    });

    if (nextDue) {
      const { data: sender } = await supabase
        .from('household_members')
        .select('display_name')
        .eq('user_id', nextDue.sender_user_id)
        .maybeSingle();
      setDue({ ...nextDue, sender_name: sender?.display_name || 'Pasanganmu' });
      window.setTimeout(() => vibrate([180, 90, 180, 90, 320]), 250);
      return;
    }

    setDue(null);
    const futureTimes = capsules
      .map((capsule) => new Date(capsule.unlock_at).getTime())
      .filter((time) => Number.isFinite(time) && time > now);
    const nearestFuture = futureTimes.length > 0 ? Math.min(...futureTimes) : null;
    const snoozeTimes = capsules
      .map((capsule) => Number(window.sessionStorage.getItem(`love-capsules:snoozed:${capsule.id}`) || 0))
      .filter((time) => time > now);
    const nearestSnooze = snoozeTimes.length > 0 ? Math.min(...snoozeTimes) : null;
    const wakeAt = [nearestFuture, nearestSnooze].filter((value): value is number => value !== null).sort((a, b) => a - b)[0];
    if (wakeAt) {
      const delay = Math.min(Math.max(wakeAt - now + 250, 500), 60 * 60 * 1000);
      timerRef.current = window.setTimeout(() => fetchDue(), delay);
    }
  }, []);

  useEffect(() => {
    fetchDue();
    const onVisible = () => { if (document.visibilityState === 'visible') fetchDue(); };
    const onFocus = () => fetchDue();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    const channel = supabase.channel('love-capsules-due-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'love_capsules' }, () => fetchDue())
      .subscribe();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [fetchDue]);

  async function openCapsule() {
    if (!due || opening) return;
    setOpening(true);
    try {
      const { data, error } = await supabase.rpc('open_love_capsule', { p_capsule_id: due.id });
      if (error) throw error;
      const opened = Array.isArray(data) ? data[0] : data;
      if (!opened) throw new Error('Isi kapsul belum dapat dibuka.');

      const { data: photoRows } = await supabase
        .from('love_capsule_photos')
        .select('*')
        .eq('capsule_id', due.id)
        .order('sort_order', { ascending: true });

      const photos = await Promise.all(((photoRows || []) as LoveCapsulePhoto[]).map(async (photo) => {
        const { data: signed } = await supabase.storage.from('love-capsules').createSignedUrl(photo.storage_path, 60 * 60);
        return { ...photo, signed_url: signed?.signedUrl || null };
      }));

      setReveal({ ...due, title: String(opened.title || ''), message: String(opened.message || ''), photos });
      setDue(null);
      vibrate([80, 40, 80, 40, 160]);
    } catch (error) {
      console.error('Gagal membuka Love Capsule:', error);
    } finally {
      setOpening(false);
    }
  }

  function snooze() {
    if (!due) return;
    window.sessionStorage.setItem(`love-capsules:snoozed:${due.id}`, String(Date.now() + 15 * 60 * 1000));
    setDue(null);
    window.setTimeout(() => fetchDue(), 100);
  }

  function closeReveal() {
    setReveal(null);
    setViewerIndex(null);
    window.setTimeout(() => fetchDue(), 250);
  }

  if (!due && !reveal) return null;

  if (reveal) {
    const activePhoto = viewerIndex === null ? null : reveal.photos[viewerIndex];
    if (activePhoto) {
      return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/95 p-4" role="dialog" aria-modal="true" aria-label="Foto Love Capsule">
          <button type="button" onClick={() => setViewerIndex(null)} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Tutup foto"><AppIcon name="x" /></button>
          {reveal.photos.length > 1 ? <button type="button" onClick={() => setViewerIndex((viewerIndex! - 1 + reveal.photos.length) % reveal.photos.length)} className="absolute left-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Foto sebelumnya"><AppIcon name="chevron-left" size={28} /></button> : null}
          {activePhoto.signed_url ? <img src={activePhoto.signed_url} alt={`Foto ${viewerIndex! + 1} dari Love Capsule`} className="max-h-[82dvh] max-w-full rounded-3xl object-contain shadow-2xl" /> : null}
          {reveal.photos.length > 1 ? <button type="button" onClick={() => setViewerIndex((viewerIndex! + 1) % reveal.photos.length)} className="absolute right-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Foto berikutnya"><AppIcon name="chevron-right" size={28} /></button> : null}
        </div>
      );
    }

    return (
      <div className="capsule-backdrop fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="capsule-reveal-title">
        <div className="capsule-reveal relative my-auto w-full max-w-2xl overflow-hidden rounded-[2.25rem] bg-white shadow-2xl">
          <div className={`relative bg-gradient-to-br ${themeClass[reveal.theme]} px-6 py-10 text-center text-white`}>
            <div className="capsule-confetti" aria-hidden="true">♥ ✦ ♥ ✦ ♥</div>
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur"><AppIcon name="gift" size={42} /></span>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-white/75">Love Capsule dari {reveal.sender_name}</p>
            <h2 id="capsule-reveal-title" className="mt-3 text-3xl font-bold md:text-4xl">{reveal.title}</h2>
            {reveal.is_anniversary ? <p className="mt-3 inline-flex rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">Untuk anniversary kita, 25 September ❤️</p> : null}
          </div>
          <div className="p-6 md:p-8">
            <p className="whitespace-pre-wrap text-base font-medium leading-8 text-slate-700">{reveal.message}</p>
            {reveal.photos.length > 0 ? (
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {reveal.photos.map((photo, index) => (
                  <button key={photo.id} type="button" onClick={() => setViewerIndex(index)} className="group aspect-square overflow-hidden rounded-2xl bg-slate-100 focus:outline-none focus:ring-4 focus:ring-rose-100">
                    {photo.signed_url ? <img src={photo.signed_url} alt={`Kenangan ${index + 1}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <span className="flex h-full items-center justify-center text-slate-300"><AppIcon name="image" size={30} /></span>}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-6 text-center text-xs font-semibold text-slate-400">Kapsul ini dibuka {formatCapsuleDateTime(new Date())} WIB</p>
            <button type="button" onClick={closeReveal} className="button-pop mt-5 w-full rounded-2xl bg-[#4267d6] px-5 py-3.5 text-sm font-bold text-white hover:bg-[#3557bf] focus:outline-none focus:ring-4 focus:ring-blue-100">Simpan di kotak kenangan</button>
          </div>
        </div>
      </div>
    );
  }

  if (!due) return null;

  return (
    <div className="capsule-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="capsule-due-title">
      <div className={`capsule-shake relative w-full max-w-md overflow-hidden rounded-[2.25rem] bg-gradient-to-br ${themeClass[due.theme]} p-[1px] shadow-2xl`}>
        <div className="rounded-[calc(2.25rem-1px)] bg-white p-6 text-center md:p-8">
          <div className={`capsule-gift mx-auto flex h-28 w-28 items-center justify-center rounded-[2rem] bg-gradient-to-br ${themeClass[due.theme]} text-white shadow-xl`}>
            <AppIcon name="gift" size={58} />
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-rose-500">Waktunya sudah tiba</p>
          <h2 id="capsule-due-title" className="mt-2 text-2xl font-bold text-slate-900">Ada sesuatu dari {due.sender_name} untukmu ❤️</h2>
          <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{due.teaser || 'Sebuah pesan kecil sudah menunggu untuk dibuka.'}</p>
          <p className="mt-3 text-xs font-semibold text-slate-400">Dijadwalkan {formatCapsuleDateTime(due.unlock_at)} WIB</p>
          <button type="button" onClick={openCapsule} disabled={opening} className="fab-love mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4267d6] px-5 py-3.5 text-sm font-bold text-white hover:bg-[#3557bf] disabled:opacity-60">
            <AppIcon name="sparkles" /> {opening ? 'Membuka kapsul...' : 'Buka Love Capsule'}
          </button>
          <button type="button" onClick={snooze} disabled={opening} className="mt-3 text-sm font-semibold text-slate-400 hover:text-slate-600">Nanti dulu</button>
        </div>
      </div>
    </div>
  );
}
