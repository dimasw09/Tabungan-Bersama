'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { DepositStatus, Member, MonthlyDeposit, MonthlyProgressStatus } from '@/lib/types';
import {
  DEPOSIT_STATUS_OPTIONS,
  depositRemaining,
  depositStatusLabel,
  getDepositStatus,
  isDepositOverdue,
  normalizeDepositStatuses,
  statusBadgeClass
} from '@/lib/depositStatus';
import { currentYearMonth, formatDate, monthLabel, MONTH_NAMES, rupiah, safeDueDate, todayInput } from '@/lib/format';
import { monthlyProgressLabel } from '@/lib/calculations';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/ToastProvider';
import { RupiahInput } from '@/components/ui/RupiahInput';
import { AppIcon } from '@/components/ui/AppIcon';
import { AnimatedNumber, AnimatedRupiah } from '@/components/ui/AnimatedNumber';
import { prepareImageForUpload } from '@/lib/imageProcessing';
import { removeStoragePaths } from '@/lib/storageMedia';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import { removeById, upsertById } from '@/lib/realtimeState';

const initialYearMonth = currentYearMonth();
import { LocalProofPreview, MiniSummaryCard, PaymentCard, ProofThumbnail } from './DepositCards';
import { ALLOWED_PROOF_TYPES, MAX_PROOF_SIZE, MIN_DEPOSIT_YEAR, getPaymentDraftWarnings, shiftMonth, sortMembers, validatePaymentDraft, type ConfirmAction, type DepositRow, type PaymentDraft } from './depositModel';

