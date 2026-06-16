'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase/client';
import type { Member, MonthlyDeposit, OtherMutation, StoryPhoto } from '@/lib/types';
import { calculateMonthlyRecaps } from '@/lib/calculations';
import { currentYearMonth, monthLabel, rupiah, toNumber } from '@/lib/format';
import { normalizeDepositStatuses } from '@/lib/depositStatus';
import { exportReportExcel } from '@/lib/exportReportExcel';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { AppIcon } from '@/components/ui/AppIcon';
import { useToast } from '@/components/ui/ToastProvider';
import { AnimatedNumber, AnimatedRupiah } from '@/components/ui/AnimatedNumber';
import { SummaryCard } from './ReportSummaryCard';
import { DeferredRender } from '@/components/ui/DeferredRender';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import { monthPosition, periodDescription, type MonthTogetherness, type TimelineItem } from './reportModel';

const BalanceChart = dynamic(() => import('./BalanceChart').then((module) => module.BalanceChart), { ssr: false });

export default function RecapPage() {
  const { toast } = useToast();
  const now = currentYearMonth();
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [photos, setPhotos] = useState<Array<Pick<StoryPhoto, 'mutation_id'>>>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [filterYear, setFilterYear] = useState(String(now.year));
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const [membersResult, depositsResult, mutationsResult, photosResult] = await Promise.all([
      supabase.from('members').select('*').order('name'),
      supabase.from('monthly_deposits').select('*, members(*)').is('deleted_at', null).order('year').order('month'),
      supabase.from('other_mutations').select('*').is('deleted_at', null).order('mutation_date'),
      supabase.from('story_photos').select('mutation_id')
    ]);
    if (showLoading) setLoading(false);

    if (membersResult.error || depositsResult.error || mutationsResult.error) {
      toast({ title: 'Gagal ambil Jejak Kita', message: membersResult.error?.message || depositsResult.error?.message || mutationsResult.error?.message, type: 'error' });
      return;
    }

    setMembers((membersResult.data || []) as Member[]);
    setDeposits(normalizeDepositStatuses((depositsResult.data || []) as MonthlyDeposit[]));
    setMutations((mutationsResult.data || []) as OtherMutation[]);
    setPhotos(photosResult.error ? [] : ((photosResult.data || []) as Array<Pick<StoryPhoto, 'mutation_id'>>));
  }, [toast]);

  useEffect(() => {
    fetchData();
    const scheduleRefresh = () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = setTimeout(() => { void fetchData(false); }, 280);
    };

    const channel = supabase
      .channel('recap-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_photos' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  const recaps = useMemo(() => calculateMonthlyRecaps(deposits, mutations), [deposits, mutations]);
  const years = useMemo(() => {
    const set = new Set<number>([2026, now.year]);
    recaps.forEach((recap) => set.add(recap.year));
    return Array.from(set).sort((a, b) => b - a);
  }, [recaps, now.year]);

  const photoCounts = useMemo(() => {
    return photos.reduce<Record<string, number>>((accumulator, photo) => {
      accumulator[photo.mutation_id] = (accumulator[photo.mutation_id] || 0) + 1;
      return accumulator;
    }, {});
  }, [photos]);

  const filteredDeposits = useMemo(
    () => deposits.filter((item) => filterYear === 'all' || item.year === Number(filterYear)),
    [deposits, filterYear]
  );
  const filteredMutations = useMemo(
    () => mutations.filter((item) => filterYear === 'all' || new Date(`${item.mutation_date}T00:00:00`).getFullYear() === Number(filterYear)),
    [mutations, filterYear]
  );
  const filteredRecaps = useMemo(
    () => recaps.filter((recap) => filterYear === 'all' || recap.year === Number(filterYear)),
    [recaps, filterYear]
  );

  const togetherness = useMemo<MonthTogetherness[]>(() => {
    return filteredRecaps.map((recap) => {
      const monthDeposits = filteredDeposits.filter((deposit) => deposit.year === recap.year && deposit.month === recap.month);
      const required = monthDeposits.reduce((sum, deposit) => sum + toNumber(deposit.required_amount), 0);
      const paid = monthDeposits.reduce((sum, deposit) => sum + toNumber(deposit.paid_amount), 0);
      const memberStates = members.map((member) => {
        const deposit = monthDeposits.find((entry) => entry.member_id === member.id);
        return { name: member.name, complete: Boolean(deposit && toNumber(deposit.paid_amount) >= toNumber(deposit.required_amount)) };
      });
      const currentPosition = monthPosition(now.year, now.month);
      const itemPosition = monthPosition(recap.year, recap.month);
      const isFuture = itemPosition > currentPosition;
      const completeTogether = members.length > 0 && memberStates.every((state) => state.complete);

      return {
        key: recap.key,
        year: recap.year,
        month: recap.month,
        completeTogether,
        isFuture,
        isCurrent: itemPosition === currentPosition,
        required,
        paid,
        progress: required > 0 ? Math.min(Math.round((paid / required) * 100), 100) : 0,
        memberStates
      };
    });
  }, [filteredRecaps, filteredDeposits, members, now.month, now.year]);

  const summary = useMemo(() => {
    const latest = filteredRecaps.at(-1) || null;
    const additions = filteredMutations.filter((item) => item.type === 'Tambah').reduce((sum, item) => sum + toNumber(item.amount), 0);
    const withdrawals = filteredMutations.filter((item) => item.type === 'Penarikan').reduce((sum, item) => sum + toNumber(item.amount), 0);
    const depositsTotal = filteredDeposits.reduce((sum, item) => sum + toNumber(item.paid_amount), 0);
    const completeMonths = togetherness.filter((item) => item.completeTogether && !item.isFuture).length;
    const eligibleMonths = togetherness.filter((item) => !item.isFuture).length;
    const netChange = depositsTotal + additions - withdrawals;
    const totalPhotos = filteredMutations.reduce((sum, item) => sum + (photoCounts[item.id] || 0), 0);

    const eligible = togetherness.filter((item) => !item.isFuture).sort((a, b) => a.year - b.year || a.month - b.month);
    let streak = 0;
    for (let index = eligible.length - 1; index >= 0; index -= 1) {
      if (!eligible[index].completeTogether) break;
      streak += 1;
    }

    return { latest, additions, withdrawals, depositsTotal, completeMonths, eligibleMonths, netChange, totalPhotos, streak };
  }, [filteredRecaps, filteredMutations, filteredDeposits, togetherness, photoCounts]);

  const insights = useMemo(() => {
    const items: string[] = [];
    if (summary.completeMonths > 0) items.push(`${summary.completeMonths} bulan sudah lengkap bersama—masing-masing memenuhi target pribadinya.`);
    if (summary.streak > 1) items.push(`Kalian sedang menjaga ritme ${summary.streak} bulan lengkap berturut-turut ❤️`);
    if (summary.netChange > 0) items.push(`Saldo bertambah ${rupiah(summary.netChange)} selama periode ini.`);
    if (summary.totalPhotos > 0) items.push(`${summary.totalPhotos} foto kenangan tersimpan di album Cerita selama periode ini.`);
    const biggestStory = [...filteredMutations].filter((item) => item.type === 'Penarikan').sort((a, b) => toNumber(b.amount) - toNumber(a.amount))[0];
    if (biggestStory) items.push(`Momen dengan nominal terbesar: “${biggestStory.description || 'Cerita kita'}” sebesar ${rupiah(biggestStory.amount)}.`);
    if (!items.length) items.push('Jejak kalian akan mulai terbentuk setelah setoran atau Cerita pertama dicatat.');
    return items.slice(0, 4);
  }, [summary, filteredMutations]);

  const storyHighlights = useMemo(() => {
    return [...filteredMutations]
      .sort((a, b) => {
        const photoDifference = (photoCounts[b.id] || 0) - (photoCounts[a.id] || 0);
        if (photoDifference !== 0) return photoDifference;
        return b.mutation_date.localeCompare(a.mutation_date);
      })
      .slice(0, 3);
  }, [filteredMutations, photoCounts]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const depositItems = filteredDeposits
      .filter((deposit) => toNumber(deposit.paid_amount) > 0)
      .map((deposit) => ({
        id: `deposit-${deposit.id}`,
        date: deposit.actual_transfer_date || deposit.due_date,
        kind: 'deposit' as const,
        title: `${deposit.members?.name || 'Salah satu dari kita'} menabung`,
        description: `Setoran ${monthLabel(deposit.year, deposit.month)} sudah dicatat.`,
        amount: toNumber(deposit.paid_amount)
      }));

    const storyItems = filteredMutations.map((mutation) => ({
      id: `story-${mutation.id}`,
      date: mutation.mutation_date,
      kind: 'story' as const,
      title: mutation.description || (mutation.type === 'Tambah' ? 'Tambah rezeki' : 'Cerita kita'),
      description: mutation.type === 'Tambah' ? 'Tambah rezeki untuk tabungan bersama.' : 'Kepakai buat momen atau kebutuhan kita.',
      amount: toNumber(mutation.amount),
      photoCount: photoCounts[mutation.id] || 0
    }));

    return [...depositItems, ...storyItems].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  }, [filteredDeposits, filteredMutations, photoCounts]);

  const { visibleItems: visibleRecaps, hasMore: hasMoreRecaps, loadMore: loadMoreRecaps, remaining: remainingRecaps } = useProgressiveList(filteredRecaps, 6, [filterYear]);
  const { visibleItems: visibleTimeline, hasMore: hasMoreTimeline, loadMore: loadMoreTimeline, remaining: remainingTimeline } = useProgressiveList(timeline, 6, [filterYear]);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await exportReportExcel({ members, deposits, mutations, recaps, filterYear, photoCounts });
      toast({ title: 'Excel berhasil dibuat', message: 'Jejak Kita sudah diunduh dengan format tracker tabungan bersama.', type: 'success' });
    } catch (error) {
      toast({ title: 'Gagal membuat Excel', message: error instanceof Error ? error.message : 'Coba lagi beberapa saat.', type: 'error' });
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Jejak Kita"
        description="Perjalanan tabungan, cerita, dan kekompakan kita—tanpa membandingkan siapa yang menyetor lebih besar."
        action={
          <Button type="button" variant="secondary" onClick={handleExport} disabled={exporting} className="gap-2">
            <AppIcon name="arrow-down" size={18} />
            {exporting ? 'Menyiapkan Excel...' : 'Export Excel'}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Periode laporan</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{periodDescription(filterYear)}</p>
            <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-500">Target Kakak dan Mpip mengikuti 3% dari gaji masing-masing. Laporan menilai komitmen terhadap target pribadi, bukan membandingkan nominal.</p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <select aria-label="Pilih tahun laporan" className="form-input min-w-0 md:w-44" value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>
              <option value="all">Semua periode</option>
              {years.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <Button type="button" variant="ghost" onClick={() => setFilterYear(String(now.year))}>Tahun ini</Button>
          </div>
        </div>

        <div className="stagger-grid mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Saldo akhir" value={<AnimatedRupiah value={summary.latest?.endingBalance || 0} />} helper={summary.latest ? `Sampai ${monthLabel(summary.latest.year, summary.latest.month)}` : 'Belum ada data'} tone="blue" />
          <SummaryCard label="Setoran terkumpul" value={<AnimatedRupiah value={summary.depositsTotal} />} helper="Gabungan target pribadi yang sudah masuk" tone="green" />
          <SummaryCard label="Tambah rezeki" value={<AnimatedRupiah value={summary.additions} />} helper="Di luar setoran rutin" tone="slate" />
          <SummaryCard label="Kepakai buat kita" value={<AnimatedRupiah value={summary.withdrawals} />} helper="Untuk Cerita dan kebutuhan bersama" tone="rose" />
        </div>
      </Card>

      {filteredRecaps.length === 0 ? (
        <Card>
          <EmptyState title="Jejaknya belum terbentuk" description="Catat setoran atau tulis Cerita terlebih dahulu agar laporan mulai tumbuh." />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Perjalanan saldo</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Tumbuh pelan-pelan, tetap bersama</h2>
              </div>
              <p className={`text-sm font-bold ${summary.netChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                Perubahan periode: {summary.netChange >= 0 ? '+' : ''}{rupiah(summary.netChange)}
              </p>
            </div>
            <div className="mt-5 rounded-[24px] bg-slate-50 p-3 md:p-5">
              <DeferredRender minHeight={280}><BalanceChart recaps={filteredRecaps} /></DeferredRender>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Kekompakan kita</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Target pribadi, dirayakan bersama</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl bg-blue-50 p-4">
                  <p className="text-3xl font-black text-blue-700"><AnimatedNumber value={summary.completeMonths} /></p>
                  <p className="mt-1 text-sm font-bold text-slate-700">bulan lengkap bersama</p>
                </div>
                <div className="rounded-3xl bg-emerald-50 p-4">
                  <p className="text-3xl font-black text-emerald-700"><AnimatedNumber value={summary.streak} /></p>
                  <p className="mt-1 text-sm font-bold text-slate-700">streak lengkap saat ini</p>
                </div>
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-3xl font-black text-slate-700">{summary.eligibleMonths}</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">bulan yang sudah dijalani</p>
                </div>
              </div>
              <div className="mt-4 rounded-3xl border border-blue-100 bg-blue-50/60 p-4">
                <p className="text-sm font-bold text-blue-800">Cara bacanya</p>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-600">Satu bulan disebut lengkap ketika Kakak dan Mpip sama-sama memenuhi target pribadinya. Nominalnya memang berbeda karena mengikuti 3% dari gaji masing-masing.</p>
              </div>
            </Card>

            <Card>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Catatan kecil</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Yang terjadi di periode ini</h2>
              <div className="mt-4 space-y-3">
                {insights.map((insight, index) => (
                  <div key={insight} className="flex gap-3 rounded-2xl bg-slate-50 p-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-blue-600 shadow-sm">{index + 1}</span>
                    <p className="text-sm font-semibold leading-6 text-slate-600">{insight}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {storyHighlights.length > 0 ? (
            <Card>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Cerita kita</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Momen yang ikut membentuk perjalanan</h2>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {storyHighlights.map((story) => (
                  <div key={story.id} className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`badge ${story.type === 'Tambah' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{story.type === 'Tambah' ? 'Tambah rezeki' : 'Kepakai buat kita'}</span>
                      <span className="text-xs font-bold text-slate-400">{new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${story.mutation_date}T00:00:00`))}</span>
                    </div>
                    <h3 className="mt-3 line-clamp-2 text-base font-bold text-slate-900">{story.description || 'Cerita kita'}</h3>
                    <p className="mt-2 text-lg font-black text-slate-800">{rupiah(story.amount)}</p>
                    <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                      <AppIcon name="image" size={16} />
                      {photoCounts[story.id] || 0} foto tersimpan
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Ringkasan bulanan</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Setiap bulan punya ceritanya sendiri</h2>
            </div>
            <div className="mt-5 space-y-3">
              {visibleRecaps.map((recap) => {
                const state = togetherness.find((item) => item.key === recap.key);
                const status = state?.isFuture ? 'Belum waktunya' : state?.completeTogether ? 'Lengkap bersama ❤️' : state?.isCurrent ? 'Masih berjalan' : 'Masih dalam perjalanan';
                const net = recap.totalPaidDeposits + recap.additions - recap.withdrawals;
                return (
                  <details key={recap.key} className="group content-auto rounded-[22px] border border-slate-100 bg-white shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 focus:outline-none focus:ring-4 focus:ring-blue-100 [&::-webkit-details-marker]:hidden">
                      <div>
                        <p className="font-bold text-slate-900">{monthLabel(recap.year, recap.month)}</p>
                        <p className="mt-1 text-xs font-bold text-slate-400">{status}</p>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <p className={`font-bold ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{net >= 0 ? '+' : ''}{rupiah(net)}</p>
                          <p className="text-xs font-semibold text-slate-400">perubahan bulan</p>
                        </div>
                        <AppIcon name="chevron-right" size={19} className="transition group-open:rotate-90" />
                      </div>
                    </summary>
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-2xl bg-blue-50 p-3"><p className="text-xs font-bold text-blue-500">Setoran masuk</p><p className="mt-1 font-bold text-slate-800">{rupiah(recap.totalPaidDeposits)}</p></div>
                        <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-600">Tambah rezeki</p><p className="mt-1 font-bold text-slate-800">{rupiah(recap.additions)}</p></div>
                        <div className="rounded-2xl bg-rose-50 p-3"><p className="text-xs font-bold text-rose-600">Kepakai buat kita</p><p className="mt-1 font-bold text-slate-800">{rupiah(recap.withdrawals)}</p></div>
                        <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Saldo akhir</p><p className="mt-1 font-bold text-slate-800">{rupiah(recap.endingBalance)}</p></div>
                      </div>
                      {state ? (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
                            <span>Progress target bersama</span><span>{state.progress}%</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#4267d6]" style={{ width: `${state.progress}%` }} /></div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {state.memberStates.map((memberState) => (
                              <span key={memberState.name} className={`badge ${memberState.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                {memberState.name}: {memberState.complete ? 'target pribadi terpenuhi' : 'masih proses'}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
            {hasMoreRecaps ? <div className="mt-4 flex justify-center"><Button type="button" variant="secondary" onClick={loadMoreRecaps}>Muat {Math.min(6, remainingRecaps)} bulan lagi</Button></div> : null}
          </Card>

          <Card>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Semua jejak</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Setoran dan Cerita dalam satu perjalanan</h2>
            </div>
            <div className="mt-5 space-y-1">
              {visibleTimeline.map((item, index) => (
                <div key={item.id} className="content-auto relative flex gap-4 pb-5 last:pb-0">
                  {index < visibleTimeline.length - 1 ? <div className="absolute left-[17px] top-8 h-[calc(100%-1.25rem)] w-px bg-slate-200" /> : null}
                  <div className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.kind === 'deposit' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>
                    <AppIcon name={item.kind === 'deposit' ? 'wallet' : 'heart'} size={17} />
                  </div>
                  <div className="min-w-0 flex-1 rounded-2xl bg-slate-50 p-3.5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-bold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm font-medium leading-5 text-slate-500">{item.description}</p>
                      </div>
                      <div className="shrink-0 sm:text-right">
                        <p className="font-bold text-slate-800">{rupiah(item.amount)}</p>
                        <p className="text-xs font-semibold text-slate-400">{new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${item.date}T00:00:00`))}</p>
                      </div>
                    </div>
                    {item.photoCount ? <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-500"><AppIcon name="image" size={15} />{item.photoCount} foto di album</p> : null}
                  </div>
                </div>
              ))}
            </div>
            {hasMoreTimeline ? <div className="mt-4 flex justify-center"><Button type="button" variant="secondary" onClick={loadMoreTimeline}>Muat {Math.min(6, remainingTimeline)} jejak lagi</Button></div> : null}
          </Card>
        </>
      )}
    </main>
  );
}
