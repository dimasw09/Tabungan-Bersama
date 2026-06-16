'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Member, MonthlyDeposit, OtherMutation } from '@/lib/types';
import { calculateCurrentMonthStats, calculateMemberMonthStats, calculateTotals, monthlyProgressLabel } from '@/lib/calculations';
import { formatDate, monthLabel, rupiah } from '@/lib/format';
import { depositStatusLabel, normalizeDepositStatuses, statusBadgeClass } from '@/lib/depositStatus';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { AppIcon } from '@/components/ui/AppIcon';
import { AnimatedNumber, AnimatedRupiah } from '@/components/ui/AnimatedNumber';
import { anniversaryCountdown } from '@/lib/loveCapsule';

function MetricCard({ icon, label, value, helper }: { icon: 'wallet' | 'arrow-down' | 'arrow-up'; label: string; value: number; helper: string }) {
  return (
    <Card className="relative overflow-hidden !p-4 md:!p-5">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-50" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#4267d6]">
          <AppIcon name={icon} size={21} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 truncate text-xl font-bold text-slate-900 md:text-2xl"><AnimatedRupiah value={value} /></p>
          <p className="mt-1 text-xs font-medium text-slate-400">{helper}</p>
        </div>
      </div>
    </Card>
  );
}

function transactionLabel(type: string) {
  return type === 'Tambah' ? 'Tambah rezeki' : 'Kepakai buat kita';
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const [membersResult, depositsResult, mutationsResult] = await Promise.all([
      supabase.from('members').select('*').order('name'),
      supabase.from('monthly_deposits').select('*, members(*)').is('deleted_at', null).order('year').order('month'),
      supabase.from('other_mutations').select('*').is('deleted_at', null).order('mutation_date')
    ]);

    if (showLoading) setLoading(false);
    if (membersResult.error || depositsResult.error || mutationsResult.error) {
      toast({ title: 'Gagal memuat beranda', message: membersResult.error?.message || depositsResult.error?.message || mutationsResult.error?.message, type: 'error' });
      return;
    }

    setMembers((membersResult.data || []) as Member[]);
    setDeposits(normalizeDepositStatuses((depositsResult.data || []) as MonthlyDeposit[]));
    setMutations((mutationsResult.data || []) as OtherMutation[]);
  }, [toast]);

  useEffect(() => {
    fetchData();
    const scheduleRefresh = () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = setTimeout(() => { void fetchData(false); }, 240);
    };
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, scheduleRefresh)
      .subscribe();
    return () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  const totals = useMemo(() => calculateTotals(deposits, mutations), [deposits, mutations]);
  const currentMonth = useMemo(() => calculateCurrentMonthStats(members, deposits), [members, deposits]);
  const memberProgress = useMemo(() => calculateMemberMonthStats(members, deposits, currentMonth.year, currentMonth.month), [members, deposits, currentMonth.year, currentMonth.month]);
  const progressWidth = Math.min(currentMonth.progress, 100);
  const recentMutations = mutations.slice().sort((a, b) => b.mutation_date.localeCompare(a.mutation_date)).slice(0, 4);
  const isMonthComplete = currentMonth.status === 'COMPLETE' || currentMonth.status === 'OVERPAID';
  const anniversary = useMemo(() => anniversaryCountdown(), []);

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader title="Beranda" description="Ringkasan tabungan Kakak dan Mpip hari ini." />

      {members.length === 0 ? (
        <EmptyState title="Belum ada anggota" description="Data Kakak dan Mpip belum tersedia atau belum terhubung ke household ini." />
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <Card className="love-sheen relative overflow-hidden !bg-[#4267d6] !p-6 text-white md:!p-8">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10" />
              <div className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-white/5" />
              <div className="relative">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Total saldo</p>
                <h2 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl"><AnimatedRupiah value={totals.balance} duration={1100} /></h2>
                <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-white/75">Semua setoran dan cerita uang kita sudah dihitung otomatis.</p>
                <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-md">
                  <Link prefetch={false} href="/deposits" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-[#3557bf] transition hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-white/30">
                    <AppIcon name="wallet" size={19} /> Catat setoran
                  </Link>
                  <Link prefetch={false} href="/mutations" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 px-4 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/25 focus:outline-none focus:ring-4 focus:ring-white/30">
                    <AppIcon name="plus" size={19} /> Tulis cerita
                  </Link>
                </div>
              </div>
            </Card>

            <Card className="!p-5 md:!p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Target bulan ini</p>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">{monthLabel(currentMonth.year, currentMonth.month)}</h2>
                </div>
                <span className={`badge ${isMonthComplete ? 'bg-blue-100 text-[#3557bf]' : 'bg-amber-100 text-amber-700'}`}>{monthlyProgressLabel(currentMonth.status)}</span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-bold text-slate-900"><AnimatedNumber value={currentMonth.progress} formatter={(value) => `${Math.round(value)}%`} /></p>
                  <p className="mt-1 text-xs font-medium text-slate-400">{rupiah(currentMonth.paid)} dari {rupiah(currentMonth.target)}</p>
                </div>
                <p className={`text-right text-sm font-semibold ${isMonthComplete ? 'text-[#3557bf]' : 'text-amber-700'}`}>
                  {isMonthComplete ? 'Sudah lengkap' : `Kurang ${rupiah(currentMonth.remaining)}`}
                </p>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="progress-reveal h-full rounded-full bg-[#4267d6] transition-all" style={{ width: `${progressWidth}%` }} />
              </div>
              <Link prefetch={false} href="/deposits" className="mt-5 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Lihat detail bulan ini</Link>
            </Card>
          </section>

          <section className="stagger-grid mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard icon="wallet" label="Setoran terkumpul" value={totals.totalDeposits} helper="Total setoran Kakak dan Mpip" />
            <MetricCard icon="arrow-down" label="Tambah rezeki" value={totals.totalAdditions} helper="Rezeki di luar setoran bulanan" />
            <MetricCard icon="arrow-up" label="Kepakai buat kita" value={totals.totalWithdrawals} helper="Momen dan kebutuhan bersama" />
          </section>

          <section className="mt-5">
            <Card className="love-sheen relative overflow-hidden !border-0 !bg-gradient-to-br !from-rose-500 !via-pink-500 !to-violet-500 !p-5 text-white md:!p-6">
              <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-white/10" />
              <div className="relative grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="flex items-start gap-4">
                  <span className="heart-beat flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15"><AppIcon name="heart" size={25} /></span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Anniversary kita</p>
                    <h2 className="mt-1 text-2xl font-bold">25 September ❤️</h2>
                    <p className="mt-1 text-sm font-medium text-white/80">{anniversary.totalDays === 0 ? 'Hari ini anniversary kita ❤️' : anniversary.totalDays === 1 ? 'Besok hari spesial kita.' : `${anniversary.totalDays} hari lagi menuju hari spesial kita.`}</p>
                  </div>
                </div>
                <Link prefetch={false} href="/capsules" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-bold text-rose-600 transition hover:bg-rose-50 focus:outline-none focus:ring-4 focus:ring-white/30"><AppIcon name="gift" size={18} /> Siapkan kejutan</Link>
              </div>
            </Card>
          </section>

          <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
            <Card>
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Setoran bulan ini</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Status masing-masing anggota.</p>
                </div>
                <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 sm:inline-flex">{monthLabel(currentMonth.year, currentMonth.month)}</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {memberProgress.map((item) => (
                  <div key={item.member.id} className="rounded-[1.6rem] border border-slate-100 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="badge text-slate-700" style={{ backgroundColor: item.member.color || '#eef2ff' }}>{item.member.name}</span>
                      <span className={`badge ${statusBadgeClass(item.status)}`}>{depositStatusLabel(item.status)}</span>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sudah masuk</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{rupiah(item.paid)}</p>
                      </div>
                      <p className="text-sm font-semibold text-[#3557bf]">{item.progress}%</p>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
                      <div className="progress-reveal h-full rounded-full bg-[#4267d6]" style={{ width: `${item.progress}%` }} />
                    </div>
                    <div className="mt-3 flex justify-between gap-2 text-xs font-medium text-slate-500">
                      <span>Target {rupiah(item.required)}</span>
                      <span>{item.remaining > 0 ? `Kurang ${rupiah(item.remaining)}` : 'Lengkap'}</span>
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-400">Jatuh tempo {formatDate(item.deposit?.due_date)}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Cerita terbaru</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Momen uang kita di luar setoran.</p>
                </div>
                <Link prefetch={false} href="/mutations" className="text-sm font-semibold text-[#3557bf] hover:underline">Lihat semua</Link>
              </div>

              {recentMutations.length === 0 ? (
                <div className="mt-5 rounded-3xl bg-slate-50 p-4 text-sm font-medium text-slate-500">Belum ada cerita tambahan.</div>
              ) : (
                <div className="mt-5 space-y-3">
                  {recentMutations.map((mutation) => (
                    <div key={mutation.id} className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 p-3.5">
                      <div className="min-w-0">
                        <span className={`badge ${mutation.type === 'Tambah' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{transactionLabel(mutation.type)}</span>
                        <p className="mt-2 truncate text-sm font-semibold text-slate-700">{mutation.description || 'Tanpa keterangan'}</p>
                        <p className="mt-1 text-xs font-medium text-slate-400">{formatDate(mutation.mutation_date)}</p>
                      </div>
                      <p className={`shrink-0 text-sm font-bold ${mutation.type === 'Tambah' ? 'text-emerald-700' : 'text-rose-700'}`}>{mutation.type === 'Tambah' ? '+' : '-'}{rupiah(mutation.amount)}</p>
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
