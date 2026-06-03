'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { MonthlyDeposit, OtherMutation } from '@/lib/types';
import { calculateMonthlyRecaps } from '@/lib/calculations';
import { currentYearMonth, monthLabel, rupiah } from '@/lib/format';
import { normalizeDepositStatuses } from '@/lib/depositStatus';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

function SummaryCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-[1.5rem] bg-white/70 p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-1 text-xl font-black text-stone-900">{value}</p>
      {helper ? <p className="mt-1 text-xs font-bold text-stone-400">{helper}</p> : null}
    </div>
  );
}

export default function RecapPage() {
  const { toast } = useToast();
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState('all');

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    const [depositsResult, mutationsResult] = await Promise.all([
      supabase.from('monthly_deposits').select('*, members(*)').order('year').order('month'),
      supabase.from('other_mutations').select('*').order('mutation_date')
    ]);
    if (showLoading) setLoading(false);

    if (depositsResult.error || mutationsResult.error) {
      toast({ title: 'Gagal ambil rekap', message: depositsResult.error?.message || mutationsResult.error?.message, type: 'error' });
      return;
    }

    setDeposits(normalizeDepositStatuses((depositsResult.data || []) as MonthlyDeposit[]));
    setMutations((mutationsResult.data || []) as OtherMutation[]);
  }

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel('recap-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, () => fetchData(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const recaps = useMemo(() => calculateMonthlyRecaps(deposits, mutations), [deposits, mutations]);
  const years = useMemo(() => {
    const now = currentYearMonth();
    const set = new Set<number>([2026, now.year]);
    recaps.forEach((recap) => set.add(recap.year));
    return Array.from(set).sort((a, b) => a - b);
  }, [recaps]);
  const filteredRecaps = recaps.filter((recap) => filterYear === 'all' || recap.year === Number(filterYear));

  const recapSummary = useMemo(() => {
    const latest = recaps[recaps.length - 1] || null;
    const additions = filteredRecaps.reduce((sum, item) => sum + item.additions, 0);
    const withdrawals = filteredRecaps.reduce((sum, item) => sum + item.withdrawals, 0);
    const depositsTotal = filteredRecaps.reduce((sum, item) => sum + item.totalRequiredDeposits, 0);
    return { latest, additions, withdrawals, depositsTotal, count: filteredRecaps.length };
  }, [recaps, filteredRecaps]);

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Rekap Bulanan"
        description="Rekap otomatis berubah setiap setoran atau mutasi ditambah, diedit, atau dihapus. Saldo akhir bulan dihitung kumulatif dari bulan paling awal."
      />

      <Card>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Saldo terakhir" value={rupiah(recapSummary.latest?.endingBalance || 0)} helper={recapSummary.latest ? monthLabel(recapSummary.latest.year, recapSummary.latest.month) : 'Belum ada'} />
          <SummaryCard label="Setoran masuk" value={rupiah(recapSummary.depositsTotal)} helper="Sesuai filter" />
          <SummaryCard label="Tambahan" value={rupiah(recapSummary.additions)} helper="Sesuai filter" />
          <SummaryCard label="Penarikan" value={rupiah(recapSummary.withdrawals)} helper={`${recapSummary.count} bulan`} />
        </div>

        <div className="mb-5 flex flex-col gap-3 sm:max-w-md sm:flex-row">
          <select className="form-input" value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>
            <option value="all">Semua tahun</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={() => setFilterYear('all')}>
            Reset
          </Button>
        </div>

        {filteredRecaps.length === 0 ? (
          <EmptyState title="Belum ada rekap" description="Generate setoran atau tambah mutasi dulu supaya rekap muncul." />
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {filteredRecaps.map((recap) => (
                <div key={recap.key} className="mobile-data-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-stone-900">{monthLabel(recap.year, recap.month)}</p>
                      <p className="mt-1 text-xs font-bold text-stone-400">Saldo akhir bulan</p>
                    </div>
                    <p className="text-lg font-black text-stone-900">{rupiah(recap.endingBalance)}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-blush-100/80 p-3">
                      <p className="text-xs font-black uppercase text-blush-500">Mpip</p>
                      <p className="font-black text-stone-800">{rupiah(recap.mpipDeposit)}</p>
                    </div>
                    <div className="rounded-2xl bg-skysoft-100/80 p-3">
                      <p className="text-xs font-black uppercase text-sky-400">Kakak</p>
                      <p className="font-black text-sky-700">{rupiah(recap.kakakDeposit)}</p>
                    </div>
                    <div className="rounded-2xl bg-skysoft-100/80 p-3">
                      <p className="text-xs font-black uppercase text-skysoft-500">Tambah</p>
                      <p className="font-black text-stone-800">{rupiah(recap.additions)}</p>
                    </div>
                    <div className="rounded-2xl bg-blush-100/80 p-3">
                      <p className="text-xs font-black uppercase text-blush-500">Tarik</p>
                      <p className="font-black text-stone-800">{rupiah(recap.withdrawals)}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-2xl palette-card p-3 text-sm font-black text-stone-700">
                    Total setoran masuk: {rupiah(recap.totalRequiredDeposits)}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] overflow-hidden rounded-3xl bg-white/75">
                <thead className="bg-white/90">
                  <tr>
                    <th className="table-th">Bulan</th>
                    <th className="table-th">Setoran Mpip</th>
                    <th className="table-th">Setoran Kakak</th>
                    <th className="table-th">Total Setoran Wajib Masuk</th>
                    <th className="table-th">Tambahan</th>
                    <th className="table-th">Penarikan</th>
                    <th className="table-th">Saldo Akhir Bulan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white">
                  {filteredRecaps.map((recap) => (
                    <tr key={recap.key}>
                      <td className="table-td font-black">{monthLabel(recap.year, recap.month)}</td>
                      <td className="table-td font-black text-stone-800">{rupiah(recap.mpipDeposit)}</td>
                      <td className="table-td font-black text-sky-700">{rupiah(recap.kakakDeposit)}</td>
                      <td className="table-td font-black">{rupiah(recap.totalRequiredDeposits)}</td>
                      <td className="table-td font-black text-stone-800">{rupiah(recap.additions)}</td>
                      <td className="table-td font-black text-stone-800">{rupiah(recap.withdrawals)}</td>
                      <td className="table-td font-black">{rupiah(recap.endingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
