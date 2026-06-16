'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase/client';
import type { MutationType, MonthlyDeposit, OtherMutation, StoryPhoto } from '@/lib/types';
import { currentYearMonth, formatDate, monthLabel, MONTH_NAMES, rupiah, todayInput } from '@/lib/format';
import { calculateMonthlyRecaps } from '@/lib/calculations';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { RupiahInput } from '@/components/ui/RupiahInput';
import { AppIcon } from '@/components/ui/AppIcon';
import { useToast } from '@/components/ui/ToastProvider';
import { prepareImageForUpload, validateImageFile } from '@/lib/imageProcessing';
import { removeStoragePaths } from '@/lib/storageMedia';
import { StoryAlbumCollage, type PhotoViewerState, type StoryPhotoView } from './StoryAlbum';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import { removeById, upsertById } from '@/lib/realtimeState';

const PhotoViewer = dynamic(() => import('./StoryPhotoViewer').then((module) => module.StoryPhotoViewer), { ssr: false });

const MAX_STORY_PHOTOS = 10;

const emptyForm = {
  mutation_date: todayInput(),
  type: 'Tambah' as MutationType,
  amount: 0,
  description: ''
};

type PendingStoryPhoto = { key: string; file: File; previewUrl: string };

type ConfirmAction = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
};

function SummaryCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="rounded-[22px] bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function isValidDateText(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function storyTypeLabel(type: MutationType | string) {
  return type === 'Tambah' ? 'Tambah rezeki' : 'Kepakai buat kita';
}

function storyTitle(mutation: OtherMutation) {
  return mutation.description || (mutation.type === 'Tambah' ? 'Rezeki kecil untuk mimpi kita' : 'Satu cerita untuk kita');
}

