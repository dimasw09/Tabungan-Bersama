'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Member, MonthlyDeposit, OtherMutation } from '@/lib/types';
import { calculateCurrentMonthStats, calculateMemberMonthStats, calculateTotals, monthlyProgressLabel } from '@/lib/calculations';
import { formatDate, monthLabel, rupiah, safeDueDate } from '@/lib/format';
import { depositStatusLabel, normalizeDepositStatuses, statusBadgeClass } from '@/lib/depositStatus';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { AppIcon } from '@/components/ui/AppIcon';
import { AnimatedNumber, AnimatedRupiah } from '@/components/ui/AnimatedNumber';
import { anniversaryCountdown } from '@/lib/loveCapsule';
import { ShoppingSubsidyAgreement } from '@/components/dashboard/ShoppingSubsidyAgreement';
import { buildDashboardActivities, buildDepositReminders, type DepositReminder } from '@/lib/dashboard';

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

type MemberProgressItem = ReturnType<typeof calculateMemberMonthStats>[number];

function MemberProgressCards({ items, year, month }: { items: MemberProgressItem[]; year: number; month: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item) => (
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
          <p className="mt-2 text-xs font-medium text-slate-400">Jatuh tempo {formatDate(item.deposit?.due_date || safeDueDate(year, month, item.member.payday))}</p>
        </div>
      ))}
    </div>
  );
}

function reminderDescription(reminder: DepositReminder) {
  if (reminder.status === 'overdue') return `Lewat ${Math.abs(reminder.daysUntilDue)} hari · kurang ${rupiah(reminder.remaining)}`;
  if (reminder.status === 'today') return `Jatuh tempo hari ini · kurang ${rupiah(reminder.remaining)}`;
  if (reminder.status === 'soon') return `${reminder.daysUntilDue} hari lagi · kurang ${rupiah(reminder.remaining)}`;
  return `Jatuh tempo ${formatDate(reminder.dueDate)} · kurang ${rupiah(reminder.remaining)}`;
}

