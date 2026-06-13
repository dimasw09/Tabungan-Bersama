'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { HouseholdMember, LoveCapsule, LoveCapsuleContent, LoveCapsulePhoto, LoveCapsuleTheme } from '@/lib/types';
import { formatCapsuleDateTime, isoToJakartaInputs, jakartaDateTimeToIso, nextAnniversaryInputs } from '@/lib/loveCapsule';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AppIcon } from '@/components/ui/AppIcon';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { useToast } from '@/components/ui/ToastProvider';
import { CapsuleRecipientPreview, type CapsulePreviewData } from '@/components/capsules/CapsuleRecipientPreview';

const MAX_PHOTOS = 10;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

interface CapsulePhotoView extends LoveCapsulePhoto { signed_url: string | null; }
interface PendingPhoto { key: string; file: File; previewUrl: string; }
interface CapsuleReveal { capsule: LoveCapsule; content: LoveCapsuleContent; senderName: string; photos: CapsulePhotoView[]; }

interface CapsuleForm {
  recipient_user_id: string;
  title: string;
  message: string;
  teaser: string;
  unlock_date: string;
  unlock_time: string;
  theme: LoveCapsuleTheme;
  is_anniversary: boolean;
}

const themeMeta: Record<LoveCapsuleTheme, { label: string; card: string; soft: string; dot: string }> = {
  rose: { label: 'Rose', card: 'from-rose-400 via-pink-400 to-fuchsia-500', soft: 'bg-rose-50 text-rose-700', dot: 'bg-rose-400' },
  lavender: { label: 'Lavender', card: 'from-violet-400 via-purple-400 to-indigo-500', soft: 'bg-violet-50 text-violet-700', dot: 'bg-violet-400' },
  sky: { label: 'Langit', card: 'from-sky-400 via-blue-400 to-indigo-500', soft: 'bg-sky-50 text-sky-700', dot: 'bg-sky-400' },
  sunset: { label: 'Senja', card: 'from-orange-400 via-rose-400 to-pink-500', soft: 'bg-orange-50 text-orange-700', dot: 'bg-orange-400' }
};

function tomorrowInputs() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const input = isoToJakartaInputs(date.toISOString());
  return { ...input, time: '08:00' };
}

function emptyForm(recipientId = ''): CapsuleForm {
  const tomorrow = tomorrowInputs();
  return {
    recipient_user_id: recipientId,
    title: '',
    message: '',
    teaser: '',
    unlock_date: tomorrow.date,
    unlock_time: tomorrow.time,
    theme: 'rose',
    is_anniversary: false
  };
}

function photoExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/heic') return 'heic';
  if (file.type === 'image/heif') return 'heif';
  return 'jpg';
}

function statusLabel(capsule: LoveCapsule, currentUserId: string) {
  const isSender = capsule.sender_user_id === currentUserId;
  const isDue = new Date(capsule.unlock_at).getTime() <= Date.now();
  if (capsule.opened_at) return 'Sudah dibuka';
  if (isDue) return isSender ? 'Menunggu pasangan membuka' : 'Siap dibuka';
  return isSender ? 'Sedang menunggu waktunya' : 'Masih terkunci';
}

