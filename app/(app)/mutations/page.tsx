'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { MonthlyDeposit, OtherMutation as ImportedOtherMutation } from '@/lib/types';
import { currentYearMonth, formatDate, monthLabel, rupiah, todayInput } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/ToastProvider';

type MutationType = 'Tambah rezeki' | 'Kepakai';

type OtherMutation = Omit<ImportedOtherMutation, 'type'> & { type: MutationType };

const emptyForm = {
  mutation_date: todayInput(),
  type: 'Tambah rezeki' as MutationType,
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

function calculateMonthlyRecaps(deposits: MonthlyDeposit[], mutations: OtherMutation[]) {
  const buckets = new Map<string, { year: number; month: number; totalDeposits: number; additions: number; withdrawals: number }>();

  function ensureBucket(year: number, month: number) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!buckets.has(key)) {
      buckets.set(key, { year, month, totalDeposits: 0, additions: 0, withdrawals: 0 });
    }
    return buckets.get(key)!;
  }

  deposits.forEach((deposit) => {
    const bucket = ensureBucket(deposit.year, deposit.month);
    bucket.totalDeposits += Number(deposit.paid_amount || 0);
  });

  mutations.forEach((mutation) => {
    const date = new Date(`${mutation.mutation_date}T00:00:00`);
    const bucket = ensureBucket(date.getFullYear(), date.getMonth() + 1);
    const amount = Number(mutation.amount || 0);

    if (mutation.type === 'Tambah rezeki') bucket.additions += amount;
    if (mutation.type === 'Kepakai') bucket.withdrawals += amount;
  });

  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.year - b.year || a.month - b.month);
  let runningBalance = 0;

  return sortedBuckets.map((bucket) => {
    runningBalance += bucket.totalDeposits + bucket.additions - bucket.withdrawals;
    return { year: bucket.year, month: bucket.month, endingBalance: runningBalance };
  });
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
    const additions = filteredMutations.filter((item) => item.type === 'Tambah rezeki').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = filteredMutations.filter((item) => item.type === 'Kepakai').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      additions,
      withdrawals,
      net: additions - withdrawals,
      count: filteredMutations.length
    };
  }, [filteredMutations]);

  const currentBalance = useMemo(() => {
    const depositsTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.paid_amount || 0), 0);
    const additions = mutations.filter((item) => item.type === 'Tambah rezeki').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawals = mutations.filter((item) => item.type === 'Kepakai').reduce((sum, item) => sum + Number(item.amount || 0), 0);
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
      toast({ title: 'Tanggal ceritanya belum valid', message: 'Tanggal wajib diisi dengan benar ya.', type: 'error' });
      return;
    }

    if (form.mutation_date > todayInput()) {
      toast({ title: 'Tanggal ceritanya belum valid', message: 'Tanggal cerita nggak boleh lebih dari hari ini.', type: 'error' });
      return;
    }

    if (!['Tambah rezeki', 'Kepakai'].includes(form.type)) {
      toast({ title: 'Tipe cerita belum valid', message: 'Tipe harus Tambah rezeki atau Kepakai.', type: 'error' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Nominalnya mutasi belum valid', message: 'Nominalnya wajib lebih dari 0.', type: 'error' });
      return;
    }

    if (amount > 1_000_000_000) {
      toast({ title: 'Nominalnya terlalu besar', message: 'Cek lagi nominalnya ya, maksimal 1 miliar per cerita.', type: 'error' });
      return;
    }

    if (description.length > 160) {
      toast({ title: 'Keterangan manis terlalu panjang', message: 'Maksimal 160 karakter biar tetap rapi.', type: 'error' });
      return;
    }

    if (form.type === 'Kepakai' && description.length === 0) {
      toast({ title: 'Keterangan manis wajib diisi', message: 'Kepakai wajib punya keterangan supaya jelas uangnya dipakai untuk apa.', type: 'error' });
      return;
    }

    const balanceWithoutCurrentMutation = (() => {
      const depositsTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.paid_amount || 0), 0);
      const otherRows = mutations.filter((mutation) => mutation.id !== editing?.id);
      const additions = otherRows.filter((item) => item.type === 'Tambah rezeki').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const withdrawals = otherRows.filter((item) => item.type === 'Kepakai').reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return depositsTotal + additions - withdrawals;
    })();

    if (form.type === 'Kepakai' && amount > balanceWithoutCurrentMutation) {
      toast({
        title: 'Saldo belum cukup',
        message: `Saldo tersedia ${rupiah(balanceWithoutCurrentMutation)}, uang yang kepakai nggak boleh lebih besar dari saldo.`,
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
        title: 'Saldo bulan jadi minus',
        message: `Saldo akhir ${monthLabel(negativeRecap.year, negativeRecap.month)} akan menjadi ${rupiah(negativeRecap.endingBalance)}. Coba ubah nominal atau tanggalnya dulu ya.`,
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
      toast({ title: editing ? 'Gagal update cerita' : 'Gagal tambah cerita', message: result.error.message, type: 'error' });
      return;
    }

    toast({ title: editing ? 'Cerita berhasil diupdate' : 'Cerita berhasil ditambah', type: 'success' });
    resetForm();
    fetchMutations(false);
  }

  function deleteMutation(mutation: OtherMutation) {
    setConfirmAction({
      title: 'Hapus cerita ini?',
      description: `Mutasi ${mutation.type} ${rupiah(mutation.amount)} tanggal ${formatDate(mutation.mutation_date)} akan dihapus permanen dan saldo rekap ikut berubah.`,
      confirmLabel: 'Iya, hapus cerita',
      tone: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('other_mutations').delete().eq('id', mutation.id);
        if (error) throw error;

        toast({ title: 'Cerita berhasil dihapus', type: 'success' });
        fetchMutations(false);
      }
    });
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Cerita Uang Kita"
        description="Catat tambahan rezeki atau uang yang kepakai, biar saldo kita tetap jujur dan jelas."
      />

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card className={`${showSimpleForm || editing ? 'block' : 'hidden'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{editing ? 'Edit cerita' : 'Tambah rezeki cerita'}</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">Isi cerita uang yang masuk atau kepakai.</p>
            </div>
            <span className={`badge ${form.type === 'Tambah rezeki' ? 'bg-emerald-100 text-stone-800' : 'bg-rose-100 text-stone-800'}`}>{form.type}</span>
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
                  onClick={() => setForm({ ...form, type: 'Tambah rezeki' })}
                  className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${form.type === 'Tambah rezeki' ? 'bg-emerald-100 text-stone-800 ring-2 ring-emerald-200' : 'bg-white/90 text-slate-500'}`}
                >
                  Tambah rezeki
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: 'Kepakai' })}
                  className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${form.type === 'Kepakai' ? 'bg-rose-100 text-stone-800 ring-2 ring-rose-200' : 'bg-white/90 text-slate-500'}`}
                >
                  Kepakai
                </button>
              </div>
            </div>
            <div>
              <label className="form-label">Nominalnya</label>
              <input className="form-input mt-2" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} min={1} />
              <p className="mt-1 text-xs font-bold text-slate-400">Preview: {rupiah(form.amount)}</p>
            </div>
            <div>
              <label className="form-label">Keterangan manis</label>
              <textarea className="form-input mt-2 min-h-28" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Contoh: bonus, hadiah, ambil buat kebutuhan... Kepakai wajib ada keterangan." />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                {saving ? 'Lagi disimpan...' : editing ? 'Update cerita' : 'Simpan cerita'}
              </Button>
              {editing ? (
                <Button type="button" variant="secondary" onClick={resetForm} className="w-full sm:w-auto">
                  Nanti dulu
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Tambah rezeki" value={rupiah(summary.additions)} tone="green" />
            <SummaryCard label="Kepakai" value={rupiah(summary.withdrawals)} tone="red" />
            <SummaryCard label="Net" value={rupiah(summary.net)} tone={summary.net < 0 ? 'red' : 'green'} />
            <SummaryCard label="Saldo cinta" value={rupiah(currentBalance)} tone={currentBalance < 0 ? 'red' : 'green'} />
            <SummaryCard label="Jumlah cerita" value={`${summary.count}`} />
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
              <option value="Tambah rezeki">Tambah rezeki</option>
              <option value="Kepakai">Kepakai</option>
            </select>
            <input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari cerita..." />
            <Button type="button" variant="secondary" onClick={resetFilters}>
              Reset filter
            </Button>
          </div>

          {filteredMutations.length === 0 ? (
            <EmptyState title="Belum ada cerita uang" description="Tambah rezekikan transaksi tambahan atau penarikan dulu." />
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {filteredMutations.map((mutation) => (
                  <div key={mutation.id} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`badge ${mutation.type === 'Tambah rezeki' ? 'bg-emerald-100 text-stone-800' : 'bg-rose-100 text-stone-800'}`}>{mutation.type}</span>
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
                      <th className="table-th">Nominalnya</th>
                      <th className="table-th">Keterangan manis</th>
                      <th className="table-th">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white">
                    {filteredMutations.map((mutation) => (
                      <tr key={mutation.id}>
                        <td className="table-td font-bold">{formatDate(mutation.mutation_date)}</td>
                        <td className="table-td">
                          <span className={`badge ${mutation.type === 'Tambah rezeki' ? 'bg-emerald-100 text-stone-800' : 'bg-rose-100 text-stone-800'}`}>
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
