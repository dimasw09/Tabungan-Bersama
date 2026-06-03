'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { DepositStatus, Member, MonthlyDeposit } from '@/lib/types';
import {
  depositProgress,
  depositRemaining,
  getComputedDepositStatus,
  getDepositStatus,
  isDepositOverdue,
  normalizeDepositStatuses,
  statusBadgeClass
} from '@/lib/depositStatus';
import { calculateFilteredDepositSummary } from '@/lib/calculations';
import { buildMonthlyDepositRows } from '@/lib/generate';
import { currentYearMonth, formatDate, monthLabel, rupiah, safeDueDate, todayInput } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/ToastProvider';

const initialYearMonth = currentYearMonth();
const today = todayInput();

const emptyForm = {
  member_id: '',
  year: initialYearMonth.year,
  month: initialYearMonth.month,
  due_date: safeDueDate(initialYearMonth.year, initialYearMonth.month, 10),
  required_amount: 0,
  actual_transfer_date: '',
  paid_amount: 0,
  proofFile: null as File | null
};

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

  if (!path) return <span className="text-xs font-bold text-stone-400">Belum ada</span>;
  if (!url) return <span className="text-xs font-bold text-stone-400">Loading foto...</span>;

  return (
    <button type="button" onClick={() => onPreview(url)} className="group overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
      <img src={url} alt="Bukti transfer" className="h-14 w-14 object-cover transition group-hover:scale-105" />
    </button>
  );
}

function MiniSummaryCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-[1.5rem] bg-white/65 p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-1 text-lg font-black text-stone-900">{value}</p>
      {helper ? <p className="mt-1 text-xs font-bold text-stone-400">{helper}</p> : null}
    </div>
  );
}

