'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { DepositStatus, Member, MonthlyDeposit } from '@/lib/types';
import {
  depositProgress,
  depositRemaining,
  getDepositStatus,
  isDepositOverdue,
  normalizeDepositStatuses,
  statusBadgeClass
} from '@/lib/depositStatus';
import { buildMonthlyDepositRows } from '@/lib/generate';
import { currentYearMonth, formatDate, monthLabel, rupiah, safeDueDate, todayInput } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/ToastProvider';

const initialYearMonth = currentYearMonth();
const DEFAULT_MEMBER_ORDER = ['Mpip', 'Kakak'];

type DepositRow = {
  member: Member;
  deposit: MonthlyDeposit | null;
  year: number;
  month: number;
  due_date: string;
  required_amount: number;
  actual_transfer_date: string | null;
  paid_amount: number;
  proof_image_url: string | null;
  status: DepositStatus;
};

type PaymentDraft = {
  member: Member;
  deposit: MonthlyDeposit | null;
  year: number;
  month: number;
  due_date: string;
  required_amount: number;
  actual_transfer_date: string;
  paid_amount: number;
  proofFile: File | null;
  mode: 'quick' | 'custom';
};

type ConfirmAction = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
};

function sortMembers(a: Member, b: Member) {
  const aIndex = DEFAULT_MEMBER_ORDER.indexOf(a.name);
  const bIndex = DEFAULT_MEMBER_ORDER.indexOf(b.name);
  if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  return a.name.localeCompare(b.name);
}