function reminderClasses(reminder: DepositReminder) {
  if (reminder.status === 'overdue' || reminder.status === 'today') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (reminder.status === 'soon') return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-blue-100 bg-blue-50 text-[#3557bf]';
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
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

  useEffect(() => {
    const refreshClock = () => setClock(new Date());
    const timer = window.setInterval(refreshClock, 60_000);
    document.addEventListener('visibilitychange', refreshClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshClock);
    };
  }, []);
  const totals = useMemo(() => calculateTotals(deposits, mutations), [deposits, mutations]);
  const currentMonth = useMemo(() => calculateCurrentMonthStats(members, deposits, clock), [members, deposits, clock]);
  const memberProgress = useMemo(() => calculateMemberMonthStats(members, deposits, currentMonth.year, currentMonth.month), [members, deposits, currentMonth.year, currentMonth.month]);
  const progressWidth = Math.min(currentMonth.progress, 100);
  const depositReminders = useMemo(() => buildDepositReminders(members, deposits, clock), [members, deposits, clock]);
  const recentActivities = useMemo(() => buildDashboardActivities(deposits, mutations), [deposits, mutations]);
  const isMonthComplete = currentMonth.status === 'COMPLETE' || currentMonth.status === 'OVERPAID';
  const anniversary = useMemo(() => anniversaryCountdown(clock), [clock]);

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

          <section className="mt-4" aria-labelledby="deposit-reminder-title">
            <Card className="!p-4 md:!p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">{depositReminders.length === 0 ? 'Status bulan ini' : 'Perlu diperhatikan'}</p>
                  <h2 id="deposit-reminder-title" className="mt-1 text-lg font-bold text-slate-900">Setoran bulan ini</h2>
                </div>
                <Link prefetch={false} href="/deposits" className="shrink-0 text-sm font-semibold text-[#3557bf] hover:underline">Buka setoran</Link>
              </div>

              {depositReminders.length === 0 ? (
                <div role="status" className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3.5 text-emerald-700">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white"><AppIcon name="check" size={19} /></span>
                  <div>
                    <p className="text-sm font-bold">Setoran bulan ini sudah lengkap</p>
                    <p className="mt-0.5 text-xs font-medium text-emerald-600">Kakak dan Mpip sudah mencapai target bersama.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {depositReminders.map((reminder) => (
                    <div key={reminder.id} role="status" className={`flex items-center gap-3 rounded-2xl border p-3.5 ${reminderClasses(reminder)}`}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white"><AppIcon name="clock" size={19} /></span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold">Setoran {reminder.memberName} belum lengkap</p>
                        <p className="mt-0.5 truncate text-xs font-semibold opacity-80">{reminderDescription(reminder)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <div className="mt-5 [&>*]:!mb-0">
            <ShoppingSubsidyAgreement />
          </div>

          <details className="group mt-4 rounded-[28px] border border-slate-100 bg-white p-4 shadow-sm sm:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-slate-900">
              Rincian saldo
              <span className="text-[#3557bf] transition group-open:rotate-90"><AppIcon name="chevron-right" size={19} /></span>
            </summary>
            <div className="mt-4 grid gap-3">
              <MetricCard icon="wallet" label="Setoran terkumpul" value={totals.totalDeposits} helper="Total setoran Kakak dan Mpip" />
              <MetricCard icon="arrow-down" label="Tambah rezeki" value={totals.totalAdditions} helper="Rezeki di luar setoran bulanan" />
              <MetricCard icon="arrow-up" label="Kepakai buat kita" value={totals.totalWithdrawals} helper="Momen dan kebutuhan bersama" />
            </div>
          </details>

          <section className="stagger-grid mt-4 hidden gap-3 sm:grid sm:grid-cols-3">
            <MetricCard icon="wallet" label="Setoran terkumpul" value={totals.totalDeposits} helper="Total setoran Kakak dan Mpip" />
            <MetricCard icon="arrow-down" label="Tambah rezeki" value={totals.totalAdditions} helper="Rezeki di luar setoran bulanan" />
            <MetricCard icon="arrow-up" label="Kepakai buat kita" value={totals.totalWithdrawals} helper="Momen dan kebutuhan bersama" />
          </section>

          <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
            <div>
              <details className="group rounded-[28px] border border-slate-100 bg-white p-4 shadow-sm lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-slate-900">Rincian setoran</h2>
                    <p className="mt-1 text-xs font-medium text-slate-500">Status Kakak dan Mpip bulan ini.</p>
                  </div>
                  <span className="text-[#3557bf] transition group-open:rotate-90"><AppIcon name="chevron-right" size={19} /></span>
                </summary>
                <div className="mt-4"><MemberProgressCards items={memberProgress} year={currentMonth.year} month={currentMonth.month} /></div>
              </details>

              <Card className="!hidden lg:!block">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Setoran bulan ini</h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">Status masing-masing anggota.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{monthLabel(currentMonth.year, currentMonth.month)}</span>
                </div>
                <MemberProgressCards items={memberProgress} year={currentMonth.year} month={currentMonth.month} />
              </Card>
            </div>

            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Aktivitas terbaru</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">Setoran dan cerita uang terbaru.</p>
                </div>
                <Link prefetch={false} href="/archive" className="text-sm font-semibold text-[#3557bf] hover:underline">Lihat audit</Link>
              </div>

              {recentActivities.length === 0 ? (
                <div className="mt-5 rounded-3xl bg-slate-50 p-4 text-sm font-medium text-slate-500">Belum ada aktivitas keuangan.</div>
              ) : (
                <div className="mt-5 space-y-3">
                  {recentActivities.map((activity) => {
                    const positive = activity.kind !== 'withdrawal';
                    const href = activity.kind === 'deposit' ? '/deposits' : '/mutations';
                    return (
                      <Link key={activity.id} prefetch={false} href={href} className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 p-3.5 transition hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${activity.kind === 'withdrawal' ? 'bg-rose-100 text-rose-700' : activity.kind === 'addition' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-[#3557bf]'}`}>
                            <AppIcon name={activity.kind === 'deposit' ? 'wallet' : activity.kind === 'addition' ? 'arrow-down' : 'arrow-up'} size={18} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-700">{activity.title}</p>
                            <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{activity.description}</p>
                            <p className="mt-1 text-xs font-medium text-slate-400">{formatDate(activity.date)}</p>
                          </div>
                        </div>
                        <p className={`shrink-0 text-sm font-bold ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>{positive ? '+' : '-'}{rupiah(activity.amount)}</p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
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
        </>
      )}
    </main>
  );
}