export default function DepositsPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<MonthlyDeposit | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quickSavingId, setQuickSavingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generateYear, setGenerateYear] = useState(initialYearMonth.year);

  const [filterYear, setFilterYear] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterMember, setFilterMember] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

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

    const nextMembers = (membersResult.data || []) as Member[];
    setMembers(nextMembers);
    setDeposits(normalizeDepositStatuses((depositsResult.data || []) as MonthlyDeposit[]));

    if (!form.member_id && nextMembers.length > 0) {
      const first = nextMembers[0];
      setForm((current) => ({
        ...current,
        member_id: first.id,
        required_amount: Number(first.monthly_amount),
        due_date: safeDueDate(current.year, current.month, Number(first.payday))
      }));
    }
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

  const years = useMemo(() => {
    const set = new Set<number>([2026, initialYearMonth.year, generateYear]);
    deposits.forEach((deposit) => set.add(deposit.year));
    return Array.from(set).sort((a, b) => a - b);
  }, [deposits, generateYear]);

  const filteredDeposits = useMemo(() => {
    return deposits.filter((deposit) => {
      const computedStatus = getComputedDepositStatus(deposit);
      if (filterYear !== 'all' && deposit.year !== Number(filterYear)) return false;
      if (filterMonth !== 'all' && deposit.month !== Number(filterMonth)) return false;
      if (filterMember !== 'all' && deposit.member_id !== filterMember) return false;
      if (filterStatus !== 'all' && computedStatus !== filterStatus) return false;
      return true;
    });
  }, [deposits, filterYear, filterMonth, filterMember, filterStatus]);

  const summary = useMemo(() => calculateFilteredDepositSummary(filteredDeposits), [filteredDeposits]);

  const statusPreview = getDepositStatus({
    paidAmount: form.paid_amount,
    requiredAmount: form.required_amount,
    actualTransferDate: form.actual_transfer_date || null,
    dueDate: form.due_date
  });

  function patchFormByMember(memberId: string, year = form.year, month = form.month) {
    const member = members.find((item) => item.id === memberId);
    setForm((current) => ({
      ...current,
      member_id: memberId,
      year,
      month,
      required_amount: member ? Number(member.monthly_amount) : current.required_amount,
      due_date: member ? safeDueDate(year, month, Number(member.payday)) : current.due_date
    }));
  }

  function patchFormYearMonth(year: number, month: number) {
    const member = members.find((item) => item.id === form.member_id);
    setForm((current) => ({
      ...current,
      year,
      month,
      due_date: member ? safeDueDate(year, month, Number(member.payday)) : current.due_date
    }));
  }

  function resetForm() {
    const first = members[0];
    const base = { ...emptyForm, proofFile: null };
    if (first) {
      setForm({
        ...base,
        member_id: first.id,
        required_amount: Number(first.monthly_amount),
        due_date: safeDueDate(base.year, base.month, Number(first.payday))
      });
    } else {
      setForm(base);
    }
    setEditing(null);
  }

  function resetFilters() {
    setFilterYear('all');
    setFilterMonth('all');
    setFilterMember('all');
    setFilterStatus('all');
  }

  function startEdit(deposit: MonthlyDeposit) {
    setEditing(deposit);
    setForm({
      member_id: deposit.member_id,
      year: deposit.year,
      month: deposit.month,
      due_date: deposit.due_date,
      required_amount: Number(deposit.required_amount),
      actual_transfer_date: deposit.actual_transfer_date || '',
      paid_amount: Number(deposit.paid_amount || 0),
      proofFile: null
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.member_id || !form.year || !form.month || !form.due_date || Number(form.required_amount) <= 0) {
      toast({ title: 'Data setoran belum valid', message: 'Anggota, bulan, jatuh tempo, dan nominal wajib harus diisi.', type: 'error' });
      return;
    }

    if (Number(form.paid_amount) < 0) {
      toast({ title: 'Nominal masuk belum valid', message: 'Nominal masuk tidak boleh minus.', type: 'error' });
      return;
    }

    setSaving(true);
    const status = getDepositStatus({
      paidAmount: form.paid_amount,
      requiredAmount: form.required_amount,
      actualTransferDate: form.actual_transfer_date || null,
      dueDate: form.due_date
    });

    try {
      const payload = {
        member_id: form.member_id,
        year: Number(form.year),
        month: Number(form.month),
        due_date: form.due_date,
        required_amount: Number(form.required_amount),
        actual_transfer_date: form.actual_transfer_date || null,
        paid_amount: Number(form.paid_amount || 0),
        status
      };

      if (editing) {
        let proofPath = editing.proof_image_url;
        if (form.proofFile) proofPath = await uploadProof(form.proofFile, editing.id, editing.proof_image_url);
        const { error } = await supabase.from('monthly_deposits').update({ ...payload, proof_image_url: proofPath }).eq('id', editing.id);
        if (error) throw error;
        toast({ title: 'Setoran berhasil diupdate', type: 'success' });
      } else {
        const { data, error } = await supabase
          .from('monthly_deposits')
          .upsert(payload, { onConflict: 'member_id,year,month' })
          .select()
          .single();
        if (error) throw error;

        if (form.proofFile && data?.id) {
          const proofPath = await uploadProof(form.proofFile, data.id, data.proof_image_url);
          const { error: updateError } = await supabase.from('monthly_deposits').update({ proof_image_url: proofPath }).eq('id', data.id);
          if (updateError) throw updateError;
        }
        toast({ title: 'Setoran berhasil disimpan', message: 'Kalau periode sudah ada, datanya otomatis diupdate.', type: 'success' });
      }

      resetForm();
      fetchData(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi error tidak diketahui.';
      toast({ title: editing ? 'Gagal update setoran' : 'Gagal tambah setoran', message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function quickMarkPaid(deposit: MonthlyDeposit) {
    setQuickSavingId(deposit.id);
    const status = getDepositStatus({
      paidAmount: deposit.required_amount,
      requiredAmount: deposit.required_amount,
      actualTransferDate: today,
      dueDate: deposit.due_date
    });

    const { error } = await supabase
      .from('monthly_deposits')
      .update({
        paid_amount: Number(deposit.required_amount),
        actual_transfer_date: today,
        status
      })
      .eq('id', deposit.id);
    setQuickSavingId(null);

    if (error) {
      toast({ title: 'Gagal lunaskan setoran', message: error.message, type: 'error' });
      return;
    }

    toast({ title: 'Setoran ditandai lunas', message: `${deposit.members?.name || 'Anggota'} ${monthLabel(deposit.year, deposit.month)} sudah lunas.`, type: 'success' });
    fetchData(false);
  }

  async function deleteDeposit(deposit: MonthlyDeposit) {
    if (!window.confirm(`Hapus setoran ${deposit.members?.name || ''} ${monthLabel(deposit.year, deposit.month)}?`)) return;

    if (deposit.proof_image_url && !deposit.proof_image_url.startsWith('http')) {
      await supabase.storage.from('transfer-proofs').remove([deposit.proof_image_url]);
    }

    const { error } = await supabase.from('monthly_deposits').delete().eq('id', deposit.id);
    if (error) {
      toast({ title: 'Gagal hapus setoran', message: error.message, type: 'error' });
      return;
    }

    toast({ title: 'Setoran berhasil dihapus', type: 'success' });
    fetchData(false);
  }

  async function generate(rowsType: '24-months' | 'year' | 'current-month') {
    if (members.length === 0) {
      toast({ title: 'Belum ada anggota', message: 'Jalankan SQL seed dulu supaya Kakak dan Mpip ada.', type: 'error' });
      return;
    }

    let rows = buildMonthlyDepositRows(members, 2026, 6, 24);
    if (rowsType === 'year') rows = buildMonthlyDepositRows(members, generateYear, 1, 12);
    if (rowsType === 'current-month') rows = buildMonthlyDepositRows(members, initialYearMonth.year, initialYearMonth.month, 1);

    setGenerating(true);
    const { error } = await supabase.from('monthly_deposits').upsert(rows, {
      onConflict: 'member_id,year,month',
      ignoreDuplicates: true
    });
    setGenerating(false);

    if (error) {
      toast({ title: 'Generate setoran gagal', message: error.message, type: 'error' });
      return;
    }

    toast({ title: 'Generate setoran selesai', message: 'Periode yang sudah ada otomatis dilewati.', type: 'success' });
    fetchData(false);
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Setoran Bulanan"
        description="Kelola setoran wajib bulanan, tanggal transfer aktual, nominal masuk, status pembayaran, dan foto bukti transfer. Di HP tampil card biar lebih enak."
      />

      <div className="grid gap-5 xl:grid-cols-[440px_1fr]">
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-black text-stone-900">Generate Setoran</h2>
            <p className="mt-2 text-sm font-semibold text-stone-500">Generate aman dijalankan berkali-kali. Periode yang sudah ada tidak akan dibuat duplicate.</p>
            <div className="mt-5 space-y-3">
              <Button type="button" className="w-full" onClick={() => generate('24-months')} disabled={generating}>
                {generating ? 'Generate...' : 'Generate 24 bulan dari Juni 2026'}
              </Button>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input className="form-input" type="number" value={generateYear} onChange={(event) => setGenerateYear(Number(event.target.value))} />
                <Button type="button" variant="secondary" onClick={() => generate('year')} disabled={generating}>
                  Generate Tahun
                </Button>
              </div>
              <Button type="button" className="w-full" variant="secondary" onClick={() => generate('current-month')} disabled={generating}>
                Generate Bulan Berjalan
              </Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-stone-900">{editing ? 'Edit Setoran' : 'Input Setoran'}</h2>
                <p className="mt-1 text-sm font-semibold text-stone-500">Periode yang sudah ada akan otomatis diupdate.</p>
              </div>
              <span className={`badge ${statusBadgeClass(statusPreview)}`}>{statusPreview}</span>
            </div>

            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="form-label">Nama anggota</label>
                <select className="form-input mt-2" value={form.member_id} onChange={(event) => patchFormByMember(event.target.value)}>
                  <option value="">Pilih anggota</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Tahun</label>
                  <input className="form-input mt-2" type="number" value={form.year} onChange={(event) => patchFormYearMonth(Number(event.target.value), form.month)} />
                </div>
                <div>
                  <label className="form-label">Bulan</label>
                  <select className="form-input mt-2" value={form.month} onChange={(event) => patchFormYearMonth(form.year, Number(event.target.value))}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                      <option key={month} value={month}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">Tanggal jatuh tempo</label>
                <input className="form-input mt-2" type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
              </div>
              <div>
                <label className="form-label">Nominal wajib</label>
                <input className="form-input mt-2" type="number" value={form.required_amount} onChange={(event) => setForm({ ...form, required_amount: Number(event.target.value) })} min={0} />
                <p className="mt-1 text-xs font-bold text-stone-400">Preview: {rupiah(form.required_amount)}</p>
              </div>
              <div>
                <label className="form-label">Tanggal transfer aktual</label>
                <input className="form-input mt-2" type="date" value={form.actual_transfer_date} onChange={(event) => setForm({ ...form, actual_transfer_date: event.target.value })} />
              </div>
              <div>
                <label className="form-label">Nominal masuk</label>
                <input className="form-input mt-2" type="number" value={form.paid_amount} onChange={(event) => setForm({ ...form, paid_amount: Number(event.target.value) })} min={0} />
                <p className="mt-1 text-xs font-bold text-stone-400">Preview: {rupiah(form.paid_amount)}</p>
              </div>
              <div>
                <label className="form-label">Foto bukti TF</label>
                <input className="form-input mt-2" type="file" accept="image/*" onChange={(event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, proofFile: event.target.files?.[0] || null })} />
                <p className="mt-1 text-xs font-bold text-stone-400">Format gambar, maksimal 5MB. {editing?.proof_image_url ? 'Kosongkan kalau tidak mau ganti foto.' : ''}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                  {saving ? 'Menyimpan...' : editing ? 'Update setoran' : 'Simpan setoran'}
                </Button>
                {editing ? (
                  <Button type="button" variant="secondary" onClick={resetForm} className="w-full sm:w-auto">
                    Batal
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>
        </div>

        <Card>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniSummaryCard label="Total wajib" value={rupiah(summary.required)} helper={`${summary.count} baris`} />
            <MiniSummaryCard label="Sudah masuk" value={rupiah(summary.paid)} />
            <MiniSummaryCard label="Sisa kurang" value={rupiah(summary.remaining)} />
            <MiniSummaryCard label="Perlu dicek" value={`${summary.problemCount}`} helper={`${summary.lateCount} telat`} />
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-5">
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
              <option value="all">Semua anggota</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <select className="form-input" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as DepositStatus | 'all')}>
              <option value="all">Semua status</option>
              <option value="Belum Dibayar">Belum Dibayar</option>
              <option value="Kurang">Kurang</option>
              <option value="Terbayar">Terbayar</option>
              <option value="Terbayar Telat">Terbayar Telat</option>
            </select>
            <Button type="button" variant="secondary" onClick={resetFilters}>
              Reset filter
            </Button>
          </div>

          {filteredDeposits.length === 0 ? (
            <EmptyState title="Belum ada setoran" description="Generate data awal atau tambah setoran manual dulu." />
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {filteredDeposits.map((deposit) => {
                  const computedStatus = getComputedDepositStatus(deposit);
                  const progress = depositProgress(deposit);
                  const remaining = depositRemaining(deposit);
                  const overdue = isDepositOverdue(deposit);

                  return (
                    <div key={deposit.id} className="mobile-data-card">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-black text-stone-900">{monthLabel(deposit.year, deposit.month)}</p>
                          <span className="mt-2 badge text-stone-700" style={{ backgroundColor: deposit.members?.color || '#f5f5f4' }}>
                            {deposit.members?.name || '-'}
                          </span>
                        </div>
                        <span className={`badge ${statusBadgeClass(computedStatus)}`}>{computedStatus}</span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl palette-card p-3">
                          <p className="text-xs font-black uppercase text-stone-400">Wajib</p>
                          <p className="font-black text-stone-900">{rupiah(deposit.required_amount)}</p>
                        </div>
                        <div className="rounded-2xl palette-card p-3">
                          <p className="text-xs font-black uppercase text-stone-400">Masuk</p>
                          <p className="font-black text-stone-900">{rupiah(deposit.paid_amount)}</p>
                        </div>
                      </div>

                      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white">
                        <div className="h-full rounded-full bg-gradient-to-r from-blush-300 to-skysoft-300" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-stone-500">
                        <span>Due {formatDate(deposit.due_date)}</span>
                        <span>•</span>
                        <span>TF {formatDate(deposit.actual_transfer_date)}</span>
                        {remaining > 0 ? <span className="text-rose-600">• Kurang {rupiah(remaining)}</span> : null}
                        {overdue ? <span className="text-amber-700">• Lewat jatuh tempo</span> : null}
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <ProofThumbnail path={deposit.proof_image_url} onPreview={setPreviewUrl} />
                        <div className="flex flex-wrap justify-end gap-2">
                          {remaining > 0 ? (
                            <Button type="button" variant="success" onClick={() => quickMarkPaid(deposit)} disabled={quickSavingId === deposit.id}>
                              Lunas
                            </Button>
                          ) : null}
                          <Button type="button" variant="secondary" onClick={() => startEdit(deposit)}>
                            Edit
                          </Button>
                          <Button type="button" variant="danger" onClick={() => deleteDeposit(deposit)}>
                            Hapus
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1180px] overflow-hidden rounded-3xl bg-white/75">
                  <thead className="bg-white/90">
                    <tr>
                      <th className="table-th">Bulan</th>
                      <th className="table-th">Nama anggota</th>
                      <th className="table-th">Jatuh tempo</th>
                      <th className="table-th">Nominal wajib</th>
                      <th className="table-th">Tanggal TF aktual</th>
                      <th className="table-th">Nominal masuk</th>
                      <th className="table-th">Foto bukti TF</th>
                      <th className="table-th">Status</th>
                      <th className="table-th">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white">
                    {filteredDeposits.map((deposit) => {
                      const computedStatus = getComputedDepositStatus(deposit);
                      const remaining = depositRemaining(deposit);

                      return (
                        <tr key={deposit.id} className={isDepositOverdue(deposit) ? 'bg-amber-50/70' : ''}>
                          <td className="table-td font-black">{monthLabel(deposit.year, deposit.month)}</td>
                          <td className="table-td">
                            <span className="badge text-stone-700" style={{ backgroundColor: deposit.members?.color || '#f5f5f4' }}>
                              {deposit.members?.name || '-'}
                            </span>
                          </td>
                          <td className="table-td">{formatDate(deposit.due_date)}</td>
                          <td className="table-td font-black">{rupiah(deposit.required_amount)}</td>
                          <td className="table-td">{formatDate(deposit.actual_transfer_date)}</td>
                          <td className="table-td font-black">{rupiah(deposit.paid_amount)}</td>
                          <td className="table-td">
                            <ProofThumbnail path={deposit.proof_image_url} onPreview={setPreviewUrl} />
                          </td>
                          <td className="table-td">
                            <span className={`badge ${statusBadgeClass(computedStatus)}`}>{computedStatus}</span>
                          </td>
                          <td className="table-td">
                            <div className="flex gap-2">
                              {remaining > 0 ? (
                                <Button type="button" variant="success" onClick={() => quickMarkPaid(deposit)} disabled={quickSavingId === deposit.id}>
                                  Lunas
                                </Button>
                              ) : null}
                              <Button type="button" variant="secondary" onClick={() => startEdit(deposit)}>
                                Edit
                              </Button>
                              <Button type="button" variant="danger" onClick={() => deleteDeposit(deposit)}>
                                Hapus
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal open={Boolean(previewUrl)} title="Preview Bukti Transfer" onClose={() => setPreviewUrl(null)}>
        {previewUrl ? <img src={previewUrl} alt="Preview bukti transfer" className="max-h-[75vh] w-full rounded-3xl object-contain" /> : null}
      </Modal>
    </main>
  );
}