export default function MutationsPage() {
  const { toast } = useToast();
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [photos, setPhotos] = useState<StoryPhotoView[]>([]);
  const [householdId, setHouseholdId] = useState('');
  const [albumReady, setAlbumReady] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<OtherMutation | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingStoryPhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [viewer, setViewer] = useState<PhotoViewerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterYear, setFilterYear] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchMutations = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userError || !userId) {
      if (showLoading) setLoading(false);
      toast({ title: 'Sesi tidak ditemukan', message: userError?.message || 'Silakan login ulang.', type: 'error' });
      return;
    }

    const [membershipResult, mutationsResult, depositsResult, photosResult] = await Promise.all([
      supabase.from('household_members').select('household_id').eq('user_id', userId).maybeSingle(),
      supabase.from('other_mutations').select('*').is('deleted_at', null).order('mutation_date', { ascending: false }),
      supabase.from('monthly_deposits').select('*').is('deleted_at', null),
      supabase.from('story_photos').select('*').order('sort_order', { ascending: true })
    ]);

    if (showLoading) setLoading(false);
    if (membershipResult.error || mutationsResult.error || depositsResult.error) {
      toast({ title: 'Gagal memuat cerita', message: membershipResult.error?.message || mutationsResult.error?.message || depositsResult.error?.message, type: 'error' });
      return;
    }

    setHouseholdId(membershipResult.data?.household_id || '');
    setMutations((mutationsResult.data || []) as OtherMutation[]);
    setDeposits((depositsResult.data || []) as MonthlyDeposit[]);

    if (photosResult.error) {
      setAlbumReady(false);
      setPhotos([]);
      toast({ title: 'Album foto belum aktif', message: 'Jalankan SQL supabase/stage2_story_album.sql agar foto cerita bisa digunakan.', type: 'info' });
      return;
    }

    setAlbumReady(true);
    const rawPhotos = (photosResult.data || []) as StoryPhoto[];
    setPhotos(rawPhotos.map((photo) => ({ ...photo, signed_url: null, thumbnail_url: null } as StoryPhotoView)));
  }, [toast]);

  useEffect(() => {
    fetchMutations();
    const channel = supabase.channel('stories-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, (payload) => {
        const previous = payload.old as Partial<OtherMutation>;
        const next = payload.new as Partial<OtherMutation>;
        if (payload.eventType === 'DELETE' || next.deleted_at) {
          if (previous.id || next.id) setMutations((rows) => removeById(rows, String(previous.id || next.id)));
          return;
        }
        if (next.id) setMutations((rows) => upsertById(rows, next as OtherMutation, (a, b) => b.mutation_date.localeCompare(a.mutation_date)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_photos' }, (payload) => {
        const previous = payload.old as Partial<StoryPhoto>;
        const next = payload.new as Partial<StoryPhoto>;
        if (payload.eventType === 'DELETE') {
          if (previous.id) setPhotos((rows) => removeById(rows, String(previous.id)));
          return;
        }
        if (next.id) setPhotos((rows) => upsertById(rows, { ...(next as StoryPhoto), signed_url: null, thumbnail_url: null }, (a, b) => a.sort_order - b.sort_order));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchMutations]);

  const photosByMutation = useMemo(() => {
    const map = new Map<string, StoryPhotoView[]>();
    photos.forEach((photo) => {
      const rows = map.get(photo.mutation_id) || [];
      rows.push(photo);
      map.set(photo.mutation_id, rows);
    });
    map.forEach((rows) => rows.sort((a, b) => a.sort_order - b.sort_order));
    return map;
  }, [photos]);

  const years = useMemo(() => {
    const now = currentYearMonth();
    const set = new Set<number>([now.year, 2026]);
    mutations.forEach((mutation) => set.add(new Date(`${mutation.mutation_date}T00:00:00`).getFullYear()));
    return Array.from(set).sort((a, b) => b - a);
  }, [mutations]);

  const filteredMutations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return mutations.filter((mutation) => {
      const date = new Date(`${mutation.mutation_date}T00:00:00`);
      if (filterYear !== 'all' && date.getFullYear() !== Number(filterYear)) return false;
      if (filterMonth !== 'all' && date.getMonth() + 1 !== Number(filterMonth)) return false;
      if (filterType !== 'all' && mutation.type !== filterType) return false;
      if (keyword && !(mutation.description || '').toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [mutations, filterYear, filterMonth, filterType, search]);


  const { visibleItems: visibleMutations, hasMore: hasMoreMutations, loadMore: loadMoreMutations, remaining: remainingMutations } = useProgressiveList(
    filteredMutations,
    8,
    [filterYear, filterMonth, filterType, search]
  );

  const summary = useMemo(() => {
    const additions = filteredMutations.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = filteredMutations.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { additions, withdrawals, net: additions - withdrawals, count: filteredMutations.length };
  }, [filteredMutations]);

  const currentBalance = useMemo(() => {
    const depositsTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.paid_amount || 0), 0);
    const additions = mutations.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = mutations.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return depositsTotal + additions - withdrawals;
  }, [deposits, mutations]);

  const editingPhotos = useMemo(() => editing ? (photosByMutation.get(editing.id) || []) : [], [editing, photosByMutation]);
  const visibleEditingPhotos = useMemo(() => editingPhotos.filter((photo) => !removedPhotoIds.includes(photo.id)), [editingPhotos, removedPhotoIds]);
  const formPhotoCount = visibleEditingPhotos.length + pendingPhotos.length;

  async function runConfirmAction() {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
    } catch (error) {
      toast({ title: 'Aksi gagal', message: error instanceof Error ? error.message : 'Terjadi error tidak diketahui.', type: 'error' });
    } finally {
      setConfirmLoading(false);
    }
  }

  function clearPendingPhotos() {
    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPendingPhotos([]);
  }

  function openCreateForm() {
    clearPendingPhotos();
    setEditing(null);
    setRemovedPhotoIds([]);
    setForm({ ...emptyForm, mutation_date: todayInput() });
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    clearPendingPhotos();
    setRemovedPhotoIds([]);
    setForm(emptyForm);
    setEditing(null);
    setFormOpen(false);
  }

  function resetFilters() {
    setFilterYear('all');
    setFilterMonth('all');
    setFilterType('all');
    setSearch('');
    setFiltersOpen(false);
  }

  function startEdit(mutation: OtherMutation) {
    clearPendingPhotos();
    setRemovedPhotoIds([]);
    setEditing(mutation);
    setForm({ mutation_date: mutation.mutation_date, type: mutation.type, amount: Number(mutation.amount), description: mutation.description || '' });
    setFormOpen(true);
  }

  function validatePhotoFile(file: File) {
    validateImageFile(file);
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (!albumReady) {
      toast({ title: 'Album belum aktif', message: 'Jalankan SQL album terlebih dahulu.', type: 'error' });
      return;
    }

    const availableSlots = Math.max(MAX_STORY_PHOTOS - formPhotoCount, 0);
    if (availableSlots === 0) {
      toast({ title: 'Album sudah penuh', message: 'Satu cerita maksimal berisi 10 foto.', type: 'info' });
      return;
    }

    const next: PendingStoryPhoto[] = [];
    const errors: string[] = [];
    const existingKeys = new Set(pendingPhotos.map((photo) => `${photo.file.name}-${photo.file.size}-${photo.file.lastModified}`));

    for (const file of selectedFiles) {
      if (next.length >= availableSlots) break;
      const duplicateKey = `${file.name}-${file.size}-${file.lastModified}`;
      if (existingKeys.has(duplicateKey)) continue;
      try {
        validatePhotoFile(file);
        next.push({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
        existingKeys.add(duplicateKey);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${file.name} tidak dapat dipakai.`);
      }
    }

    if (selectedFiles.length > next.length + errors.length || selectedFiles.length > availableSlots) {
      toast({ title: 'Sebagian foto tidak ditambahkan', message: `Album masih memiliki ${availableSlots} slot. Maksimal 10 foto per cerita.`, type: 'info' });
    }
    if (errors.length > 0) toast({ title: 'Ada foto yang ditolak', message: errors[0], type: 'error' });
    if (next.length > 0) setPendingPhotos((current) => [...current, ...next]);
  }

  function removePendingPhoto(key: string) {
    setPendingPhotos((current) => {
      const target = current.find((photo) => photo.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.key !== key);
    });
  }

  function markExistingPhotoForRemoval(photoId: string) {
    setRemovedPhotoIds((current) => current.includes(photoId) ? current : [...current, photoId]);
  }

  async function uploadPendingStoryPhotos(mutationId: string) {
    if (pendingPhotos.length === 0) {
      return { originalPaths: [] as string[], thumbnailPaths: [] as string[], uploadedPaths: [] as string[] };
    }
    if (!householdId) throw new Error('Household akun tidak ditemukan. Login ulang lalu coba lagi.');

    const originalPaths: string[] = [];
    const thumbnailPaths: string[] = [];
    const uploadedPaths: string[] = [];
    try {
      for (const photo of pendingPhotos) {
        const prepared = await prepareImageForUpload(photo.file);
        const mediaId = crypto.randomUUID();
        const originalPath = `${householdId}/${mutationId}/original-${mediaId}.${prepared.originalExtension}`;
        const { error: originalError } = await supabase.storage.from('story-albums').upload(originalPath, prepared.originalFile, {
          cacheControl: '31536000', contentType: prepared.originalFile.type || undefined, upsert: false
        });
        if (originalError) throw originalError;
        uploadedPaths.push(originalPath);
        originalPaths.push(originalPath);

        if (prepared.thumbnailFile && prepared.thumbnailExtension) {
          const thumbnailPath = `${householdId}/${mutationId}/thumb-${mediaId}.${prepared.thumbnailExtension}`;
          const { error: thumbnailError } = await supabase.storage.from('story-albums').upload(thumbnailPath, prepared.thumbnailFile, {
            cacheControl: '31536000', contentType: prepared.thumbnailFile.type || undefined, upsert: false
          });
          if (thumbnailError) throw thumbnailError;
          uploadedPaths.push(thumbnailPath);
          thumbnailPaths.push(thumbnailPath);
        } else {
          thumbnailPaths.push(originalPath);
        }
      }
      return { originalPaths, thumbnailPaths, uploadedPaths };
    } catch (error) {
      await removeStoragePaths('story-albums', uploadedPaths);
      throw error;
    }
  }

  function openPhotoViewer(storyPhotos: StoryPhotoView[], index: number, title: string) {
    setViewer({ photos: storyPhotos, index, title });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(form.amount);
    const description = form.description.trim();

    if (!form.mutation_date || !isValidDateText(form.mutation_date)) {
      toast({ title: 'Tanggal belum valid', message: 'Tanggal cerita wajib diisi dengan benar.', type: 'error' }); return;
    }
    if (form.mutation_date > todayInput()) {
      toast({ title: 'Tanggal belum valid', message: 'Tanggal cerita tidak boleh lebih dari hari ini.', type: 'error' }); return;
    }
    if (!['Tambah', 'Penarikan'].includes(form.type)) {
      toast({ title: 'Jenis cerita belum valid', message: 'Pilih Tambah rezeki atau Kepakai buat kita.', type: 'error' }); return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Nominal belum valid', message: 'Nominal harus lebih dari Rp0.', type: 'error' }); return;
    }
    if (amount > 1_000_000_000) {
      toast({ title: 'Nominal terlalu besar', message: 'Maksimal Rp1.000.000.000 per cerita.', type: 'error' }); return;
    }
    if (description.length > 160) {
      toast({ title: 'Cerita terlalu panjang', message: 'Maksimal 160 karakter.', type: 'error' }); return;
    }
    if (form.type === 'Penarikan' && description.length === 0) {
      toast({ title: 'Cerita singkat wajib diisi', message: 'Tulis momen atau tujuan penggunaan dana supaya kenangannya tetap jelas.', type: 'error' }); return;
    }
    if (formPhotoCount > MAX_STORY_PHOTOS) {
      toast({ title: 'Album terlalu penuh', message: 'Satu cerita maksimal berisi 10 foto.', type: 'error' }); return;
    }
    if ((pendingPhotos.length > 0 || removedPhotoIds.length > 0) && !albumReady) {
      toast({ title: 'Album belum aktif', message: 'Jalankan SQL album terlebih dahulu.', type: 'error' }); return;
    }

    const balanceWithoutCurrentMutation = (() => {
      const depositsTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.paid_amount || 0), 0);
      const otherRows = mutations.filter((mutation) => mutation.id !== editing?.id);
      const additions = otherRows.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const withdrawals = otherRows.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return depositsTotal + additions - withdrawals;
    })();

    if (form.type === 'Penarikan' && amount > balanceWithoutCurrentMutation) {
      toast({ title: 'Saldo belum cukup', message: `Saldo kita yang tersedia ${rupiah(balanceWithoutCurrentMutation)}.`, type: 'error' }); return;
    }

    const nextMutation = {
      id: editing?.id || 'preview', mutation_date: form.mutation_date, type: form.type, amount, description: description || null,
      created_at: editing?.created_at || '', updated_at: editing?.updated_at || '', household_id: editing?.household_id || '', deleted_at: null, deleted_by: null
    } as OtherMutation;
    const nextMutations = [...mutations.filter((mutation) => mutation.id !== editing?.id), nextMutation];
    const negativeRecap = calculateMonthlyRecaps(deposits, nextMutations).find((recap) => recap.endingBalance < 0);
    if (negativeRecap) {
      toast({ title: 'Saldo bulan menjadi minus', message: `Saldo akhir ${monthLabel(negativeRecap.year, negativeRecap.month)} akan menjadi ${rupiah(negativeRecap.endingBalance)}.`, type: 'error' }); return;
    }

    setSaving(true);
    const mutationId = editing?.id || crypto.randomUUID();
    let uploadedMedia = { originalPaths: [] as string[], thumbnailPaths: [] as string[], uploadedPaths: [] as string[] };
    let committed = false;

    try {
      // File di-upload lebih dulu. Metadata cerita + daftar foto baru disimpan atomik lewat satu RPC.
      uploadedMedia = await uploadPendingStoryPhotos(mutationId);
      const { error: saveError } = await supabase.rpc('save_story_mutation', {
        p_id: mutationId,
        p_mutation_date: form.mutation_date,
        p_type: form.type,
        p_amount: amount,
        p_description: description || null,
        p_delete_photo_ids: removedPhotoIds,
        p_new_photo_paths: uploadedMedia.originalPaths,
        p_new_thumbnail_paths: uploadedMedia.thumbnailPaths
      });
      if (saveError) throw saveError;
      committed = true;

      const pathsToDelete = editingPhotos
        .filter((photo) => removedPhotoIds.includes(photo.id))
        .flatMap((photo) => [photo.storage_path, photo.thumbnail_path]);
      const deleteStorageError = await removeStoragePaths('story-albums', pathsToDelete);
      if (deleteStorageError) toast({ title: 'Cerita tersimpan', message: 'Data album sudah aman, tetapi beberapa file lama belum berhasil dibersihkan.', type: 'info' });

      toast({
        title: editing ? 'Cerita berhasil diperbarui' : 'Cerita baru berhasil disimpan',
        message: formPhotoCount > 0 ? `${formPhotoCount} foto ikut tersimpan di album kita.` : 'Nanti fotonya masih bisa ditambahkan kapan saja.',
        type: 'success'
      });
      closeForm();
      fetchMutations(false);
    } catch (error) {
      if (!committed) await removeStoragePaths('story-albums', uploadedMedia.uploadedPaths);
      toast({ title: editing ? 'Gagal memperbarui cerita' : 'Gagal menyimpan cerita', message: error instanceof Error ? error.message : 'Terjadi error tidak diketahui.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function deleteMutation(mutation: OtherMutation) {
    const albumCount = (photosByMutation.get(mutation.id) || []).length;
    setConfirmAction({
      title: 'Arsipkan cerita ini?',
      description: `${storyTypeLabel(mutation.type)} sebesar ${rupiah(mutation.amount)} pada ${formatDate(mutation.mutation_date)} akan dipindahkan ke arsip. ${albumCount > 0 ? `${albumCount} foto tetap aman dan ikut kembali saat cerita dipulihkan.` : ''}`,
      confirmLabel: 'Arsipkan cerita', tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('other_mutations').update({ deleted_at: new Date().toISOString() }).eq('id', mutation.id);
        if (error) throw error;
        toast({ title: 'Cerita dipindahkan ke arsip', type: 'success' });
        fetchMutations(false);
      }
    });
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Cerita Kita"
        description="Catat rezeki, momen yang kita jalani, dan simpan fotonya dalam satu album kecil."
        action={<Button type="button" onClick={openCreateForm} className="hidden gap-2 md:inline-flex"><span className="heart-beat inline-flex"><AppIcon name="heart" size={18} /></span> Tulis cerita</Button>}
      />

      <Card>
        <div className="stagger-grid mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryCard label="Tambah rezeki" value={rupiah(summary.additions)} tone="green" />
          <SummaryCard label="Kepakai buat kita" value={rupiah(summary.withdrawals)} tone="red" />
          <SummaryCard label="Selisih cerita" value={rupiah(summary.net)} tone={summary.net < 0 ? 'red' : 'green'} />
          <SummaryCard label="Saldo kita" value={rupiah(currentBalance)} tone={currentBalance < 0 ? 'red' : 'green'} />
          <SummaryCard label="Jumlah cerita" value={`${summary.count}`} />
        </div>

        <div className="mb-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <div>
            <h2 className="font-bold text-slate-900">Album cerita kita</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">{filteredMutations.length} cerita untuk dikenang</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setFiltersOpen((value) => !value)} className="gap-2">
            <AppIcon name="filter" size={17} /> {filtersOpen ? 'Tutup filter' : 'Cari cerita'}
          </Button>
        </div>

        {filtersOpen ? (
          <div className="soft-pop mb-5 grid gap-3 rounded-3xl bg-slate-50 p-4 md:grid-cols-5">
            <select className="form-input" value={filterYear} onChange={(event) => setFilterYear(event.target.value)} aria-label="Filter tahun cerita">
              <option value="all">Semua tahun</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <select className="form-input" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)} aria-label="Filter bulan cerita">
              <option value="all">Semua bulan</option>
              {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
            <select className="form-input" value={filterType} onChange={(event) => setFilterType(event.target.value)} aria-label="Filter jenis cerita">
              <option value="all">Semua jenis</option>
              <option value="Tambah">Tambah rezeki</option>
              <option value="Penarikan">Kepakai buat kita</option>
            </select>
            <input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari momen..." aria-label="Cari cerita" />
            <Button type="button" variant="secondary" onClick={resetFilters}>Reset filter</Button>
          </div>
        ) : null}

        {filteredMutations.length === 0 ? (
          <div className="space-y-4">
            <EmptyState title="Belum ada cerita kita" description="Tulis momen pertama, lalu tambahkan foto kenangannya." />
            <Button type="button" className="w-full md:hidden" onClick={openCreateForm}>Tulis cerita pertama</Button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {visibleMutations.map((mutation) => {
              const storyPhotos = photosByMutation.get(mutation.id) || [];
              const title = storyTitle(mutation);
              return (
                <article key={mutation.id} className="story-card relative overflow-visible rounded-[28px] border border-slate-100 bg-white p-3 shadow-sm" style={{ boxShadow: '0 12px 30px rgba(52, 77, 147, 0.10)' }}>
                  <StoryAlbumCollage photos={storyPhotos} title={title} onOpen={(index) => openPhotoViewer(storyPhotos, index, title)} />
                  <div className="p-2 pb-1 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className={`badge ${mutation.type === 'Tambah' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{storyTypeLabel(mutation.type)}</span>
                        <h3 className="mt-3 line-clamp-2 text-lg font-bold text-slate-900">{title}</h3>
                        <p className="mt-1 text-xs font-semibold text-slate-400">{formatDate(mutation.mutation_date)} · {storyPhotos.length} foto</p>
                      </div>
                      <p className={`shrink-0 text-base font-bold ${mutation.type === 'Tambah' ? 'text-emerald-700' : 'text-rose-700'}`}>{mutation.type === 'Tambah' ? '+' : '-'}{rupiah(mutation.amount)}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <button type="button" onClick={() => startEdit(mutation)} className="inline-flex items-center gap-2 text-sm font-semibold text-[#3557bf] hover:underline"><AppIcon name="image" size={17} /> Ubah cerita & album</button>
                      <details className="action-menu">
                        <summary aria-label={`Aksi cerita ${title}`} className="flex items-center gap-2"><AppIcon name="more" size={17} /> Lainnya</summary>
                        <div className="action-menu-panel space-y-2">
                          <Button type="button" variant="secondary" className="w-full" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); startEdit(mutation); }}>Edit cerita</Button>
                          <Button type="button" variant="danger" className="w-full" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); deleteMutation(mutation); }}>Arsipkan</Button>
                        </div>
                      </details>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {hasMoreMutations ? (
          <div className="mt-5 flex justify-center">
            <Button type="button" variant="secondary" onClick={loadMoreMutations}>Muat {Math.min(8, remainingMutations)} cerita lagi</Button>
          </div>
        ) : null}
      </Card>

      <button type="button" onClick={openCreateForm} className="fab-love mobile-fab-safe fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-xl transition hover:bg-rose-600 focus:outline-none focus:ring-4 focus:ring-rose-200 md:hidden" aria-label="Tulis cerita baru">
        <AppIcon name="heart" size={25} />
      </button>

      <Modal open={formOpen} title={editing ? 'Ubah cerita kita' : 'Tulis cerita baru'} description="Simpan momen, nominal, dan sampai 10 foto dalam satu cerita." mobileSheet onClose={closeForm}>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <span className="form-label" id="story-type-label">Jenis cerita</span>
            <div className="mt-2 grid grid-cols-2 gap-3" role="group" aria-labelledby="story-type-label">
              <button type="button" onClick={() => setForm({ ...form, type: 'Tambah' })} aria-pressed={form.type === 'Tambah'} className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-bold transition ${form.type === 'Tambah' ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-200' : 'bg-slate-50 text-slate-500'}`}>
                <AppIcon name="arrow-down" size={19} /> Tambah rezeki
              </button>
              <button type="button" onClick={() => setForm({ ...form, type: 'Penarikan' })} aria-pressed={form.type === 'Penarikan'} className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-bold transition ${form.type === 'Penarikan' ? 'bg-rose-100 text-rose-800 ring-2 ring-rose-200' : 'bg-slate-50 text-slate-500'}`}>
                <AppIcon name="heart" size={19} /> Kepakai buat kita
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="story-date">Tanggal cerita</label>
              <input id="story-date" className="form-input mt-2" type="date" max={todayInput()} value={form.mutation_date} onChange={(event) => setForm({ ...form, mutation_date: event.target.value })} />
            </div>
            <div>
              <label className="form-label" htmlFor="story-amount">Nominal</label>
              <RupiahInput id="story-amount" className="mt-2" value={form.amount} onValueChange={(value) => setForm({ ...form, amount: value })} placeholder="0" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3"><label className="form-label" htmlFor="story-description">Judul / cerita singkat</label><span className="text-xs font-medium text-slate-400">{form.description.length}/160</span></div>
            <textarea id="story-description" maxLength={160} className="form-input mt-2 min-h-24 resize-none" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={form.type === 'Tambah' ? 'Contoh: Bonus kecil buat mimpi liburan kita' : 'Contoh: Jalan-jalan ke Bandung berdua'} />
          </div>

          <div className="rounded-[26px] border border-rose-100 bg-rose-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-slate-800"><AppIcon name="camera" size={18} /> Album kenangan</p>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-500">Maksimal 10 foto, masing-masing maksimal 5MB.</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${formPhotoCount >= MAX_STORY_PHOTOS ? 'bg-rose-100 text-rose-700' : 'bg-white text-slate-600'}`}>{formPhotoCount}/{MAX_STORY_PHOTOS}</span>
            </div>

            {(visibleEditingPhotos.length > 0 || pendingPhotos.length > 0) ? (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {visibleEditingPhotos.map((photo, index) => (
                  <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                    {photo.thumbnail_url || photo.signed_url ? <img src={photo.thumbnail_url || photo.signed_url || ''} alt={`Foto album ${index + 1}`} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-slate-300"><AppIcon name="image" size={25} /></span>}
                    <button type="button" onClick={() => markExistingPhotoForRemoval(photo.id)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/70 text-white shadow transition hover:bg-rose-600 focus:outline-none focus:ring-4 focus:ring-white/50" aria-label={`Hapus foto ${index + 1} dari album`}><AppIcon name="trash" size={15} /></button>
                  </div>
                ))}
                {pendingPhotos.map((photo, index) => (
                  <div key={photo.key} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100 ring-2 ring-rose-200">
                    <img src={photo.previewUrl} alt={`Foto baru ${index + 1}`} className="h-full w-full object-cover" />
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">BARU</span>
                    <button type="button" onClick={() => removePendingPhoto(photo.key)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/70 text-white shadow transition hover:bg-rose-600 focus:outline-none focus:ring-4 focus:ring-white/50" aria-label={`Batalkan foto baru ${index + 1}`}><AppIcon name="x" size={15} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-rose-200 bg-white/70 p-5 text-center text-sm font-medium text-slate-500">Belum ada foto yang dipilih.</div>
            )}

            {removedPhotoIds.length > 0 ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white p-3 text-xs font-semibold text-slate-600">
                <span>{removedPhotoIds.length} foto akan dihapus saat cerita disimpan.</span>
                <button type="button" onClick={() => setRemovedPhotoIds([])} className="text-[#3557bf] hover:underline">Batalkan</button>
              </div>
            ) : null}

            <label className={`mt-4 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition ${!albumReady || formPhotoCount >= MAX_STORY_PHOTOS ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-white text-rose-600 shadow-sm ring-1 ring-rose-100 hover:bg-rose-50'}`}>
              <AppIcon name="plus" size={18} /> Pilih foto dari galeri
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" className="sr-only" disabled={!albumReady || formPhotoCount >= MAX_STORY_PHOTOS} onChange={addPhotos} />
            </label>
            {!albumReady ? <p className="mt-3 text-xs font-semibold text-amber-700">Album belum aktif. Jalankan file SQL Tahap 2 terlebih dahulu.</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? (pendingPhotos.length > 0 ? 'Mengunggah foto...' : 'Menyimpan...') : editing ? 'Simpan cerita' : 'Simpan cerita kita'}</Button>
          </div>
        </form>
      </Modal>

      <PhotoViewer viewer={viewer} onClose={() => setViewer(null)} onChange={(index) => setViewer((current) => current ? { ...current, index } : null)} />
      <ConfirmDialog open={Boolean(confirmAction)} title={confirmAction?.title || ''} description={confirmAction?.description} confirmLabel={confirmAction?.confirmLabel} tone={confirmAction?.tone} loading={confirmLoading} onClose={() => (confirmLoading ? undefined : setConfirmAction(null))} onConfirm={runConfirmAction} />
    </main>
  );
}