export default function DepositsPage() {
  const { toast } = useToast();
  const today = todayInput();
  const [members, setMembers] = useState<Member[]>([]);
  const membersRef = useRef<Member[]>([]);
  const [householdId, setHouseholdId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedYearMonth, setSelectedYearMonth] = useState(initialYearMonth);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistoryFilter, setShowHistoryFilter] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const [filterYear, setFilterYear] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterMember, setFilterMember] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);

    const { data: userResult, error: userError } = await supabase.auth.getUser();
    const userId = userResult.user?.id;
    if (userError || !userId) {
      if (showLoading) setLoading(false);
      toast({ title: 'Sesi tidak ditemukan', message: userError?.message || 'Silakan login ulang.', type: 'error' });
      return;
    }

    const [membershipResult, membersResult, depositsResult] = await Promise.all([
      supabase.from('household_members').select('household_id').eq('user_id', userId).maybeSingle(),
      supabase.from('members').select('*').order('name'),
      supabase.from('monthly_deposits').select('*, members(*)').is('deleted_at', null).order('year').order('month').order('due_date')
    ]);
    if (showLoading) setLoading(false);

    if (membershipResult.error || membersResult.error || depositsResult.error) {
      toast({ title: 'Gagal ambil setoran', message: membershipResult.error?.message || membersResult.error?.message || depositsResult.error?.message, type: 'error' });
      return;
    }

    setCurrentUserId(userId);
    setHouseholdId(membershipResult.data?.household_id || '');
    setMembers(((membersResult.data || []) as Member[]).sort(sortMembers));
    setDeposits(normalizeDepositStatuses((depositsResult.data || []) as MonthlyDeposit[]));
  }, [toast]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel('deposits-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, (payload) => {
        const previous = payload.old as Partial<MonthlyDeposit>;
        const next = payload.new as Partial<MonthlyDeposit>;
        if (payload.eventType === 'DELETE' || next.deleted_at) {
          if (previous.id || next.id) setDeposits((rows) => removeById(rows, String(previous.id || next.id)));
          return;
        }
        if (!next.id) return;
        setDeposits((rows) => {
          const member = membersRef.current.find((item) => item.id === next.member_id);
          const normalized = normalizeDepositStatuses([{ ...(next as MonthlyDeposit), members: member || null }])[0];
          return upsertById(rows, normalized, (a, b) => a.year - b.year || a.month - b.month || a.due_date.localeCompare(b.due_date));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (payload) => {
        const previous = payload.old as Partial<Member>;
        const next = payload.new as Partial<Member>;
        if (payload.eventType === 'DELETE') {
          if (previous.id) setMembers((rows) => removeById(rows, String(previous.id)));
          return;
        }
        if (next.id) setMembers((rows) => upsertById(rows, next as Member, sortMembers));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  function canManageMember(member: Member | null | undefined) {
    return Boolean(member && member.auth_user_id === currentUserId);
  }

  const selectedRows = useMemo<DepositRow[]>(() => {
    return members.map((member) => {
      const deposit = deposits.find((item) => item.member_id === member.id && item.year === selectedYearMonth.year && item.month === selectedYearMonth.month) || null;
      const dueDate = deposit?.due_date || safeDueDate(selectedYearMonth.year, selectedYearMonth.month, Number(member.payday));
      const requiredAmount = Number(deposit?.required_amount ?? member.monthly_amount);
      const paidAmount = Number(deposit?.paid_amount || 0);
      const actualTransferDate = deposit?.actual_transfer_date || null;
      const status = getDepositStatus({
        paidAmount,
        requiredAmount,
        actualTransferDate,
        dueDate
      });

      return {
        member,
        deposit,
        year: selectedYearMonth.year,
        month: selectedYearMonth.month,
        due_date: dueDate,
        required_amount: requiredAmount,
        actual_transfer_date: actualTransferDate,
        paid_amount: paidAmount,
        proof_image_url: deposit?.proof_image_url || null,
        status
      };
    });
  }, [members, deposits, selectedYearMonth]);

  const monthSummary = useMemo(() => {
    const target = selectedRows.reduce((sum, row) => sum + row.required_amount, 0);
    const paid = selectedRows.reduce((sum, row) => sum + row.paid_amount, 0);
    const remaining = Math.max(target - paid, 0);
    const progress = target > 0 ? Math.min(Math.round((paid / target) * 100), 100) : 0;
    const completeCount = selectedRows.filter((row) => row.paid_amount >= row.required_amount && row.required_amount > 0).length;
    const status: MonthlyProgressStatus = paid <= 0 ? 'EMPTY' : paid < target ? 'INCOMPLETE' : paid === target ? 'COMPLETE' : 'OVERPAID';

    return { target, paid, remaining, progress, completeCount, status };
  }, [selectedRows]);

  const years = useMemo(() => {
    const set = new Set<number>([MIN_DEPOSIT_YEAR, initialYearMonth.year, selectedYearMonth.year]);
    deposits.forEach((deposit) => set.add(deposit.year));
    return Array.from(set).sort((a, b) => a - b);
  }, [deposits, selectedYearMonth.year]);

  const filteredDeposits = useMemo(() => {
    return deposits.filter((deposit) => {
      const status = getDepositStatus({
        paidAmount: deposit.paid_amount,
        requiredAmount: deposit.required_amount,
        actualTransferDate: deposit.actual_transfer_date,
        dueDate: deposit.due_date
      });

      if (filterYear !== 'all' && deposit.year !== Number(filterYear)) return false;
      if (filterMonth !== 'all' && deposit.month !== Number(filterMonth)) return false;
      if (filterMember !== 'all' && deposit.member_id !== filterMember) return false;
      if (filterStatus !== 'all' && status !== filterStatus) return false;
      return true;
    });
  }, [deposits, filterYear, filterMonth, filterMember, filterStatus]);

  const { visibleItems: visibleHistoryDeposits, hasMore: hasMoreHistory, loadMore: loadMoreHistory, remaining: remainingHistory } = useProgressiveList(
    filteredDeposits,
    12,
    [filterYear, filterMonth, filterMember, filterStatus]
  );

  function changeMonth(diff: number) {
    setSelectedYearMonth((current) => {
      const next = shiftMonth(current.year, current.month, diff);
      const minValue = MIN_DEPOSIT_YEAR * 100 + 1;
      const maxValue = initialYearMonth.year * 100 + 12;
      const nextValue = next.year * 100 + next.month;

      if (nextValue < minValue || nextValue > maxValue) return current;
      return next;
    });
  }

  function resetHistoryFilter() {
    setFilterYear('all');
    setFilterMonth('all');
    setFilterMember('all');
    setFilterStatus('all');
    setShowHistoryFilter(false);
  }

  function openPayment(row: DepositRow, mode: 'quick' | 'custom') {
    if (!canManageMember(row.member)) {
      toast({ title: 'Setoran hanya bisa dilihat', message: `Akun ini tidak punya izin mengubah setoran ${row.member.name}.`, type: 'info' });
      return;
    }
    setPaymentDraft({
      member: row.member,
      deposit: row.deposit,
      year: row.year,
      month: row.month,
      due_date: row.due_date,
      required_amount: row.required_amount,
      actual_transfer_date: mode === 'quick' ? today : row.actual_transfer_date || today,
      paid_amount: mode === 'quick' ? row.required_amount : row.paid_amount || row.required_amount,
      proofFile: null,
      mode
    });
  }

  function validateFile(file: File) {
    if (!ALLOWED_PROOF_TYPES.has(file.type)) throw new Error('Format bukti transfer harus JPG, PNG, WebP, HEIC, atau HEIF.');
    if (file.size <= 0) throw new Error('File bukti transfer kosong atau rusak.');
    if (file.size > MAX_PROOF_SIZE) throw new Error('Ukuran foto maksimal 5MB.');
  }

  async function uploadProof(file: File, depositId: string) {
    validateFile(file);
    const prepared = await prepareImageForUpload(file);
    if (!householdId) throw new Error('Akun belum terhubung ke rumah tangga. Login ulang lalu coba lagi.');
    const path = `${householdId}/${depositId}/${crypto.randomUUID()}.${prepared.originalExtension}`;
    const { error } = await supabase.storage.from('transfer-proofs').upload(path, prepared.originalFile, {
      cacheControl: '31536000',
      contentType: prepared.originalFile.type || file.type,
      upsert: false
    });
    if (error) throw error;
    return path;
  }

  async function persistPaymentDraft(draft: PaymentDraft) {
    if (!canManageMember(draft.member)) {
      toast({ title: 'Akses ditolak', message: `Setoran ${draft.member.name} tidak boleh diubah oleh akun ini.`, type: 'error' });
      return;
    }
    setSavingDraft(true);
    let uploadedPath: string | null = null;

    try {
      const status = getDepositStatus({
        paidAmount: draft.paid_amount,
        requiredAmount: draft.required_amount,
        actualTransferDate: draft.actual_transfer_date || null,
        dueDate: draft.due_date
      });
      const depositId = draft.deposit?.id || crypto.randomUUID();
      const oldPath = draft.deposit?.proof_image_url || null;

      if (draft.proofFile) uploadedPath = await uploadProof(draft.proofFile, depositId);

      const payload = {
        member_id: draft.member.id,
        year: draft.year,
        month: draft.month,
        due_date: draft.due_date,
        required_amount: Number(draft.required_amount),
        actual_transfer_date: Number(draft.paid_amount || 0) > 0 ? draft.actual_transfer_date : null,
        paid_amount: Number(draft.paid_amount || 0),
        proof_image_url: uploadedPath || oldPath,
        status,
        deleted_at: null,
        deleted_by: null
      };

      const result = draft.deposit
        ? await supabase.from('monthly_deposits').update(payload).eq('id', draft.deposit.id).select().single()
        : await supabase.from('monthly_deposits').insert({ id: depositId, ...payload }).select().single();

      if (result.error) throw result.error;

      if (uploadedPath && oldPath && oldPath !== uploadedPath && !oldPath.startsWith('http')) {
        const cleanupError = await removeStoragePaths('transfer-proofs', [oldPath]);
        if (cleanupError) toast({ title: 'Setoran tersimpan', message: 'Bukti baru aman, tetapi file bukti lama belum berhasil dibersihkan.', type: 'info' });
      }

      toast({
        title: draft.mode === 'quick' ? 'Setoran berhasil dicatat' : 'Setoran berhasil disimpan',
        message: `${draft.member.name} ${monthLabel(draft.year, draft.month)} berhasil masuk ke tabungan kita.`,
        type: 'success'
      });
      setPaymentDraft(null);
      fetchData(false);
    } catch (error) {
      if (uploadedPath) await removeStoragePaths('transfer-proofs', [uploadedPath]);
      const message = error instanceof Error ? error.message : 'Terjadi error tidak diketahui.';
      toast({ title: 'Gagal simpan setoran', message, type: 'error' });
    } finally {
      setSavingDraft(false);
    }
  }

  async function savePaymentDraft() {
    const validationMessage = validatePaymentDraft(paymentDraft);
    if (validationMessage || !paymentDraft) {
      toast({ title: 'Data setoran belum valid', message: validationMessage || 'Setoran belum dipilih, sayang.', type: 'error' });
      return;
    }

    const draft = paymentDraft;
    const warnings = getPaymentDraftWarnings(draft);

    if (warnings.length > 0) {
      setConfirmAction({
        title: 'Cek ulang dulu ya?',
        description: warnings.join(' '),
        confirmLabel: 'Iya, simpan',
        tone: 'primary',
        onConfirm: () => persistPaymentDraft(draft)
      });
      return;
    }

    await persistPaymentDraft(draft);
  }

  function resetPayment(row: DepositRow) {
    if (!canManageMember(row.member)) {
      toast({ title: 'Akses ditolak', message: `Setoran ${row.member.name} tidak boleh direset oleh akun ini.`, type: 'error' });
      return;
    }
    if (!row.deposit) return;
    const deposit = row.deposit;

    setConfirmAction({
      title: 'Bersihin setoran?',
      description: `Setoran ${row.member.name} ${monthLabel(row.year, row.month)} akan dikosongkan lagi. Nominal yang masuk, tanggal transfer, dan foto bukti akan dihapus.`,
      confirmLabel: 'Iya, reset',
      tone: 'danger',
      onConfirm: async () => {
        const oldProofPath = row.proof_image_url;
        const { error } = await supabase
          .from('monthly_deposits')
          .update({
            actual_transfer_date: null,
            paid_amount: 0,
            proof_image_url: null,
            status: 'UNPAID'
          })
          .eq('id', deposit.id);

        if (error) throw error;
        let cleanupMessage: string | undefined;
        if (oldProofPath && !oldProofPath.startsWith('http')) {
          const storageError = await removeStoragePaths('transfer-proofs', [oldProofPath]);
          if (storageError) cleanupMessage = 'Data sudah direset, tetapi file bukti lama belum berhasil dibersihkan.';
        }
        toast({ title: 'Setoran berhasil direset', message: cleanupMessage, type: cleanupMessage ? 'info' : 'success' });
        fetchData(false);
      }
    });
  }

  function deleteDeposit(row: DepositRow | MonthlyDeposit) {
    const deposit = 'deposit' in row ? row.deposit : row;
    const member = 'member' in row ? row.member : row.members || members.find((item) => item.id === row.member_id) || null;
    const memberName = member?.name || 'Anggota';
    if (!canManageMember(member)) {
      toast({ title: 'Akses ditolak', message: `Setoran ${memberName} tidak boleh dihapus oleh akun ini.`, type: 'error' });
      return;
    }
    const year = row.year;
    const month = row.month;

    if (!deposit) return;

    const hasPayment = Number(deposit.paid_amount || 0) > 0;
    const hasProof = Boolean(deposit.proof_image_url);

    setConfirmAction({
      title: 'Hapus setoran ini?',
      description: `Setoran ${memberName} ${monthLabel(year, month)} akan disembunyikan dari saldo dan riwayat.${hasPayment ? ' Nominal yang masuk tidak lagi dihitung.' : ''}${hasProof ? ' Bukti transfer tetap disimpan untuk audit dan pemulihan.' : ''}`,
      confirmLabel: 'Iya, hapus',
      tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('monthly_deposits').update({ deleted_at: new Date().toISOString() }).eq('id', deposit.id);
        if (error) throw error;
        toast({ title: 'Setoran berhasil dihapus', message: 'Data disimpan sebagai arsip dan tidak lagi dihitung.', type: 'success' });
        fetchData(false);
      }
    });
  }

  async function runConfirmAction() {
    if (!confirmAction) return;

    setConfirmLoading(true);
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi error tidak diketahui.';
      toast({ title: 'Aksi gagal', message, type: 'error' });
    } finally {
      setConfirmLoading(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Setoran Bulanan"
        description="Pilih periode lalu catat setoran milikmu. Data pasangan tetap bisa dilihat bersama."
      />

      <Card className="love-sheen overflow-hidden !bg-[#4267d6] !p-4 text-white md:!p-5">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => changeMonth(-1)}
            className="h-11 w-11 shrink-0 rounded-full p-0"
            aria-label="Bulan sebelumnya"
            disabled={selectedYearMonth.year === MIN_DEPOSIT_YEAR && selectedYearMonth.month === 1}
          >
            <AppIcon name="chevron-left" size={21} />
          </Button>
          <button type="button" onClick={() => setMonthPickerOpen(true)} className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-center transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white" aria-label="Pilih bulan dan tahun">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Periode setoran</p>
            <p className="mt-1 truncate text-[25px] font-bold leading-tight md:text-3xl">{monthLabel(selectedYearMonth.year, selectedYearMonth.month)}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-white/75"><AppIcon name="calendar" size={14} /> Pilih bulan</span>
          </button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => changeMonth(1)}
            className="h-11 w-11 shrink-0 rounded-full p-0"
            aria-label="Bulan berikutnya"
            disabled={selectedYearMonth.year === initialYearMonth.year && selectedYearMonth.month === 12}
          >
            <AppIcon name="chevron-right" size={21} />
          </Button>
        </div>

        <div className="mt-3 flex justify-center">
          {(selectedYearMonth.year !== initialYearMonth.year || selectedYearMonth.month !== initialYearMonth.month) ? (
            <button type="button" onClick={() => setSelectedYearMonth(initialYearMonth)} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white">Kembali ke bulan ini</button>
          ) : <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white">Bulan ini</span>}
        </div>

        <div className="mt-4 rounded-[22px] bg-white/10 p-4 md:mt-5 md:rounded-[24px]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white/75">Sudah terkumpul</p>
              <p className="mt-1 text-[30px] font-bold leading-tight md:text-3xl"><AnimatedRupiah value={monthSummary.paid} /></p>
              <p className="mt-1 text-xs font-medium text-white/70">Target {rupiah(monthSummary.target)} • Kurang {rupiah(monthSummary.remaining)}</p>
            </div>
            <div className="text-right">
              <p className="text-[30px] font-bold leading-tight md:text-3xl"><AnimatedNumber value={monthSummary.progress} formatter={(value) => `${Math.round(value)}%`} /></p>
              <p className="text-xs font-medium text-white/70">{monthlyProgressLabel(monthSummary.status)}</p>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20 md:h-3">
            <div className="progress-reveal h-full rounded-full bg-white transition-all" style={{ width: `${monthSummary.progress}%` }} />
          </div>
        </div>
      </Card>

      <section className="stagger-grid grid gap-4 md:grid-cols-2">
        {selectedRows.length === 0 ? (
          <EmptyState title="Anggota belum ada" description="Data Kakak dan Mpip belum tersedia atau belum terhubung ke household ini." />
        ) : (
          selectedRows.map((row) => (
            <PaymentCard
              key={row.member.id}
              row={row}
              saving={savingDraft}
              onQuick={(nextRow) => openPayment(nextRow, 'quick')}
              onCustom={(nextRow) => openPayment(nextRow, 'custom')}
              onReset={resetPayment}
              onDelete={deleteDeposit}
              onPreview={setPreviewUrl}
              canManage={canManageMember(row.member)}
            />
          ))
        )}
      </section>

      <Card>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          <div>
            <h2 className="text-lg font-bold text-slate-900">Jejak setoran kita</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Lihat dan rapikan catatan setoran dari bulan-bulan sebelumnya.</p>
          </div>
          <span className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">{showAdvanced ? 'Tutup lagi' : 'Buka dulu'}</span>
        </button>

        {showAdvanced ? (
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-bold text-slate-900">Jejak setoran kita</h3>
                <Button type="button" variant="secondary" onClick={() => setShowHistoryFilter((value) => !value)}>
                  Filter
                </Button>
              </div>

              <div className={`${showHistoryFilter ? 'grid' : 'hidden'} mb-4 gap-3 md:grid-cols-5`}>
                <select className="form-input" value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>
                  <option value="all">Semua tahun</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <select className="form-input" value={filterMonth} onChange={(event) => setFilterMonth(event.target.value)}>
                  <option value="all">Semua bulan</option>
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
                <select className="form-input" value={filterMember} onChange={(event) => setFilterMember(event.target.value)}>
                  <option value="all">Kakak/Mpip</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <select className="form-input" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as DepositStatus | 'all')}>
                  <option value="all">Semua status</option>
                  {DEPOSIT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <Button type="button" variant="secondary" onClick={resetHistoryFilter}>
                  Bersihin
                </Button>
              </div>

              {filteredDeposits.length === 0 ? (
                <EmptyState title="Belum ada jejak setoran" description="Belum ada catatan setoran yang cocok dengan filter ini." />
              ) : (
                <>
                <div className="grid gap-3">
                  {visibleHistoryDeposits.map((deposit) => {
                    const member = deposit.members || members.find((item) => item.id === deposit.member_id) || null;
                    const status = getDepositStatus({
                      paidAmount: deposit.paid_amount,
                      requiredAmount: deposit.required_amount,
                      actualTransferDate: deposit.actual_transfer_date,
                      dueDate: deposit.due_date
                    });
                    const remaining = depositRemaining(deposit);
                    const row: DepositRow | null = member
                      ? {
                          member,
                          deposit,
                          year: deposit.year,
                          month: deposit.month,
                          due_date: deposit.due_date,
                          required_amount: Number(deposit.required_amount),
                          actual_transfer_date: deposit.actual_transfer_date,
                          paid_amount: Number(deposit.paid_amount || 0),
                          proof_image_url: deposit.proof_image_url,
                          status
                        }
                      : null;

                    return (
                      <div key={deposit.id} className={`content-auto rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm ${isDepositOverdue(deposit) ? 'ring-1 ring-amber-200' : ''}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-slate-900">{monthLabel(deposit.year, deposit.month)}</p>
                            <p className="mt-1 text-sm font-medium text-slate-500">{member?.name || '-'} • Due {formatDate(deposit.due_date)}</p>
                          </div>
                          <span className={`badge ${statusBadgeClass(status)}`}>{depositStatusLabel(status)}</span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                          <MiniSummaryCard label="Wajib" value={rupiah(deposit.required_amount)} />
                          <MiniSummaryCard label="Masuk" value={rupiah(deposit.paid_amount)} />
                          <MiniSummaryCard label="Sisa dikejar" value={rupiah(remaining)} />
                          <div className="rounded-[22px] bg-white p-4 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bukti</p>
                            <div className="mt-2">
                              <ProofThumbnail path={deposit.proof_image_url} onPreview={setPreviewUrl} />
                            </div>
                          </div>
                        </div>

                        {row && canManageMember(member) ? (
                          <div className="mt-3 flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => openPayment(row, 'custom')}>Edit</Button>
                            <Button type="button" variant="danger" onClick={() => deleteDeposit(deposit)}>Hapus</Button>
                          </div>
                        ) : row ? <p className="mt-3 text-right text-xs font-semibold text-slate-400">Mode lihat saja</p> : null}
                      </div>
                    );
                  })}
                </div>
                {hasMoreHistory ? (
                  <div className="mt-4 flex justify-center">
                    <Button type="button" variant="secondary" onClick={loadMoreHistory}>Muat {Math.min(12, remainingHistory)} riwayat lagi</Button>
                  </div>
                ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      <Modal
        open={monthPickerOpen}
        title="Pilih periode setoran"
        description="Pilih bulan dan tahun yang ingin dilihat."
        mobileSheet
        onClose={() => setMonthPickerOpen(false)}
      >
        <div className="space-y-4">
          <label className="form-label" htmlFor="deposit-month-picker">Bulan dan tahun</label>
          <input
            id="deposit-month-picker"
            className="form-input text-base font-semibold"
            type="month"
            min={`${MIN_DEPOSIT_YEAR}-01`}
            max={`${initialYearMonth.year}-12`}
            value={`${selectedYearMonth.year}-${String(selectedYearMonth.month).padStart(2, '0')}`}
            onChange={(event) => {
              const [year, month] = event.target.value.split('-').map(Number);
              if (year && month) setSelectedYearMonth({ year, month });
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="secondary" onClick={() => { setSelectedYearMonth(initialYearMonth); setMonthPickerOpen(false); }}>Bulan ini</Button>
            <Button type="button" onClick={() => setMonthPickerOpen(false)}>Tampilkan</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(paymentDraft)}
        title={paymentDraft ? `${paymentDraft.deposit ? 'Edit setoran' : 'Catat setoran'} ${paymentDraft.member.name}` : 'Setoran'}
        description={paymentDraft ? monthLabel(paymentDraft.year, paymentDraft.month) : undefined}
        mobileSheet
        onClose={() => (savingDraft ? undefined : setPaymentDraft(null))}
      >
        {paymentDraft ? (
          <div className="space-y-5">
            <div className="rounded-[24px] bg-blue-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#3557bf]">Target setoran</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{rupiah(paymentDraft.required_amount)}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">Batas setor {formatDate(paymentDraft.due_date)}</p>
              <p className="mt-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-[#3557bf]">Bukti transfer wajib saat nominal lebih dari Rp0.</p>
            </div>

            <div>
              <label className="form-label" htmlFor="payment-transfer-date">Tanggal transfer</label>
              <input
                id="payment-transfer-date"
                className="form-input mt-2"
                type="date"
                value={paymentDraft.actual_transfer_date}
                onChange={(event) => setPaymentDraft({ ...paymentDraft, actual_transfer_date: event.target.value })}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="payment-amount">Nominal yang masuk</label>
              <RupiahInput
                id="payment-amount"
                className="mt-2"
                value={paymentDraft.paid_amount}
                onValueChange={(value) => setPaymentDraft({ ...paymentDraft, paid_amount: value })}
                placeholder="0"
                aria-describedby="payment-amount-help"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setPaymentDraft({ ...paymentDraft, paid_amount: paymentDraft.required_amount })} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-[#3557bf]">Isi sesuai target</button>
                {paymentDraft.deposit && paymentDraft.paid_amount < paymentDraft.required_amount ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">Kekurangan {rupiah(Math.max(paymentDraft.required_amount - paymentDraft.paid_amount, 0))}</span>
                ) : null}
              </div>
              <p id="payment-amount-help" className="mt-2 text-xs font-semibold text-slate-400">Nilai ini adalah total setoran yang sudah masuk untuk periode tersebut.</p>
            </div>

            <div>
              <label className="form-label" htmlFor="payment-proof">Bukti transfer</label>
              <input
                id="payment-proof"
                className="form-input mt-2"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setPaymentDraft({ ...paymentDraft, proofFile: event.target.files?.[0] || null })}
              />
              <p className="mt-1 text-xs font-semibold text-slate-400">Wajib kalau ada nominal masuk. Upload bukti yang jelas ya, maksimal 5MB.</p>
              <LocalProofPreview file={paymentDraft.proofFile} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" variant="secondary" className="min-h-12" onClick={() => setPaymentDraft(null)} disabled={savingDraft}>
                Batal
              </Button>
              <Button type="button" className="min-h-12" onClick={savePaymentDraft} disabled={savingDraft}>
                {savingDraft ? 'Menyimpan...' : 'Simpan setoran'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel}
        tone={confirmAction?.tone}
        loading={confirmLoading}
        onClose={() => (confirmLoading ? undefined : setConfirmAction(null))}
        onConfirm={runConfirmAction}
      />

      <Modal open={Boolean(previewUrl)} title="Lihat Bukti Transfer" onClose={() => setPreviewUrl(null)}>
        {previewUrl ? <img src={previewUrl} alt="Preview bukti transfer" className="max-h-[75vh] w-full rounded-3xl object-contain" /> : null}
      </Modal>
    </main>
  );
}