export default function CapsulesPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [capsules, setCapsules] = useState<LoveCapsule[]>([]);
  const [contents, setContents] = useState<LoveCapsuleContent[]>([]);
  const [photos, setPhotos] = useState<CapsulePhotoView[]>([]);
  const [featureReady, setFeatureReady] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LoveCapsule | null>(null);
  const [form, setForm] = useState<CapsuleForm>(emptyForm());
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<LoveCapsule | null>(null);
  const [reveal, setReveal] = useState<CapsuleReveal | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<CapsulePreviewData | null>(null);
  const [tab, setTab] = useState<'all' | 'waiting' | 'opened'>('all');

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userError || !userId) {
      if (showLoading) setLoading(false);
      toast({ title: 'Sesi tidak ditemukan', message: userError?.message || 'Silakan login ulang.', type: 'error' });
      return;
    }

    const membershipResult = await supabase
      .from('household_members')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipResult.error || !membershipResult.data) {
      if (showLoading) setLoading(false);
      toast({ title: 'Household tidak ditemukan', message: membershipResult.error?.message || 'Akun belum terhubung.', type: 'error' });
      return;
    }

    const hhId = String(membershipResult.data.household_id);
    const [membersResult, capsulesResult, contentsResult, photosResult] = await Promise.all([
      supabase.from('household_members').select('*').eq('household_id', hhId).order('display_name'),
      supabase.from('love_capsules').select('*').order('unlock_at', { ascending: false }),
      supabase.from('love_capsule_contents').select('*'),
      supabase.from('love_capsule_photos').select('*').order('sort_order', { ascending: true })
    ]);

    if (showLoading) setLoading(false);
    if (capsulesResult.error) {
      setFeatureReady(false);
      setCurrentUserId(userId);
      setHouseholdId(hhId);
      setMembers((membersResult.data || []) as HouseholdMember[]);
      return;
    }

    if (membersResult.error || contentsResult.error || photosResult.error) {
      toast({ title: 'Gagal memuat Love Capsule', message: membersResult.error?.message || contentsResult.error?.message || photosResult.error?.message, type: 'error' });
      return;
    }

    const rawPhotos = (photosResult.data || []) as LoveCapsulePhoto[];
    const signedPhotos = await Promise.all(rawPhotos.map(async (photo) => {
      const { data } = await supabase.storage.from('love-capsules').createSignedUrl(photo.storage_path, 60 * 60);
      return { ...photo, signed_url: data?.signedUrl || null };
    }));

    setFeatureReady(true);
    setCurrentUserId(userId);
    setHouseholdId(hhId);
    setMembers((membersResult.data || []) as HouseholdMember[]);
    setCapsules((capsulesResult.data || []) as LoveCapsule[]);
    setContents((contentsResult.data || []) as LoveCapsuleContent[]);
    setPhotos(signedPhotos);
  }

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('love-capsules-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'love_capsules' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'love_capsule_contents' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'love_capsule_photos' }, () => fetchData(false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const otherMember = members.find((member) => member.user_id !== currentUserId);
  const currentMember = members.find((member) => member.user_id === currentUserId);
  const memberNameMap = useMemo(() => new Map(members.map((member) => [member.user_id, member.display_name])), [members]);
  const contentMap = useMemo(() => new Map(contents.map((content) => [content.capsule_id, content])), [contents]);
  const photosByCapsule = useMemo(() => {
    const map = new Map<string, CapsulePhotoView[]>();
    photos.forEach((photo) => {
      const rows = map.get(photo.capsule_id) || [];
      rows.push(photo);
      map.set(photo.capsule_id, rows);
    });
    map.forEach((rows) => rows.sort((a, b) => a.sort_order - b.sort_order));
    return map;
  }, [photos]);

  const visibleCapsules = useMemo(() => capsules.filter((capsule) => {
    if (tab === 'opened') return Boolean(capsule.opened_at);
    if (tab === 'waiting') return !capsule.opened_at;
    return true;
  }), [capsules, tab]);

  const existingEditingPhotos = editing ? (photosByCapsule.get(editing.id) || []) : [];
  const visibleExistingPhotos = existingEditingPhotos.filter((photo) => !removedPhotoIds.includes(photo.id));
  const totalFormPhotos = visibleExistingPhotos.length + pendingPhotos.length;

  function clearPendingPhotos() {
    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPendingPhotos([]);
  }

  function openCreate(isAnniversary = false) {
    clearPendingPhotos();
    setRemovedPhotoIds([]);
    setEditing(null);
    const next = emptyForm(otherMember?.user_id || '');
    if (isAnniversary) {
      const anniversary = nextAnniversaryInputs();
      next.unlock_date = anniversary.date;
      next.unlock_time = anniversary.time;
      next.is_anniversary = true;
      next.teaser = 'Sesuatu untuk hari spesial kita sudah menunggu ❤️';
      next.theme = 'rose';
    }
    setForm(next);
    setFormOpen(true);
  }

  function startEdit(capsule: LoveCapsule) {
    const content = contentMap.get(capsule.id);
    if (!content) {
      toast({ title: 'Isi kapsul belum tersedia', message: 'Coba muat ulang halaman.', type: 'error' });
      return;
    }
    const input = isoToJakartaInputs(capsule.unlock_at);
    clearPendingPhotos();
    setRemovedPhotoIds([]);
    setEditing(capsule);
    setForm({
      recipient_user_id: capsule.recipient_user_id,
      title: content.title,
      message: content.message,
      teaser: capsule.teaser || '',
      unlock_date: input.date,
      unlock_time: input.time,
      theme: capsule.theme,
      is_anniversary: capsule.is_anniversary
    });
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    clearPendingPhotos();
    setRemovedPhotoIds([]);
    setEditing(null);
    setFormOpen(false);
  }

  function useAnniversaryDate() {
    const anniversary = nextAnniversaryInputs();
    setForm((current) => ({ ...current, unlock_date: anniversary.date, unlock_time: anniversary.time, is_anniversary: true }));
  }

  function validatePhoto(file: File) {
    if (!ALLOWED_TYPES.has(file.type)) throw new Error(`${file.name} bukan format foto yang didukung.`);
    if (file.size <= 0) throw new Error(`${file.name} kosong atau rusak.`);
    if (file.size > MAX_PHOTO_SIZE) throw new Error(`${file.name} lebih besar dari 5MB.`);
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    const slots = Math.max(MAX_PHOTOS - totalFormPhotos, 0);
    if (slots === 0) {
      toast({ title: 'Kapsul sudah penuh', message: 'Maksimal 10 foto per kapsul.', type: 'info' });
      return;
    }
    const next: PendingPhoto[] = [];
    for (const file of selected.slice(0, slots)) {
      try {
        validatePhoto(file);
        next.push({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
      } catch (error) {
        toast({ title: 'Foto tidak dapat dipakai', message: error instanceof Error ? error.message : 'File tidak valid.', type: 'error' });
      }
    }
    if (selected.length > slots) toast({ title: 'Sebagian foto tidak ditambahkan', message: `Tersisa ${slots} slot dari maksimal 10 foto.`, type: 'info' });
    setPendingPhotos((current) => [...current, ...next]);
  }

  function removePending(key: string) {
    setPendingPhotos((current) => {
      const target = current.find((photo) => photo.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.key !== key);
    });
  }

  async function uploadPending(capsuleId: string) {
    const uploaded: string[] = [];
    try {
      for (const photo of pendingPhotos) {
        validatePhoto(photo.file);
        const path = `${householdId}/${capsuleId}/${crypto.randomUUID()}.${photoExtension(photo.file)}`;
        const { error } = await supabase.storage.from('love-capsules').upload(path, photo.file, {
          cacheControl: '3600', contentType: photo.file.type || undefined, upsert: false
        });
        if (error) throw error;
        uploaded.push(path);
      }
      return uploaded;
    } catch (error) {
      if (uploaded.length > 0) await supabase.storage.from('love-capsules').remove(uploaded);
      throw error;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.title.trim();
    const message = form.message.trim();
    const teaser = form.teaser.trim();
    const unlockIso = jakartaDateTimeToIso(form.unlock_date, form.unlock_time);

    if (!form.recipient_user_id || form.recipient_user_id === currentUserId) {
      toast({ title: 'Penerima belum valid', message: 'Love Capsule harus ditujukan kepada pasangan.', type: 'error' }); return;
    }
    if (!title || title.length > 80) {
      toast({ title: 'Judul belum valid', message: 'Judul wajib diisi dan maksimal 80 karakter.', type: 'error' }); return;
    }
    if (!message || message.length > 3000) {
      toast({ title: 'Pesan belum valid', message: 'Pesan wajib diisi dan maksimal 3.000 karakter.', type: 'error' }); return;
    }
    if (teaser.length > 100) {
      toast({ title: 'Teaser terlalu panjang', message: 'Maksimal 100 karakter.', type: 'error' }); return;
    }
    if (!unlockIso || new Date(unlockIso).getTime() <= Date.now() + 30_000) {
      toast({ title: 'Waktu buka belum valid', message: 'Pilih tanggal dan jam di masa depan.', type: 'error' }); return;
    }
    if (totalFormPhotos > MAX_PHOTOS) {
      toast({ title: 'Terlalu banyak foto', message: 'Satu Love Capsule maksimal 10 foto.', type: 'error' }); return;
    }

    setSaving(true);
    const capsuleId = editing?.id || crypto.randomUUID();
    const isNew = !editing;
    let uploadedPaths: string[] = [];
    let synced = false;

    try {
      const { error: saveError } = await supabase.rpc('save_love_capsule', {
        p_id: capsuleId,
        p_recipient_user_id: form.recipient_user_id,
        p_unlock_at: unlockIso,
        p_teaser: teaser || null,
        p_theme: form.theme,
        p_is_anniversary: form.is_anniversary,
        p_title: title,
        p_message: message
      });
      if (saveError) throw saveError;

      uploadedPaths = await uploadPending(capsuleId);
      if (uploadedPaths.length > 0 || removedPhotoIds.length > 0) {
        const { error: syncError } = await supabase.rpc('sync_love_capsule_photos', {
          p_capsule_id: capsuleId,
          p_delete_ids: removedPhotoIds,
          p_new_paths: uploadedPaths
        });
        if (syncError) throw syncError;
        synced = true;

        const oldPaths = existingEditingPhotos.filter((photo) => removedPhotoIds.includes(photo.id)).map((photo) => photo.storage_path);
        if (oldPaths.length > 0) {
          const { error: removeError } = await supabase.storage.from('love-capsules').remove(oldPaths);
          if (removeError) toast({ title: 'Kapsul tersimpan', message: 'Beberapa file lama belum berhasil dibersihkan.', type: 'info' });
        }
      }

      toast({ title: isNew ? 'Love Capsule berhasil dikunci' : 'Love Capsule berhasil diperbarui', message: `Akan terbuka ${formatCapsuleDateTime(unlockIso)} WIB.`, type: 'success' });
      closeForm();
      await fetchData(false);
    } catch (error) {
      if (uploadedPaths.length > 0 && !synced) await supabase.storage.from('love-capsules').remove(uploadedPaths);
      if (isNew) await supabase.from('love_capsules').delete().eq('id', capsuleId);
      toast({ title: 'Gagal menyimpan Love Capsule', message: error instanceof Error ? error.message : 'Terjadi error tidak diketahui.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function previewDraft() {
    const title = form.title.trim();
    const message = form.message.trim();
    const unlockAt = jakartaDateTimeToIso(form.unlock_date, form.unlock_time);
    const recipientName = memberNameMap.get(form.recipient_user_id);
    if (!recipientName) {
      toast({ title: 'Penerima belum dipilih', message: 'Pilih pasangan dulu supaya preview sesuai.', type: 'error' });
      return;
    }
    if (!title || !message) {
      toast({ title: 'Isi kapsul belum lengkap', message: 'Judul dan pesan perlu diisi sebelum melihat preview.', type: 'error' });
      return;
    }
    if (!unlockAt) {
      toast({ title: 'Waktu buka belum valid', message: 'Isi tanggal dan jam buka terlebih dahulu.', type: 'error' });
      return;
    }
    setPreview({
      senderName: currentMember?.display_name || 'Pasanganmu',
      recipientName,
      title,
      message,
      teaser: form.teaser.trim(),
      unlockAt,
      theme: form.theme,
      isAnniversary: form.is_anniversary,
      photos: [
        ...visibleExistingPhotos.map((photo) => ({ id: photo.id, url: photo.signed_url })),
        ...pendingPhotos.map((photo) => ({ id: photo.key, url: photo.previewUrl }))
      ]
    });
  }

  function previewSavedCapsule(capsule: LoveCapsule) {
    const content = contentMap.get(capsule.id);
    if (!content) {
      toast({ title: 'Preview belum tersedia', message: 'Isi kapsul belum dapat dimuat. Coba refresh halaman.', type: 'error' });
      return;
    }
    setPreview({
      senderName: memberNameMap.get(capsule.sender_user_id) || 'Pasanganmu',
      recipientName: memberNameMap.get(capsule.recipient_user_id) || 'Pasanganmu',
      title: content.title,
      message: content.message,
      teaser: capsule.teaser || '',
      unlockAt: capsule.unlock_at,
      theme: capsule.theme,
      isAnniversary: capsule.is_anniversary,
      photos: (photosByCapsule.get(capsule.id) || []).map((photo) => ({ id: photo.id, url: photo.signed_url }))
    });
  }

  async function deleteCapsule() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const paths = (photosByCapsule.get(deleteTarget.id) || []).map((photo) => photo.storage_path);
      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage.from('love-capsules').remove(paths);
        if (storageError) throw storageError;
      }
      const { error } = await supabase.from('love_capsules').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Kapsul dibatalkan', message: 'Love Capsule belum sempat dibuka dan sudah dihapus.', type: 'success' });
      setDeleteTarget(null);
      await fetchData(false);
    } catch (error) {
      toast({ title: 'Gagal menghapus kapsul', message: error instanceof Error ? error.message : 'Terjadi error tidak diketahui.', type: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  async function showCapsule(capsule: LoveCapsule) {
    const isRecipient = capsule.recipient_user_id === currentUserId;
    const isDue = new Date(capsule.unlock_at).getTime() <= Date.now();
    if (isRecipient && !isDue) return;

    try {
      if (isRecipient && !capsule.opened_at) {
        const { error } = await supabase.rpc('open_love_capsule', { p_capsule_id: capsule.id });
        if (error) throw error;
      }
      const [{ data: contentData, error: contentError }, { data: photoData, error: photoError }] = await Promise.all([
        supabase.from('love_capsule_contents').select('*').eq('capsule_id', capsule.id).single(),
        supabase.from('love_capsule_photos').select('*').eq('capsule_id', capsule.id).order('sort_order', { ascending: true })
      ]);
      if (contentError || photoError) throw contentError || photoError;
      const signed = await Promise.all(((photoData || []) as LoveCapsulePhoto[]).map(async (photo) => {
        const { data } = await supabase.storage.from('love-capsules').createSignedUrl(photo.storage_path, 60 * 60);
        return { ...photo, signed_url: data?.signedUrl || null };
      }));
      setReveal({ capsule: { ...capsule, opened_at: capsule.opened_at || new Date().toISOString() }, content: contentData as LoveCapsuleContent, senderName: memberNameMap.get(capsule.sender_user_id) || 'Pasanganmu', photos: signed });
      if (isRecipient && !capsule.opened_at) {
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'vibrate' in navigator) navigator.vibrate([80, 40, 80, 40, 160]);
        fetchData(false);
      }
    } catch (error) {
      toast({ title: 'Kapsul belum bisa dibuka', message: error instanceof Error ? error.message : 'Coba lagi sebentar.', type: 'error' });
    }
  }

  if (loading) return <LoadingState />;

  if (!featureReady) {
    return (
      <main>
        <PageHeader title="Kapsul" description="Pesan kecil yang menunggu waktu terbaik untuk ditemukan." />
        <EmptyState title="Love Capsule belum aktif" description="Jalankan SQL Stage2_5_Love_Capsule.sql di Supabase terlebih dahulu." />
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        title="Kapsul Kita"
        description="Buat kejutan untuk tanggal apa pun. Isi baru bisa dibaca pasangan setelah waktunya tiba."
        action={<Button onClick={() => openCreate(false)}><AppIcon name="plus" className="mr-2" /> Buat kapsul</Button>}
      />

      <Card className="love-sheen relative overflow-hidden !border-0 !bg-gradient-to-br !from-rose-500 !via-pink-500 !to-violet-500 !p-6 text-white md:!p-8">
        <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-white/10" />
        <div className="relative grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Tanggal spesial utama</p>
            <h2 className="mt-2 text-3xl font-bold">25 September ❤️</h2>
            <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-white/80">Anniversary Kakak dan Mpip selalu diingat. Kapsul tetap bebas dibuat untuk tanggal dan jam apa pun.</p>
          </div>
          <Button type="button" variant="secondary" className="!border-white/40 !bg-white/15 !text-white hover:!bg-white/25" onClick={() => openCreate(true)}>
            <AppIcon name="gift" className="mr-2" /> Siapkan kapsul anniversary
          </Button>
        </div>
      </Card>

      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Filter Love Capsule">
        {([
          ['all', 'Semua'], ['waiting', 'Menunggu'], ['opened', 'Kotak kenangan']
        ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${tab === value ? 'bg-[#4267d6] text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>

      {visibleCapsules.length === 0 ? (
        <div className="mt-5"><EmptyState title={tab === 'opened' ? 'Kotak kenangan masih kosong' : 'Belum ada Love Capsule'} description="Buat pesan untuk pasangan dan pilih sendiri kapan kejutan itu boleh dibuka." /></div>
      ) : (
        <section className="stagger-grid mt-5 grid gap-4 md:grid-cols-2">
          {visibleCapsules.map((capsule) => {
            const isSender = capsule.sender_user_id === currentUserId;
            const isDue = new Date(capsule.unlock_at).getTime() <= Date.now();
            const canEdit = isSender && !isDue && !capsule.opened_at;
            const content = contentMap.get(capsule.id);
            const partnerName = memberNameMap.get(isSender ? capsule.recipient_user_id : capsule.sender_user_id) || 'Pasangan';
            const status = statusLabel(capsule, currentUserId);
            return (
              <article key={capsule.id} className="capsule-card motion-card relative rounded-[28px] border border-slate-100 bg-white shadow-sm">
                <div className={`relative rounded-t-[27px] bg-gradient-to-br ${themeMeta[capsule.theme].card} p-5 text-white`}>
                  <div className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><AppIcon name={capsule.opened_at ? 'heart' : 'gift'} /></div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">{isSender ? `Untuk ${partnerName}` : `Dari ${partnerName}`}</p>
                  <h3 className="mt-3 pr-12 text-xl font-bold">{content?.title || (capsule.is_anniversary ? 'Kapsul anniversary' : 'Sebuah kejutan untukmu')}</h3>
                  <p className="mt-2 text-sm font-medium text-white/80">{status}</p>
                </div>
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${themeMeta[capsule.theme].soft}`}><AppIcon name={capsule.opened_at || isDue ? 'sparkles' : 'lock'} size={18} /></span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Waktu buka</p>
                      <p className="mt-1 text-sm font-bold text-slate-700">{formatCapsuleDateTime(capsule.unlock_at)} WIB</p>
                    </div>
                  </div>
                  {!isSender && !isDue ? <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-medium leading-6 text-slate-500">{capsule.teaser || 'Isinya masih dirahasiakan sampai waktunya tiba.'}</p> : null}
                  {capsule.is_anniversary ? <span className="mt-4 inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600">Anniversary 25 September</span> : null}
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {isSender && !capsule.opened_at ? (
                      <Button type="button" className="w-full" onClick={() => previewSavedCapsule(capsule)}><AppIcon name="sparkles" className="mr-2" size={16} /> Preview penerima</Button>
                    ) : (!isSender && isDue) || capsule.opened_at ? (
                      <Button type="button" className="w-full" onClick={() => showCapsule(capsule)}>{!isSender && !capsule.opened_at ? 'Buka sekarang' : 'Lihat kapsul'}</Button>
                    ) : <Button type="button" className="w-full" variant="secondary" disabled><AppIcon name="lock" className="mr-2" size={16} /> Terkunci</Button>}
                    {canEdit ? (
                      <details className="action-menu">
                        <summary className="flex h-full items-center justify-center">Lainnya</summary>
                        <div className="action-menu-panel">
                          <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); previewSavedCapsule(capsule); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-violet-600 hover:bg-violet-50">Preview penerima</button>
                          <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); startEdit(capsule); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50">Edit kapsul</button>
                          <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); setDeleteTarget(capsule); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50">Batalkan kapsul</button>
                        </div>
                      </details>
                    ) : <div className="flex items-center justify-center rounded-2xl bg-slate-50 px-3 text-xs font-semibold text-slate-400">{capsule.photo_count} foto</div>}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <button type="button" onClick={() => openCreate(false)} className="fab-love mobile-fab-safe fixed right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#4267d6] text-white shadow-xl md:hidden" aria-label="Buat Love Capsule"><AppIcon name="gift" size={25} /></button>

      <Modal open={formOpen} onClose={closeForm} title={editing ? 'Edit Love Capsule' : 'Buat Love Capsule'} description="Pesan dan foto hanya bisa dibaca penerima setelah waktu buka." mobileSheet>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="form-label" htmlFor="capsule-recipient">Untuk</label>
            <select id="capsule-recipient" className="form-input mt-2" value={form.recipient_user_id} onChange={(event) => setForm((current) => ({ ...current, recipient_user_id: event.target.value }))}>
              <option value="">Pilih pasangan</option>
              {members.filter((member) => member.user_id !== currentUserId).map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="capsule-title">Judul kapsul</label>
            <input id="capsule-title" className="form-input mt-2" value={form.title} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Untuk kamu di hari yang spesial..." />
            <p className="mt-1 text-right text-xs font-medium text-slate-400">{form.title.length}/80</p>
          </div>

          <div>
            <label className="form-label" htmlFor="capsule-message">Pesan rahasia</label>
            <textarea id="capsule-message" className="form-input mt-2 min-h-36 resize-y" value={form.message} maxLength={3000} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} placeholder="Tulis semua yang ingin kamu sampaikan..." />
            <p className="mt-1 text-right text-xs font-medium text-slate-400">{form.message.length}/3000</p>
          </div>

          <div>
            <label className="form-label" htmlFor="capsule-teaser">Petunjuk kecil sebelum dibuka</label>
            <input id="capsule-teaser" className="form-input mt-2" value={form.teaser} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, teaser: event.target.value }))} placeholder="Contoh: Ada sesuatu yang sudah lama ingin aku bilang..." />
            <p className="mt-1 text-xs font-medium text-slate-400">Teaser terlihat oleh penerima sebelum waktunya, isi utama tetap terkunci.</p>
          </div>

          <div className="rounded-3xl bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="form-label">Kapan boleh dibuka?</p>
              <button type="button" onClick={useAnniversaryDate} className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-200">Pakai 25 September</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-slate-500" htmlFor="capsule-date">Tanggal</label><input id="capsule-date" type="date" className="form-input mt-1" value={form.unlock_date} onChange={(event) => setForm((current) => ({ ...current, unlock_date: event.target.value }))} /></div>
              <div><label className="text-xs font-semibold text-slate-500" htmlFor="capsule-time">Jam WIB</label><input id="capsule-time" type="time" className="form-input mt-1" value={form.unlock_time} onChange={(event) => setForm((current) => ({ ...current, unlock_time: event.target.value }))} /></div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl bg-white p-3">
              <input type="checkbox" checked={form.is_anniversary} onChange={(event) => setForm((current) => ({ ...current, is_anniversary: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-200" />
              <span className="text-sm font-semibold text-slate-600">Tandai sebagai kapsul anniversary</span>
            </label>
          </div>

          <div>
            <p className="form-label">Tema kapsul</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {(Object.keys(themeMeta) as LoveCapsuleTheme[]).map((theme) => (
                <button key={theme} type="button" onClick={() => setForm((current) => ({ ...current, theme }))} className={`rounded-2xl border p-3 text-xs font-bold transition ${form.theme === theme ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                  <span className={`mx-auto mb-2 block h-6 w-6 rounded-full ${themeMeta[theme].dot}`} />{themeMeta[theme].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3"><p className="form-label">Foto kenangan</p><span className="text-xs font-semibold text-slate-400">{totalFormPhotos}/10</span></div>
            <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600 hover:border-rose-300 hover:bg-rose-50">
              <AppIcon name="camera" /> Tambah foto
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple className="sr-only" onChange={addPhotos} disabled={totalFormPhotos >= MAX_PHOTOS} />
            </label>
            {(visibleExistingPhotos.length > 0 || pendingPhotos.length > 0) ? (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {visibleExistingPhotos.map((photo) => (
                  <div key={photo.id} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                    {photo.signed_url ? <img src={photo.signed_url} alt="Foto kapsul" className="h-full w-full object-cover" /> : null}
                    <button type="button" onClick={() => setRemovedPhotoIds((current) => [...current, photo.id])} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/65 text-white" aria-label="Hapus foto"><AppIcon name="x" size={15} /></button>
                  </div>
                ))}
                {pendingPhotos.map((photo) => (
                  <div key={photo.key} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                    <img src={photo.previewUrl} alt="Preview foto kapsul" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => removePending(photo.key)} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/65 text-white" aria-label="Hapus foto"><AppIcon name="x" size={15} /></button>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-2 text-xs font-medium text-slate-400">Maksimal 10 foto, masing-masing 5MB. Foto ikut terkunci bersama pesan.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>Batal</Button>
            <Button type="button" variant="secondary" onClick={previewDraft} disabled={saving}><AppIcon name="sparkles" className="mr-2" size={16} /> Preview</Button>
            <Button type="submit" className="col-span-2 sm:col-span-1" disabled={saving}>{saving ? 'Mengunci kapsul...' : editing ? 'Simpan perubahan' : 'Kunci kapsul'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} title="Batalkan Love Capsule?" description="Pesan dan foto akan dihapus permanen sebelum pasangan sempat membukanya." confirmLabel="Ya, batalkan" tone="danger" loading={deleting} onClose={() => setDeleteTarget(null)} onConfirm={deleteCapsule} />

      <CapsuleRecipientPreview data={preview} onClose={() => setPreview(null)} />

      <Modal open={Boolean(reveal)} onClose={() => { setReveal(null); setViewerIndex(null); }} title={reveal?.content.title || 'Love Capsule'} description={reveal ? `Dari ${reveal.senderName} · ${formatCapsuleDateTime(reveal.capsule.unlock_at)} WIB` : undefined}>
        {reveal ? (
          <div>
            <div className={`rounded-3xl bg-gradient-to-br ${themeMeta[reveal.capsule.theme].card} p-6 text-center text-white`}>
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/20"><AppIcon name="heart" size={32} /></span>
              {reveal.capsule.is_anniversary ? <p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-white/75">Anniversary 25 September</p> : null}
            </div>
            <p className="mt-5 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">{reveal.content.message}</p>
            {reveal.photos.length > 0 ? (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {reveal.photos.map((photo, index) => (
                  <button key={photo.id} type="button" onClick={() => setViewerIndex(index)} className="aspect-square overflow-hidden rounded-2xl bg-slate-100 focus:outline-none focus:ring-4 focus:ring-rose-100">
                    {photo.signed_url ? <img src={photo.signed_url} alt={`Foto kapsul ${index + 1}`} className="h-full w-full object-cover" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {reveal && viewerIndex !== null && reveal.photos[viewerIndex] ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-4" role="dialog" aria-modal="true" aria-label="Foto Love Capsule">
          <button type="button" onClick={() => setViewerIndex(null)} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Tutup foto"><AppIcon name="x" /></button>
          {reveal.photos.length > 1 ? <button type="button" onClick={() => setViewerIndex((viewerIndex - 1 + reveal.photos.length) % reveal.photos.length)} className="absolute left-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Foto sebelumnya"><AppIcon name="chevron-left" size={28} /></button> : null}
          {reveal.photos[viewerIndex].signed_url ? <img src={reveal.photos[viewerIndex].signed_url!} alt={`Foto ${viewerIndex + 1}`} className="max-h-[82dvh] max-w-full rounded-3xl object-contain shadow-2xl" /> : null}
          {reveal.photos.length > 1 ? <button type="button" onClick={() => setViewerIndex((viewerIndex + 1) % reveal.photos.length)} className="absolute right-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Foto berikutnya"><AppIcon name="chevron-right" size={28} /></button> : null}
        </div>
      ) : null}
    </main>
  );
}