function isValidDateText(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function shiftMonth(year: number, month: number, diff: number) {
  const date = new Date(year, month - 1 + diff, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function ProofThumbnail({ path, onPreview }: { path: string | null; onPreview: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadUrl() {
      if (!path) {
        setUrl(null);
        return;
      }

      if (path.startsWith('http')) {
        setUrl(path);
        return;
      }

      const { data, error } = await supabase.storage.from('transfer-proofs').createSignedUrl(path, 60 * 60);
      if (!active) return;
      setUrl(error ? null : data?.signedUrl ?? null);
    }

    loadUrl();
    return () => {
      active = false;
    };
  }, [path]);

  if (!path) return <span className="text-xs font-semibold text-slate-400">Belum ada bukti cinta</span>;
  if (!url) return <span className="text-xs font-semibold text-slate-400">Lagi buka bukti...</span>;

  return (
    <button type="button" onClick={() => onPreview(url)} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <img src={url} alt="Bukti transfer" className="h-14 w-14 object-cover transition group-hover:scale-105" />
    </button>
  );
}

function PaymentCard({
  row,
  onQuick,
  onIsiManual,
  onBersihin,
  onDelete,
  onPreview,
  saving
}: {
  row: DepositRow;
  onQuick: (row: DepositRow) => void;
  onIsiManual: (row: DepositRow) => void;
  onBersihin: (row: DepositRow) => void;
  onDelete: (row: DepositRow) => void;
  onPreview: (url: string) => void;
  saving: boolean;
}) {
  const progress = depositProgress({ paid_amount: row.paid_amount, required_amount: row.required_amount });
  const remaining = depositRemaining({ paid_amount: row.paid_amount, required_amount: row.required_amount });
  const overdue = isDepositOverdue({ paid_amount: row.paid_amount, required_amount: row.required_amount, due_date: row.due_date });
  const hasPayment = row.paid_amount > 0;

  return (
    <div className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm md:rounded-[28px] md:p-5" style={{ boxShadow: '0 12px 30px rgba(52, 77, 147, 0.10)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="badge text-slate-700" style={{ backgroundColor: row.member.color || (row.member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>
            {row.member.name}
          </span>
          <p className="mt-3 text-[26px] font-bold leading-tight text-slate-900 md:text-2xl">{rupiah(row.required_amount)}</p>
          <p className="mt-1 text-sm font-medium text-slate-500">Batas setor {formatDate(row.due_date)}</p>
        </div>
        <span className={`badge ${statusBadgeClass(row.status)}`}>{row.status}</span>
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Udah masuk</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{rupiah(row.paid_amount)}</p>
          </div>
          <p className="text-sm font-semibold text-[#3557bf]">{progress}%</p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-[#4267d6]" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
          <span>TF: {formatDate(row.actual_transfer_date)}</span>
          {remaining > 0 ? <span className="text-[#b44967]">• Kurang dikit {rupiah(remaining)}</span> : null}
          {overdue ? <span className="text-amber-700">• Telat dikit</span> : null}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ProofThumbnail path={row.proof_image_url} onPreview={onPreview} />
        <div className="grid w-full grid-cols-[1fr_1fr_auto] items-center gap-2 sm:w-auto">
          <Button type="button" variant={remaining > 0 ? 'primary' : 'secondary'} className="w-full px-3" onClick={() => onQuick(row)} disabled={saving}>
            {remaining > 0 ? 'Transfer' : 'Bukti'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onIsiManual(row)} disabled={saving}>
            Isi manual
          </Button>
          <details className="action-menu">
            <summary>•••</summary>
            <div className="action-menu-panel space-y-2">
              <Button type="button" variant="secondary" className="w-full" onClick={() => onIsiManual(row)}>
                Edit
              </Button>
              {hasPayment || row.proof_image_url ? (
                <Button type="button" variant="secondary" className="w-full" onClick={() => onBersihin(row)}>
                  Bersihin
                </Button>
              ) : null}
              {row.deposit ? (
                <Button type="button" variant="danger" className="w-full" onClick={() => onDelete(row)}>
                  Hapus
                </Button>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function LocalProofPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file]);

  if (!file || !url) return null;

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-500">Preview bukti yang mau disimpan</p>
      <img src={url} alt="Preview bukti transfer baru" className="max-h-48 w-full rounded-2xl object-contain bg-white" />
      <p className="mt-2 text-xs font-semibold text-slate-400">{file.name}</p>
    </div>
  );
}

function MiniSummaryCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-[22px] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {helper ? <p className="mt-1 text-xs font-medium text-slate-400">{helper}</p> : null}
    </div>
  );
}

function validatePaymentDraft(draft: PaymentDraft | null) {
  if (!draft) return 'Setoran belum dipilih, sayang.';

  const paidAmount = Number(draft.paid_amount || 0);
  const requiredAmount = Number(draft.required_amount || 0);
  const hasExistingProof = Boolean(draft.deposit?.proof_image_url);
  const hasNewProof = Boolean(draft.proofFile);

  if (!Number.isFinite(requiredAmount) || requiredAmount <= 0) return 'Nominal wajibnya belum valid.';
  if (!Number.isFinite(paidAmount) || paidAmount < 0) return 'Nominal yang masuk tidak boleh minus.';
  if (paidAmount > 1000000000) return 'Nominal yang masuk terlalu besar. Maksimal Rp1.000.000.000.';
  if (paidAmount > 0 && !draft.actual_transfer_date) return 'Tanggal transfer sayang wajib diisi kalau nominal masuk lebih dari 0.';
  if (draft.actual_transfer_date && !isValidDateText(draft.actual_transfer_date)) return 'Tanggal transfer sayang tidak valid.';
  if (draft.actual_transfer_date && draft.actual_transfer_date > todayInput()) return 'Tanggal transfer sayang tidak boleh lebih dari hari ini.';
  if (paidAmount > 0 && !hasExistingProof && !hasNewProof) return 'Foto bukti transfer wajib diupload kalau nominal masuk lebih dari 0.';
  if (paidAmount <= 0 && hasNewProof) return 'Nominal yang masuk harus lebih dari 0 kalau upload bukti TF.';
  if (draft.proofFile && !draft.proofFile.type.startsWith('image/')) return 'Foto bukti transfer wajib berupa file gambar.';
  if (draft.proofFile && draft.proofFile.size > 5 * 1024 * 1024) return 'Ukuran foto bukti TF maksimal 5MB ya.';

  return null;
}

function getPaymentDraftWarnings(draft: PaymentDraft) {
  const warnings: string[] = [];
  const paidAmount = Number(draft.paid_amount || 0);
  const requiredAmount = Number(draft.required_amount || 0);

  if (paidAmount > requiredAmount) {
    warnings.push(`Nominal yang masuk lebih besar dari setoran wajib. Kelebihan ${rupiah(paidAmount - requiredAmount)} bakal ikut bikin saldo cinta kita makin gemuk.`);
  }

  if (draft.actual_transfer_date && isValidDateText(draft.actual_transfer_date)) {
    const [transferYear, transferMonth] = draft.actual_transfer_date.split('-').map(Number);
    if (transferYear !== draft.year || transferMonth !== draft.month) {
      warnings.push(`Tanggal transfer sayang berada di luar periode ${monthLabel(draft.year, draft.month)}. Kalau lanjut, data tetap dicatat ke bulan yang dipilih.`);
    }
  }

  if (paidAmount > 0 && paidAmount < requiredAmount) {
    warnings.push(`Nominal yang masuk kurang ${rupiah(requiredAmount - paidAmount)} dari setoran wajib. Status akan menjadi Kurang dikit.`);
  }

  return warnings;
}


export default function DepositsPage() {
  const { toast } = useToast();
  const today = todayInput();
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedYearMonth, setSelectedYearMonth] = useState(initialYearMonth);
  const [generateYear, setGenerateYear] = useState(initialYearMonth.year);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistoryFilter, setShowHistoryFilter] = useState(false);

  const [filterYear, setFilterYear] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterMember, setFilterMember] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    const [membersResult, depositsResult] = await Promise.all([
      supabase.from('members').select('*').order('name'),
      supabase.from('monthly_deposits').select('*, members(*)').order('year').order('month').order('due_date')
    ]);
    if (showLoading) setLoading(false);

    if (membersResult.error || depositsResult.error) {
      toast({ title: 'Gagal ambil setoran', message: membersResult.error?.message || depositsResult.error?.message, type: 'error' });
      return;
    }

    setMembers(((membersResult.data || []) as Member[]).sort(sortMembers));
    setDeposits(normalizeDepositStatuses((depositsResult.data || []) as MonthlyDeposit[]));
  }

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel('deposits-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => fetchData(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
    const status = paid <= 0 ? 'Belum Lengkap' : paid < target ? 'Belum Lengkap' : paid === target ? 'Lengkap' : 'Lebih';

    return { target, paid, remaining, progress, completeCount, status };
  }, [selectedRows]);

  const years = useMemo(() => {
    const set = new Set<number>([2026, initialYearMonth.year, generateYear, selectedYearMonth.year]);
    deposits.forEach((deposit) => set.add(deposit.year));
    return Array.from(set).sort((a, b) => a - b);
  }, [deposits, generateYear, selectedYearMonth.year]);

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

  function changeMonth(diff: number) {
    setSelectedYearMonth((current) => shiftMonth(current.year, current.month, diff));
  }

  function resetHistoryFilter() {
    setFilterYear('all');
    setFilterMonth('all');
    setFilterMember('all');
    setFilterStatus('all');
    setShowHistoryFilter(false);
  }

  function openPayment(row: DepositRow, mode: 'quick' | 'custom') {
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
    const maxMb = 5;
    if (!file.type.startsWith('image/')) throw new Error('File bukti transfer harus gambar.');
    if (file.size > maxMb * 1024 * 1024) throw new Error(`Ukuran foto maksimal ${maxMb}MB.`);
  }

  async function uploadProof(file: File, depositId: string, oldPath?: string | null) {
    validateFile(file);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${depositId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('transfer-proofs').upload(path, file, {
      cacheControl: '3600',
      upsert: true
    });

    if (error) throw error;

    if (oldPath && !oldPath.startsWith('http')) {
      await supabase.storage.from('transfer-proofs').remove([oldPath]);
    }

    return path;
  }

  async function persistPaymentDraft(draft: PaymentDraft) {
    setSavingDraft(true);

    try {
      const status = getDepositStatus({
        paidAmount: draft.paid_amount,
        requiredAmount: draft.required_amount,
        actualTransferDate: draft.actual_transfer_date || null,
        dueDate: draft.due_date
      });

      const payload = {
        member_id: draft.member.id,
        year: draft.year,
        month: draft.month,
        due_date: draft.due_date,
        required_amount: Number(draft.required_amount),
        actual_transfer_date: Number(draft.paid_amount || 0) > 0 ? draft.actual_transfer_date : null,
        paid_amount: Number(draft.paid_amount || 0),
        status
      };

      const { data, error } = await supabase
        .from('monthly_deposits')
        .upsert(payload, { onConflict: 'member_id,year,month' })
        .select()
        .single();

      if (error) throw error;

      if (draft.proofFile && data?.id) {
        const proofPath = await uploadProof(draft.proofFile, data.id, data.proof_image_url);
        const { error: updateError } = await supabase.from('monthly_deposits').update({ proof_image_url: proofPath }).eq('id', data.id);
        if (updateError) throw updateError;
      }

      toast({
        title: draft.mode === 'quick' ? 'Setoran berhasil dicatat' : 'Setoran berhasil disimpan',
        message: `${draft.member.name} ${monthLabel(draft.year, draft.month)} berhasil masuk ke tabungan kita.`,
        type: 'success'
      });
      setPaymentDraft(null);
      fetchData(false);
    } catch (error) {
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
    const deposit = row.deposit;
    if (!deposit) return;

    setConfirmAction({
      title: 'Bersihin setoran?',
      description: `Setoran ${row.member.name} ${monthLabel(row.year, row.month)} akan dikosongkan lagi. Nominal yang masuk, tanggal transfer, dan foto bukti akan dihapus.`,
      confirmLabel: 'Iya, reset',
      tone: 'danger',
      onConfirm: async () => {
        if (row.proof_image_url && !row.proof_image_url.startsWith('http')) {
          const { error: storageError } = await supabase.storage.from('transfer-proofs').remove([row.proof_image_url]);
          if (storageError) throw storageError;
        }

        const { error } = await supabase
          .from('monthly_deposits')
          .update({
            actual_transfer_date: null,
            paid_amount: 0,
            proof_image_url: null,
            status: 'Belum Dibayar'
          })
          .eq('id', deposit.id);

        if (error) throw error;
        toast({ title: 'Setoran berhasil direset', type: 'success' });
        fetchData(false);
      }
    });
  }

  function deleteDeposit(row: DepositRow | MonthlyDeposit) {
    const deposit = 'deposit' in row ? row.deposit : row;
    const memberName = 'member' in row ? row.member.name : row.members?.name || 'Anggota';
    const year = row.year;
    const month = row.month;

    if (!deposit) return;

    const hasPayment = Number(deposit.paid_amount || 0) > 0;
    const hasProof = Boolean(deposit.proof_image_url);

    setConfirmAction({
      title: 'Hapus setoran ini?',
      description: `Setoran ${memberName} ${monthLabel(year, month)} akan dihapus permanen.${hasPayment ? ' Nominal yang masuk yang sudah tercatat juga ikut hilang.' : ''}${hasProof ? ' Foto bukti transfer juga akan dihapus dari Storage.' : ''}`,
      confirmLabel: 'Iya, hapus',
      tone: 'danger',
      onConfirm: async () => {
        if (deposit.proof_image_url && !deposit.proof_image_url.startsWith('http')) {
          const { error: storageError } = await supabase.storage.from('transfer-proofs').remove([deposit.proof_image_url]);
          if (storageError) throw storageError;
        }

        const { error } = await supabase.from('monthly_deposits').delete().eq('id', deposit.id);
        if (error) throw error;

        toast({ title: 'Setoran berhasil dihapus', type: 'success' });
        fetchData(false);
      }
    });
  }

  async function runGenerate(rowsType: '24-months' | 'year' | 'selected-month') {
    if (members.length === 0) {
      toast({ title: 'Data Kakak/Mpip belum ada', message: 'Jalankan SQL seed dulu supaya data Kakak dan Mpip muncul.', type: 'error' });
      return;
    }

    let rows = buildMonthlyDepositRows(members, 2026, 6, 24);
    if (rowsType === 'year') rows = buildMonthlyDepositRows(members, generateYear, 1, 12);
    if (rowsType === 'selected-month') rows = buildMonthlyDepositRows(members, selectedYearMonth.year, selectedYearMonth.month, 1);

    const memberIds = members.map((member) => member.id);
    const rowYears = Array.from(new Set(rows.map((row) => row.year)));

    setGenerating(true);
    const { data: existingRows, error: existingError } = await supabase
      .from('monthly_deposits')
      .select('member_id, year, month')
      .in('member_id', memberIds)
      .in('year', rowYears);

    if (existingError) {
      setGenerating(false);
      toast({ title: 'Generate setoran gagal', message: existingError.message, type: 'error' });
      return;
    }

    const existingKeys = new Set((existingRows || []).map((row) => `${row.member_id}-${row.year}-${row.month}`));
    const rowsToInsert = rows.filter((row) => !existingKeys.has(`${row.member_id}-${row.year}-${row.month}`));

    if (rowsToInsert.length === 0) {
      setGenerating(false);
      toast({ title: 'Belum ada yang perlu dibuat', message: 'Setoran periode ini sudah ada semua, jadi aman nggak ada yang diubah.', type: 'info' });
      return;
    }

    const { error } = await supabase.from('monthly_deposits').insert(rowsToInsert);
    setGenerating(false);

    if (error) {
      toast({ title: 'Generate setoran gagal', message: error.message, type: 'error' });
      return;
    }

    toast({
      title: 'Setoran berhasil disiapkan',
      message: `${rowsToInsert.length} data baru dibuat. Data lama tetap aman.`,
      type: 'success'
    });
    fetchData(false);
  }

  function generate(rowsType: '24-months' | 'year' | 'selected-month') {
    if (rowsType === 'year' && (!Number.isInteger(Number(generateYear)) || Number(generateYear) < 2026 || Number(generateYear) > 2100)) {
      toast({ title: 'Tahun belum valid', message: 'Isi tahun antara 2026 sampai 2100.', type: 'error' });
      return;
    }

    const label =
      rowsType === '24-months'
        ? '24 bulan mulai Juni 2026'
        : rowsType === 'year'
          ? `tahun ${generateYear}`
          : monthLabel(selectedYearMonth.year, selectedYearMonth.month);

    setConfirmAction({
      title: 'Siapkan setoran?',
      description: `Generate setoran ${label}. Data yang sudah ada nggak akan disentuh.`,
      confirmLabel: 'Ya, generate',
      tone: 'primary',
      onConfirm: () => runGenerate(rowsType)
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
        title="Nabung Bareng"
        description="Pilih bulan, terus catat setoran Kakak atau Mpip. Bukti TF wajib biar sama-sama tenang."
      />

      <Card className="overflow-hidden !bg-[#4267d6] !p-4 text-white md:!p-5">
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" onClick={() => changeMonth(-1)} className="h-11 w-11 rounded-full p-0">
            ‹
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Bulan kita</p>
            <p className="mt-1 text-[28px] font-bold leading-tight md:text-3xl">{monthLabel(selectedYearMonth.year, selectedYearMonth.month)}</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => changeMonth(1)} className="h-11 w-11 rounded-full p-0">
            ›
          </Button>
        </div>

        <div className="mt-4 rounded-[22px] bg-white/12 p-4 md:mt-6 md:rounded-[24px]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white/75">Terkumpul bulan ini</p>
              <p className="mt-1 text-[30px] font-bold leading-tight md:text-3xl">{rupiah(monthSummary.paid)}</p>
              <p className="mt-1 text-xs font-medium text-white/70">Target cinta {rupiah(monthSummary.target)} • Sisa dikejar {rupiah(monthSummary.remaining)}</p>
            </div>
            <div className="text-right">
              <p className="text-[30px] font-bold leading-tight md:text-3xl">{monthSummary.progress}%</p>
              <p className="text-xs font-medium text-white/70">{monthSummary.status}</p>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20 md:h-3">
            <div className="h-full rounded-full bg-white" style={{ width: `${monthSummary.progress}%` }} />
          </div>
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-2">
        {selectedRows.length === 0 ? (
          <EmptyState title="Anggota belum ada" description="Jalankan SQL seed supaya data Kakak dan Mpip dibuat." />
        ) : (
          selectedRows.map((row) => (
            <PaymentCard
              key={row.member.id}
              row={row}
              saving={savingDraft}
              onQuick={(nextRow) => openPayment(nextRow, 'quick')}
              onIsiManual={(nextRow) => openPayment(nextRow, 'custom')}
              onBersihin={resetPayment}
              onDelete={deleteDeposit}
              onPreview={setPreviewUrl}
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
            <h2 className="text-lg font-bold text-slate-900">Riwayat & Tools</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Buat cek cerita setoran lama, generate data, atau benerin yang salah input.</p>
          </div>
          <span className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">{showAdvanced ? 'Tutup lagi' : 'Buka dulu'}</span>
        </button>

        {showAdvanced ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-[24px] bg-slate-50 p-4">
              <h3 className="font-bold text-slate-900">Siapkan data setoran</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">Aman diklik berkali-kali, data yang sudah ada nggak akan keganggu.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Button type="button" onClick={() => generate('selected-month')} disabled={generating}>
                  Siapkan bulan ini
                </Button>
                <Button type="button" variant="secondary" onClick={() => generate('24-months')} disabled={generating}>
                  Siapkan 24 bulan
                </Button>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input className="form-input" type="number" value={generateYear} onChange={(event) => setGenerateYear(Number(event.target.value))} />
                  <Button type="button" variant="secondary" onClick={() => generate('year')} disabled={generating}>
                    Tahun
                  </Button>
                </div>
              </div>
            </div>

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
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>
                      {month}
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
                  <option value="Belum Dibayar">Belum Dibayar</option>
                  <option value="Kurang dikit">Kurang dikit</option>
                  <option value="Terbayar">Terbayar</option>
                  <option value="Terbayar Telat">Terbayar Telat</option>
                </select>
                <Button type="button" variant="secondary" onClick={resetHistoryFilter}>
                  Bersihin
                </Button>
              </div>

              {filteredDeposits.length === 0 ? (
                <EmptyState title="Belum ada jejak setoran" description="Siapkan data dulu atau langsung catat dari card Kakak/Mpip." />
              ) : (
                <div className="grid gap-3">
                  {filteredDeposits.map((deposit) => {
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
                      <div key={deposit.id} className={`rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm ${isDepositOverdue(deposit) ? 'ring-1 ring-amber-200' : ''}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-slate-900">{monthLabel(deposit.year, deposit.month)}</p>
                            <p className="mt-1 text-sm font-medium text-slate-500">{member?.name || '-'} • Due {formatDate(deposit.due_date)}</p>
                          </div>
                          <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
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

                        {row ? (
                          <div className="mt-3 flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={() => openPayment(row, 'custom')}>
                              Edit
                            </Button>
                            <Button type="button" variant="danger" onClick={() => deleteDeposit(deposit)}>
                              Hapus
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      <Modal open={Boolean(paymentDraft)} title={paymentDraft ? `${paymentDraft.mode === 'quick' ? 'Udah transfer' : 'Isi manual Setoran'} ${paymentDraft.member.name}` : 'Setoran'} onClose={() => (savingDraft ? undefined : setPaymentDraft(null))}>
        {paymentDraft ? (
          <div className="space-y-5">
            <div className="rounded-[24px] bg-blue-50 p-4">
              <p className="text-sm font-semibold text-[#3557bf]">{monthLabel(paymentDraft.year, paymentDraft.month)}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{rupiah(paymentDraft.required_amount)}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">Batas setor {formatDate(paymentDraft.due_date)}</p>
              <p className="mt-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-[#3557bf]">Bukti TF wajib ya sayang, biar tabungan kita jelas dan saling percaya.</p>
            </div>

            <div>
              <label className="form-label">Tanggal transfer sayang</label>
              <input
                className="form-input mt-2"
                type="date"
                value={paymentDraft.actual_transfer_date}
                onChange={(event) => setPaymentDraft({ ...paymentDraft, actual_transfer_date: event.target.value })}
              />
            </div>

            <div>
              <label className="form-label">Nominal yang masuk</label>
              <input
                className="form-input mt-2"
                type="number"
                value={paymentDraft.paid_amount}
                min={0}
                onChange={(event) => setPaymentDraft({ ...paymentDraft, paid_amount: Number(event.target.value) })}
              />
              <p className="mt-1 text-xs font-semibold text-slate-400">Preview: {rupiah(paymentDraft.paid_amount)}</p>
            </div>

            <div>
              <label className="form-label">Foto bukti transfer</label>
              <input
                className="form-input mt-2"
                type="file"
                accept="image/*"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setPaymentDraft({ ...paymentDraft, proofFile: event.target.files?.[0] || null })}
              />
              <p className="mt-1 text-xs font-semibold text-slate-400">Wajib kalau ada nominal masuk. Upload bukti yang jelas ya, maksimal 5MB.</p>
              <LocalProofPreview file={paymentDraft.proofFile} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" variant="secondary" className="min-h-12" onClick={() => setPaymentDraft(null)} disabled={savingDraft}>
                Nanti dulu
              </Button>
              <Button type="button" className="min-h-12" onClick={savePaymentDraft} disabled={savingDraft}>
                {savingDraft ? 'Lagi disimpan...' : 'Simpan sayang'}
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
