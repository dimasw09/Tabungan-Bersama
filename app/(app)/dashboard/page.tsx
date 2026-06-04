'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Member, MonthlyDeposit, OtherMutation } from '@/lib/types';
import { calculateCurrentMonthStats, calculateMemberMonthStats, calculateTotals } from '@/lib/calculations';
import { formatDate, monthLabel, rupiah } from '@/lib/format';
import { normalizeDepositStatus, statusBadgeClass } from '@/lib/depositStatus';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';

function StatCard({ icon, label, value, helper }: { icon: string; label: string; value: string; helper?: string }) {
  return (
    <Card className="relative overflow-hidden ">
      <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-blue-50" />
      <div className="relative">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-lg shadow-sm md:mb-4 md:h-11 md:w-11 md:text-xl">{icon}</div>
        <p className="text-sm font-semibold text-slate-500">{label}</p>
        <p className="mt-2 text-xl font-bold text-slate-900 md:text-2xl">{value}</p>
        {helper ? <p className="mt-2 text-xs font-medium text-slate-400">{helper}</p> : null}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    const [membersResult, depositsResult, mutationsResult] = await Promise.all([
      supabase.from('members').select('*').order('name'),
      supabase.from('monthly_deposits').select('*, members(*)').order('year').order('month'),
      supabase.from('other_mutations').select('*').order('mutation_date')
    ]);

    if (showLoading) setLoading(false);

    if (membersResult.error || depositsResult.error || mutationsResult.error) {
      toast({ title: 'Gagal ambil dashboard', message: membersResult.error?.message || depositsResult.error?.message || mutationsResult.error?.message, type: 'error' });
      return;
    }

    setMembers((membersResult.data || []) as Member[]);
    setDeposits(((depositsResult.data || []) as MonthlyDeposit[]).map((deposit) => normalizeDepositStatus(deposit)));
    setMutations((mutationsResult.data || []) as OtherMutation[]);
  }

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => fetchData(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const totals = useMemo(() => calculateTotals(deposits, mutations), [deposits, mutations]);
  const currentMonth = useMemo(() => calculateCurrentMonthStats(members, deposits), [members, deposits]);
  const memberProgress = useMemo(() => calculateMemberMonthStats(members, deposits, currentMonth.year, currentMonth.month), [members, deposits, currentMonth.year, currentMonth.month]);
  const progressWidth = Math.min(currentMonth.progress, 100);
  const recentMutations = mutations.slice().sort((a, b) => b.mutation_date.localeCompare(a.mutation_date)).slice(0, 4);
  const unpaidThisMonth = memberProgress.filter((item) => item.remaining > 0);

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Rumah Tabungan Kita"
        description="Tempat kecil buat lihat usaha Kakak dan Mpip ngumpulin masa depan bareng."
      />

      {members.length === 0 ? (
        <EmptyState title="Belum ada anggota" description="Jalankan SQL seed supaya data Kakak dan Mpip dibuat otomatis." />
      ) : (
        <>
          <section className="mb-5 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
            <Card className="relative overflow-hidden p-6 md:p-8">
              <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-blush-100/70" />
              <div className="absolute -bottom-20 right-24 h-56 w-56 rounded-full bg-skysoft-100/80" />
              <div className="relative">
                <p className="inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
                  Saldo Sekarang
                </p>
                <h2 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">{rupiah(totals.balance)}</h2>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-stone-500">
                  Saldo dihitung dari semua setoran masuk + mutasi tambah - penarikan. Cocok buat dipantau berdua dari link yang sama.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Link href="/deposits">
                    <Button className="w-full">Nabung</Button>
                  </Link>
                  <Link href="/mutations">
                    <Button variant="secondary" className="w-full">Cerita uang</Button>
                  </Link>
                </div>
              </div>
            </Card>

            <Card>
              <p className="text-sm font-semibold text-slate-500">Status perjuangan {monthLabel(currentMonth.year, currentMonth.month)}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold text-slate-900">{currentMonth.progress}%</p>
                  <p className="mt-1 text-xs font-medium text-slate-400">{rupiah(currentMonth.paid)} / {rupiah(currentMonth.target)}</p>
                </div>
                <span
                  className={`badge ${
                    currentMonth.status === 'Kompak'
                      ? 'bg-white text-[#3557bf] ring-1 ring-white/50'
                      : currentMonth.status === 'Lebih manis'
                        ? 'bg-white/80 text-[#3557bf] ring-1 ring-white/50'
                        : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                  }`}
                >
                  {currentMonth.status}
                </span>
              </div>
              <div className="mt-5 h-4 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-gradient-to-r from-blush-300 via-creamsoft-200 to-skysoft-300 transition-all" style={{ width: `${progressWidth}%` }} />
              </div>
              {unpaidThisMonth.length > 0 ? (
                <div className="mt-5 rounded-3xl bg-amber-50/80 p-4 text-sm font-semibold text-amber-800">
                  Masih kurang {rupiah(currentMonth.remaining)} bulan ini.
                </div>
              ) : (
                <div className="mt-5 rounded-3xl bg-blue-50 p-4 text-sm font-medium text-[#3557bf]">
                  Bulan ini aman, setoran sudah lengkap 💖
                </div>
              )}
            </Card>
          </section>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatCard icon="💰" label="Saldo cinta kita" value={rupiah(totals.balance)} helper="Nabung + tambahan - penarikan" />
            <StatCard icon="📥" label="Nabung wajib terkumpul" value={rupiah(totals.totalDeposits)} />
            <StatCard icon="✨" label="Tambahan rezeki" value={rupiah(totals.totalAdditions)} />
            <StatCard icon="📤" label="Terpakai buat kita" value={rupiah(totals.totalWithdrawals)} />
          </section>

          <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_420px]">
            <Card>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-stone-900">Progress Kakak & Mpip</h2>
                  <p className="mt-1 text-sm font-semibold text-stone-500">Biar kelihatan siapa yang udah setor bulan ini.</p>
                </div>
                <span className="hidden rounded-full bg-white/80 px-3 py-1 text-xs font-black text-stone-500 sm:inline-flex">
                  {monthLabel(currentMonth.year, currentMonth.month)}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {memberProgress.map((item) => (
                  <div key={item.member.id} className="rounded-[1.75rem] border border-white/80 bg-white/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="badge text-stone-700" style={{ backgroundColor: item.member.color || '#f5f5f4' }}>
                        {item.member.name}
                      </span>
                      <span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide text-stone-400">Masuk</p>
                        <p className="mt-1 text-xl font-black text-stone-900">{rupiah(item.paid)}</p>
                      </div>
                      <p className="text-sm font-semibold text-slate-500">{item.progress}%</p>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-gradient-to-r from-blush-300 via-creamsoft-200 to-skysoft-300" style={{ width: `${item.progress}%` }} />
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-bold text-stone-500">
                      <span>Wajib {rupiah(item.required)}</span>
                      <span>Kurang {rupiah(item.remaining)}</span>
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-400">Jatuh tempo: {formatDate(item.deposit?.due_date)}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="text-lg font-black text-stone-900">Cerita uang terbaru</h2>
              <p className="mt-1 text-sm font-semibold text-stone-500">Catatan kecil selain setoran wajib kita.</p>

              {recentMutations.length === 0 ? (
                <div className="mt-5 rounded-3xl bg-white/60 p-4 text-sm font-semibold text-stone-500">Belum ada cerita tambahan, tabungan masih aman manis.</div>
              ) : (
                <div className="mt-5 space-y-3">
                  {recentMutations.map((mutation) => (
                    <div key={mutation.id} className="rounded-3xl bg-white/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`badge ${mutation.type === 'Tambah' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{mutation.type}</span>
                        <span className="text-sm font-black text-stone-900">{rupiah(mutation.amount)}</span>
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-400">{formatDate(mutation.mutation_date)}</p>
                      <p className="mt-1 line-clamp-2 text-sm font-semibold text-stone-600">{mutation.description || '-'}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
