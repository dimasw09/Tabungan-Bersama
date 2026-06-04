'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { MutationType, MonthlyDeposit, OtherMutation } from '@/lib/types';
import { currentYearMonth, formatDate, monthLabel, rupiah, todayInput } from '@/lib/format';
import { calculateMonthlyRecaps } from '@/lib/calculations';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/ToastProvider';

const emptyForm = {
  mutation_date: todayInput(),
  type: 'Tambah' as MutationType,
  amount: 0,
  description: ''
};

function SummaryCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'text-stone-800' : tone === 'red' ? 'text-stone-800' : 'text-slate-900';
  return (
    <div className="rounded-[1.5rem] bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

type ConfirmAction = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
};

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

export default function MutationsPage() {
  const { toast } = useToast();
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<OtherMutation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterYear, setFilterYear] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showSimpleForm, setShowSimpleForm] = useState(false);
  const [showSimpleFilter, setShowSimpleFilter] = useState(false);

  async function fetchMutations(showLoading = true) {
    if (showLoading) setLoading(true);
    const [mutationsResult, depositsResult] = await Promise.all([
      supabase.from('other_mutations').select('*').order('mutation_date', { ascending: false }),
      supabase.from('monthly_deposits').select('*')
    ]);
    if (showLoading) setLoading(false);

    if (mutationsResult.error || depositsResult.error) {
      toast({ title: 'Gagal ambil data', message: mutationsResult.error?.message || depositsResult.error?.message, type: 'error' });
      return;
    }

    setMutations((mutationsResult.data || []) as OtherMutation[]);
    setDeposits((depositsResult.data || []) as MonthlyDeposit[]);
  }

  useEffect(() => {
    fetchMutations();

    const channel = supabase
      .channel('mutations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, () => fetchMutations(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const years = useMemo(() => {
    const now = currentYearMonth();
    const set = new Set<number>([now.year, 2026]);
    mutations.forEach((mutation) => set.add(new Date(`${mutation.mutation_date}T00:00:00`).getFullYear()));
    return Array.from(set).sort((a, b) => a - b);
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

  const summary = useMemo(() => {
    const additions = filteredMutations.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = filteredMutations.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      additions,
      withdrawals,
      net: additions - withdrawals,
      count: filteredMutations.length
    };
  }, [filteredMutations]);

  const currentBalance = useMemo(() => {
    const depositsTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.paid_amount || 0), 0);
    const additions = mutations.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = mutations.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return depositsTotal + additions - withdrawals;
  }, [deposits, mutations]);

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

  function resetForm() {
    setForm(emptyForm);
    setEditing(null);
    setShowSimpleForm(false);
  }

  function resetFilters() {
    setFilterYear('all');
    setFilterMonth('all');
    setFilterType('all');
    setSearch('');
    setShowSimpleFilter(false);
  }

  function startEdit(mutation: OtherMutation) {
    setEditing(mutation);
    setForm({
      mutation_date: mutation.mutation_date,
      type: mutation.type,
      amount: Number(mutation.amount),
      description: mutation.description || ''
    });
    setShowSimpleForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(form.amount);
    const description = form.description.trim();

    if (!form.mutation_date || !isValidDateText(form.mutation_date)) {
      toast({ title: 'Tanggal mutasi belum valid', message: 'Tanggal wajib diisi dengan format tanggal valid.', type: 'error' });
      return;
    }

    if (form.mutation_date > todayInput()) {
      toast({ title: 'Tanggal mutasi belum valid', message: 'Tanggal mutasi tidak boleh lebih dari hari ini.', type: 'error' });
      return;
    }

    if (!['Tambah', 'Penarikan'].includes(form.type)) {
      toast({ title: 'Tipe mutasi belum valid', message: 'Tipe harus Tambah atau Penarikan.', type: 'error' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Nominal mutasi belum valid', message: 'Nominal wajib lebih dari 0.', type: 'error' });
      return;
    }

    if (amount > 1_000_000_000) {
      toast({ title: 'Nominal terlalu besar', message: 'Cek lagi nominalnya, maksimal 1 miliar per mutasi.', type: 'error' });
      return;
    }

    if (description.length > 160) {
      toast({ title: 'Keterangan terlalu panjang', message: 'Maksimal 160 karakter biar rekap tetap rapi.', type: 'error' });
      return;
    }

    if (form.type === 'Penarikan' && description.length === 0) {
      toast({ title: 'Keterangan wajib diisi', message: 'Penarikan wajib punya keterangan supaya jelas uangnya dipakai untuk apa.', type: 'error' });
      return;
    }

    const balanceWithoutCurrentMutation = (() => {
      const depositsTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.paid_amount || 0), 0);
      const otherRows = mutations.filter((mutation) => mutation.id !== editing?.id);
      const additions = otherRows.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const withdrawals = otherRows.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return depositsTotal + additions - withdrawals;
    })();

    if (form.type === 'Penarikan' && amount > balanceWithoutCurrentMutation) {
      toast({
        title: 'Saldo tidak cukup',
        message: `Saldo tersedia ${rupiah(balanceWithoutCurrentMutation)}, penarikan tidak boleh lebih besar dari saldo.`,
        type: 'error'
      });
      return;
    }

    const nextMutation = {
      id: editing?.id || 'preview',
      mutation_date: form.mutation_date,
      type: form.type,
      amount,
      description: description || null,
      created_at: editing?.created_at || '',
      updated_at: editing?.updated_at || ''
    } as OtherMutation;

    const nextMutations = [...mutations.filter((mutation) => mutation.id !== editing?.id), nextMutation];
    const negativeRecap = calculateMonthlyRecaps(deposits, nextMutations).find((recap) => recap.endingBalance < 0);

    if (negativeRecap) {
      toast({
        title: 'Rekap jadi minus',
        message: `Saldo akhir ${monthLabel(negativeRecap.year, negativeRecap.month)} akan menjadi ${rupiah(negativeRecap.endingBalance)}. Ubah nominal/tanggal mutasi dulu.`,
        type: 'error'
      });
      return;
    }

    setSaving(true);
    const payload = {
      mutation_date: form.mutation_date,
      type: form.type,
      amount,
      description: description || null
    };

    const result = editing
      ? await supabase.from('other_mutations').update(payload).eq('id', editing.id)
      : await supabase.from('other_mutations').insert(payload);

    setSaving(false);

    if (result.error) {
      toast({ title: editing ? 'Gagal update mutasi' : 'Gagal tambah mutasi', message: result.error.message, type: 'error' });
      return;
    }

    toast({ title: editing ? 'Mutasi berhasil diupdate' : 'Mutasi berhasil ditambah', type: 'success' });
    resetForm();
    fetchMutations(false);
  }

  function deleteMutation(mutation: OtherMutation) {
    setConfirmAction({
      title: 'Hapus mutasi?',
      description: `Mutasi ${mutation.type} ${rupiah(mutation.amount)} tanggal ${formatDate(mutation.mutation_date)} akan dihapus permanen dan saldo rekap ikut berubah.`,
      confirmLabel: 'Ya, hapus mutasi',
      tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('other_mutations').delete().eq('id', mutation.id);
        if (error) throw error;

        toast({ title: 'Mutasi berhasil dihapus', type: 'success' });
        fetchMutations(false);
      }
    });
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Mutasi Lain"
        description="Catat transaksi di luar setoran wajib. Tipe Tambah menaikkan saldo, Penarikan mengurangi saldo. Filter dan search langsung ngaruh ke ringkasan."
      />

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card className={`${showSimpleForm || editing ? 'block' : 'hidden'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{editing ? 'Edit Mutasi' : 'Tambah Mutasi'}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">Isi transaksi tambahan atau penarikan.</p>
            </div>
            <span className={`badge ${form.type === 'Tambah' ? 'bg-emerald-100 text-stone-800' : 'bg-rose-100 text-stone-800'}`}>{form.type}</span>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="form-label">Tanggal</label>
              <input className="form-input mt-2" type="date" value={form.mutation_date} onChange={(event) => setForm({ ...form, mutation_date: event.target.value })} />
            </div>
            <div>
              <label className="form-label">Tipe</label>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: 'Tambah' })}
                  className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${form.type === 'Tambah' ? 'bg-emerald-100 text-stone-800 ring-2 ring-emerald-200' : 'bg-white/90 text-slate-500'}`}
                >
                  Tambah
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: 'Penarikan' })}
                  className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${form.type === 'Penarikan' ? 'bg-rose-100 text-stone-800 ring-2 ring-rose-200' : 'bg-white/90 text-slate-500'}`}
                >
                  Penarikan
                </button>
              </div>
            </div>
            <div>
              <label className="form-label">Nominal</label>
              <input className="form-input mt-2" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} min={1} />
              <p className="mt-1 text-xs font-bold text-slate-400">Preview: {rupiah(form.amount)}</p>
            </div>
            <div>
              <label className="form-label">Keterangan</label>
              <textarea className="form-input mt-2 min-h-28" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Contoh: bonus, hadiah, ambil buat kebutuhan... Penarikan wajib ada keterangan." />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                {saving ? 'Menyimpan...' : editing ? 'Update mutasi' : 'Simpan mutasi'}
              </Button>
              {editing ? (
                <Button type="button" variant="secondary" onClick={resetForm} className="w-full sm:w-auto">
                  Batal
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Tambah" value={rupiah(summary.additions)} tone="green" />
            <SummaryCard label="Penarikan" value={rupiah(summary.withdrawals)} tone="red" />
            <SummaryCard label="Net" value={rupiah(summary.net)} tone={summary.net < 0 ? 'red' : 'green'} />
            <SummaryCard label="Saldo sekarang" value={rupiah(currentBalance)} tone={currentBalance < 0 ? 'red' : 'green'} />
            <SummaryCard label="Jumlah data" value={`${summary.count}`} />
          </div>

          <div className={`${showSimpleFilter ? 'grid' : 'hidden'} mb-5 gap-3 md:grid-cols-5`}>
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
            <select className="form-input" value={filterType} onChange={(event) => setFilterType(event.target.value)}>
              <option value="all">Semua tipe</option>
              <option value="Tambah">Tambah</option>
              <option value="Penarikan">Penarikan</option>
            </select>
            <input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search keterangan..." />
            <Button type="button" variant="secondary" onClick={resetFilters}>
              Reset filter
            </Button>
          </div>

          {filteredMutations.length === 0 ? (
            <EmptyState title="Belum ada mutasi" description="Tambahkan transaksi tambahan atau penarikan dulu." />
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {filteredMutations.map((mutation) => (
                  <div key={mutation.id} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`badge ${mutation.type === 'Tambah' ? 'bg-emerald-100 text-stone-800' : 'bg-rose-100 text-stone-800'}`}>{mutation.type}</span>
                        <p className="mt-3 text-2xl font-bold text-slate-900">{rupiah(mutation.amount)}</p>
                      </div>
                      <p className="text-xs font-bold text-slate-400">{formatDate(mutation.mutation_date)}</p>
                    </div>
                    <p className="mt-3 rounded-2xl palette-card p-3 text-sm font-semibold text-stone-600">{mutation.description || '-'}</p>
                    <div className="mt-4 flex justify-end">
                      <details className="action-menu">
                        <summary>Action</summary>
                        <div className="action-menu-panel space-y-2">
                          <Button type="button" variant="secondary" className="w-full" onClick={() => startEdit(mutation)}>
                            Edit
                          </Button>
                          <Button type="button" variant="danger" className="w-full" onClick={() => deleteMutation(mutation)}>
                            Hapus
                          </Button>
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] overflow-hidden rounded-3xl bg-white/75">
                  <thead className="bg-white/90">
                    <tr>
                      <th className="table-th">Tanggal</th>
                      <th className="table-th">Tipe</th>
                      <th className="table-th">Nominal</th>
                      <th className="table-th">Keterangan</th>
                      <th className="table-th">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white">
                    {filteredMutations.map((mutation) => (
                      <tr key={mutation.id}>
                        <td className="table-td font-bold">{formatDate(mutation.mutation_date)}</td>
                        <td className="table-td">
                          <span className={`badge ${mutation.type === 'Tambah' ? 'bg-emerald-100 text-stone-800' : 'bg-rose-100 text-stone-800'}`}>
                            {mutation.type}
                          </span>
                        </td>
                        <td className="table-td font-bold">{rupiah(mutation.amount)}</td>
                        <td className="table-td max-w-xs truncate">{mutation.description || '-'}</td>
                        <td className="table-td">
                          <div className="flex gap-2">
                            <Button type="button" variant="secondary" onClick={() => startEdit(mutation)}>
                              Edit
                            </Button>
                            <Button type="button" variant="danger" onClick={() => deleteMutation(mutation)}>
                              Hapus
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

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

    </main>
  );
}
