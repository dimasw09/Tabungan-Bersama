'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { GoalMilestone, GoalProgressMode, Member, MonthlyDeposit, OtherMutation, SavingGoal } from '@/lib/types';
import { calculateTotals } from '@/lib/calculations';
import { calculateAverageMonthlySaving, calculateGoalProgress, estimateGoalCompletion, formatEstimatedMonth, reachedMilestoneCount } from '@/lib/goals';
import { formatDate, rupiah, todayInput, toNumber } from '@/lib/format';
import { AppIcon } from '@/components/ui/AppIcon';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { RupiahInput } from '@/components/ui/RupiahInput';
import { useToast } from '@/components/ui/ToastProvider';

const GOAL_ICONS = ['✨', '🌴', '🏡', '💍', '🎓', '🚗', '🎁', '🧳'];

type MilestoneDraft = { title: string; target_amount: number; sort_order: number };
type GoalForm = {
  title: string;
  description: string;
  icon: string;
  target_amount: number;
  start_date: string;
  target_date: string;
  progress_mode: GoalProgressMode;
};

type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  run: () => Promise<void>;
};

function defaultMilestones(target: number, existingTitles?: string[]): MilestoneDraft[] {
  const titles = existingTitles || ['Langkah pertama', 'Setengah perjalanan', 'Hampir sampai', 'Mimpi kita tercapai'];
  return [25, 50, 75, 100].map((percent, index) => ({
    title: titles[index] || `Milestone ${index + 1}`,
    target_amount: Math.max(Math.round((target * percent) / 100), 0),
    sort_order: index
  }));
}

function statusLabel(status: SavingGoal['status']) {
  if (status === 'COMPLETED') return 'Tercapai';
  if (status === 'ARCHIVED') return 'Diarsipkan';
  return 'Sedang diperjuangkan';
}

function statusClass(status: SavingGoal['status']) {
  if (status === 'COMPLETED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'ARCHIVED') return 'bg-slate-100 text-slate-500';
  return 'bg-blue-100 text-[#3557bf]';
}

export default function GoalsPage() {
  const { toast } = useToast();
  const [goals, setGoals] = useState<SavingGoal[]>([]);
  const [milestones, setMilestones] = useState<GoalMilestone[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [goalReady, setGoalReady] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavingGoal | null>(null);
  const [form, setForm] = useState<GoalForm>({ title: '', description: '', icon: '✨', target_amount: 0, start_date: todayInput(), target_date: '', progress_mode: 'CURRENT_BALANCE' });
  const [milestoneDrafts, setMilestoneDrafts] = useState<MilestoneDraft[]>(defaultMilestones(0));
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    const [goalsResult, milestonesResult, membersResult, depositsResult, mutationsResult] = await Promise.all([
      supabase.from('saving_goals').select('*').order('created_at', { ascending: false }),
      supabase.from('goal_milestones').select('*').order('sort_order'),
      supabase.from('members').select('*').order('name'),
      supabase.from('monthly_deposits').select('*').is('deleted_at', null),
      supabase.from('other_mutations').select('*').is('deleted_at', null).order('mutation_date')
    ]);
    if (showLoading) setLoading(false);

    if (goalsResult.error || milestonesResult.error) {
      setGoalReady(false);
      setGoals([]);
      setMilestones([]);
      if (showLoading) toast({ title: 'Goal Journey belum aktif', message: 'Jalankan file Stage3_Goal_Journey.sql di Supabase terlebih dahulu.', type: 'info' });
    } else {
      setGoalReady(true);
      setGoals((goalsResult.data || []) as SavingGoal[]);
      setMilestones((milestonesResult.data || []) as GoalMilestone[]);
    }

    if (membersResult.error || depositsResult.error || mutationsResult.error) {
      toast({ title: 'Gagal memuat perjalanan', message: membersResult.error?.message || depositsResult.error?.message || mutationsResult.error?.message, type: 'error' });
      return;
    }
    setMembers((membersResult.data || []) as Member[]);
    setDeposits((depositsResult.data || []) as MonthlyDeposit[]);
    setMutations((mutationsResult.data || []) as OtherMutation[]);
  }

  useEffect(() => {
    fetchData();
    const channel = supabase.channel('goal-journey-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'saving_goals' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goal_milestones' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_deposits' }, () => fetchData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'other_mutations' }, () => fetchData(false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const totals = useMemo(() => calculateTotals(deposits, mutations), [deposits, mutations]);
  const activeGoal = goals.find((goal) => goal.status === 'ACTIVE') || null;
  const pastGoals = goals.filter((goal) => goal.status !== 'ACTIVE');
  const activeMilestones = useMemo(() => milestones.filter((item) => item.goal_id === activeGoal?.id).sort((a, b) => a.sort_order - b.sort_order), [milestones, activeGoal?.id]);
  const activeProgress = activeGoal ? calculateGoalProgress(activeGoal, totals.balance) : null;
  const averageMonthlySaving = activeGoal ? calculateAverageMonthlySaving(members, deposits, mutations, activeGoal.start_date) : 0;
  const estimatedDate = activeProgress ? estimateGoalCompletion(activeProgress, averageMonthlySaving) : null;
  const linkedStoryCount = useMemo(() => {
    const map = new Map<string, number>();
    mutations.forEach((mutation) => {
      if (!mutation.goal_id) return;
      map.set(mutation.goal_id, (map.get(mutation.goal_id) || 0) + 1);
    });
    return map;
  }, [mutations]);

  function openCreate() {
    const target = 0;
    setEditing(null);
    setForm({ title: '', description: '', icon: '✨', target_amount: target, start_date: todayInput(), target_date: '', progress_mode: 'CURRENT_BALANCE' });
    setMilestoneDrafts(defaultMilestones(target));
    setFormOpen(true);
  }

  function openEdit(goal: SavingGoal) {
    const existing = milestones.filter((item) => item.goal_id === goal.id).sort((a, b) => a.sort_order - b.sort_order);
    setEditing(goal);
    setForm({
      title: goal.title,
      description: goal.description || '',
      icon: goal.icon || '✨',
      target_amount: toNumber(goal.target_amount),
      start_date: goal.start_date,
      target_date: goal.target_date || '',
      progress_mode: goal.progress_mode
    });
    setMilestoneDrafts(existing.length ? existing.map((item) => ({ title: item.title, target_amount: toNumber(item.target_amount), sort_order: item.sort_order })) : defaultMilestones(toNumber(goal.target_amount)));
    setFormOpen(true);
  }

  function updateTarget(value: number) {
    setForm((current) => ({ ...current, target_amount: value }));
    setMilestoneDrafts((current) => defaultMilestones(value, current.map((item) => item.title)));
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
  }

  async function submitGoal(event: FormEvent) {
    event.preventDefault();
    const title = form.title.trim();
    const description = form.description.trim();
    if (!title) return toast({ title: 'Nama mimpi belum diisi', message: 'Tulis tujuan yang ingin kalian perjuangkan.', type: 'error' });
    if (title.length > 80) return toast({ title: 'Nama terlalu panjang', message: 'Maksimal 80 karakter.', type: 'error' });
    if (description.length > 240) return toast({ title: 'Cerita terlalu panjang', message: 'Deskripsi maksimal 240 karakter.', type: 'error' });
    if (form.target_amount <= 0) return toast({ title: 'Target belum valid', message: 'Masukkan nominal target lebih dari Rp0.', type: 'error' });
    if (!form.start_date) return toast({ title: 'Tanggal mulai belum diisi', type: 'error' });
    if (form.target_date && form.target_date < form.start_date) return toast({ title: 'Target tanggal tidak valid', message: 'Target tanggal tidak boleh sebelum tanggal mulai.', type: 'error' });
    if (milestoneDrafts.some((item) => !item.title.trim() || item.target_amount <= 0 || item.target_amount > form.target_amount)) {
      return toast({ title: 'Milestone belum valid', message: 'Nama dan nominal milestone harus diisi, serta tidak boleh melewati target.', type: 'error' });
    }

    const safeBalance = Math.max(totals.balance, 0);
    const baselineBalance = editing ? toNumber(editing.baseline_balance) : safeBalance;
    const startingAmount = editing ? toNumber(editing.starting_amount) : form.progress_mode === 'CURRENT_BALANCE' ? safeBalance : 0;
    setSaving(true);
    const { error } = await supabase.rpc('save_goal_journey', {
      p_goal_id: editing?.id || null,
      p_title: title,
      p_description: description || null,
      p_icon: form.icon,
      p_target_amount: form.target_amount,
      p_start_date: form.start_date,
      p_target_date: form.target_date || null,
      p_progress_mode: form.progress_mode,
      p_baseline_balance: baselineBalance,
      p_starting_amount: startingAmount,
      p_milestones: milestoneDrafts.map((item, index) => ({ title: item.title.trim(), target_amount: item.target_amount, sort_order: index }))
    });
    setSaving(false);
    if (error) return toast({ title: 'Goal belum tersimpan', message: error.message, type: 'error' });
    setFormOpen(false);
    setEditing(null);
    toast({ title: editing ? 'Goal Journey diperbarui' : 'Mimpi baru dimulai', message: 'Perjalanannya sekarang mengikuti saldo kalian secara otomatis.', type: 'success' });
    fetchData(false);
  }

  async function runConfirm() {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      await confirmAction.run();
      setConfirmAction(null);
      await fetchData(false);
    } finally {
      setConfirmLoading(false);
    }
  }

  function completeGoal() {
    if (!activeGoal || !activeProgress) return;
    setConfirmAction({
      title: 'Rayakan mimpi ini?',
      description: `${activeGoal.title} sudah mencapai ${rupiah(activeProgress.amount)} dari target ${rupiah(activeGoal.target_amount)}. Goal akan dipindahkan ke perjalanan yang sudah tercapai.`,
      confirmLabel: 'Ya, rayakan',
      run: async () => {
        const { error } = await supabase.rpc('complete_goal_journey', { p_goal_id: activeGoal.id });
        if (error) { toast({ title: 'Goal belum bisa diselesaikan', message: error.message, type: 'error' }); throw error; }
        toast({ title: 'Mimpi kalian tercapai! 🎉', message: 'Sekarang abadikan perayaannya di Cerita.', type: 'success' });
      }
    });
  }

  function archiveGoal() {
    if (!activeGoal) return;
    setConfirmAction({
      title: 'Arsipkan Goal Journey?',
      description: `${activeGoal.title} akan berhenti mengikuti saldo, tetapi riwayatnya tetap tersimpan.`,
      confirmLabel: 'Arsipkan',
      tone: 'danger',
      run: async () => {
        const { error } = await supabase.rpc('archive_goal_journey', { p_goal_id: activeGoal.id });
        if (error) { toast({ title: 'Goal belum bisa diarsipkan', message: error.message, type: 'error' }); throw error; }
        toast({ title: 'Goal dipindahkan ke arsip', type: 'success' });
      }
    });
  }

  if (loading) return <LoadingState />;

  if (!goalReady) {
    return (
      <main>
        <PageHeader title="Goal Journey" description="Bikin mimpi bersama terasa dekat, satu langkah pada satu waktu." />
        <EmptyState title="Goal Journey belum aktif" description="Jalankan Stage3_Goal_Journey.sql di Supabase, lalu muat ulang halaman ini." />
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        title="Goal Journey"
        description="Satu mimpi aktif, progress otomatis dari saldo, dan milestone yang bisa kalian rayakan bersama."
        action={!activeGoal ? <Button type="button" onClick={openCreate}><AppIcon name="sparkles" size={18} /> Mulai mimpi baru</Button> : undefined}
      />

      {activeGoal && activeProgress ? (
        <>
          <Card className="relative overflow-hidden !bg-gradient-to-br !from-[#4267d6] !to-[#7459d9] !p-6 text-white md:!p-8">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10" />
            <div className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-white/5" />
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-white/15 text-3xl ring-1 ring-white/20">{activeGoal.icon}</div>
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white/90">Sedang diperjuangkan</span>
                    <h2 className="mt-3 text-2xl font-bold md:text-3xl">{activeGoal.title}</h2>
                    {activeGoal.description ? <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-white/75">{activeGoal.description}</p> : null}
                  </div>
                </div>
                <button type="button" onClick={() => openEdit(activeGoal)} className="rounded-2xl bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/25">Atur goal</button>
              </div>

              <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Sudah terkumpul untuk mimpi ini</p>
                  <p className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">{rupiah(activeProgress.amount)}</p>
                  <p className="mt-2 text-sm font-medium text-white/70">Target {rupiah(activeGoal.target_amount)} · kurang {rupiah(activeProgress.remaining)}</p>
                </div>
                <div className="rounded-[22px] bg-white/15 px-5 py-4 text-right ring-1 ring-white/15">
                  <p className="text-3xl font-bold">{activeProgress.percent}%</p>
                  <p className="mt-1 text-xs font-semibold text-white/70">perjalanan selesai</p>
                </div>
              </div>
              <div className="mt-5 h-4 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${Math.min(activeProgress.percent, 100)}%` }} />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-semibold text-white/60">Ritme rata-rata</p><p className="mt-1 text-lg font-bold">{rupiah(averageMonthlySaving)}/bulan</p></div>
                <div className="rounded-[22px] bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-semibold text-white/60">Perkiraan tercapai</p><p className="mt-1 text-lg font-bold capitalize">{formatEstimatedMonth(estimatedDate)}</p></div>
                <div className="rounded-[22px] bg-white/10 p-4 ring-1 ring-white/10"><p className="text-xs font-semibold text-white/60">Target pilihan</p><p className="mt-1 text-lg font-bold">{activeGoal.target_date ? formatDate(activeGoal.target_date) : 'Tanpa deadline'}</p></div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                {activeProgress.reached ? <Button type="button" className="!bg-white !text-[#4d55bd] hover:!bg-blue-50" onClick={completeGoal}><AppIcon name="sparkles" size={18} /> Rayakan goal</Button> : null}
                <button type="button" onClick={archiveGoal} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white/80 ring-1 ring-white/15 transition hover:bg-white/20">Arsipkan perjalanan</button>
              </div>
            </div>
          </Card>

          <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-lg font-bold text-slate-900">Milestone perjalanan</h2><p className="mt-1 text-sm font-medium text-slate-500">Rayakan langkah kecil sebelum sampai ke tujuan besar.</p></div>
                <span className="badge bg-blue-50 text-[#3557bf]">{reachedMilestoneCount(activeMilestones, activeProgress.amount)}/{activeMilestones.length} tercapai</span>
              </div>
              <div className="mt-6 space-y-3">
                {activeMilestones.map((milestone, index) => {
                  const reached = activeProgress.amount >= toNumber(milestone.target_amount);
                  return (
                    <div key={milestone.id} className={`flex items-center gap-4 rounded-[22px] border p-4 ${reached ? 'border-emerald-100 bg-emerald-50/70' : 'border-slate-100 bg-slate-50/70'}`}>
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${reached ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`}>
                        {reached ? <AppIcon name="check" size={20} /> : <span className="text-sm font-bold">{index + 1}</span>}
                      </div>
                      <div className="min-w-0 flex-1"><p className={`font-bold ${reached ? 'text-emerald-800' : 'text-slate-700'}`}>{milestone.title}</p><p className="mt-1 text-xs font-semibold text-slate-400">{rupiah(milestone.target_amount)}</p></div>
                      <span className={`text-xs font-bold ${reached ? 'text-emerald-700' : 'text-slate-400'}`}>{reached ? 'Tercapai' : 'Berikutnya'}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500"><AppIcon name="heart" size={23} /></div>
              <h2 className="mt-4 text-lg font-bold text-slate-900">Cerita dari perjalanan ini</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-500">Hubungkan cerita dan foto yang berkaitan dengan mimpi ini supaya perjalanannya punya kenangan.</p>
              <p className="mt-5 text-3xl font-bold text-slate-900">{linkedStoryCount.get(activeGoal.id) || 0}</p>
              <p className="text-xs font-semibold text-slate-400">cerita terhubung</p>
              <Link href={`/mutations?goal_id=${encodeURIComponent(activeGoal.id)}&goal_title=${encodeURIComponent(activeGoal.title)}`} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-600"><AppIcon name="heart" size={18} /> Tulis cerita perjalanan</Link>
            </Card>
          </section>
        </>
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="grid md:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6 md:p-9">
              <span className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-violet-100 text-violet-600"><AppIcon name="sparkles" size={27} /></span>
              <h2 className="mt-5 text-2xl font-bold text-slate-900">Mimpi apa yang mau kalian perjuangkan?</h2>
              <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-slate-500">Buat satu tujuan aktif. Progress akan bergerak otomatis dari saldo tanpa perlu dicatat dua kali.</p>
              <Button type="button" className="mt-6" onClick={openCreate}><AppIcon name="plus" size={18} /> Buat Goal Journey</Button>
            </div>
            <div className="flex min-h-64 items-center justify-center bg-gradient-to-br from-blue-100 via-violet-100 to-rose-100 p-8 text-center">
              <div><p className="text-6xl">🌱</p><p className="mt-4 text-lg font-bold text-slate-700">Mulai kecil, tumbuh bersama.</p><p className="mt-2 text-sm font-medium text-slate-500">Setiap setoran adalah satu langkah menuju cerita besar kalian.</p></div>
            </div>
          </div>
        </Card>
      )}

      {pastGoals.length > 0 ? (
        <section className="mt-6">
          <div className="mb-4"><h2 className="text-lg font-bold text-slate-900">Perjalanan sebelumnya</h2><p className="mt-1 text-sm font-medium text-slate-500">Mimpi yang sudah dirayakan atau disimpan.</p></div>
          <div className="grid gap-4 md:grid-cols-2">
            {pastGoals.map((goal) => {
              const progress = calculateGoalProgress(goal, totals.balance);
              const storyCount = linkedStoryCount.get(goal.id) || 0;
              return (
                <Card key={goal.id} className="!p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-2xl">{goal.icon}</div><div className="min-w-0"><span className={`badge ${statusClass(goal.status)}`}>{statusLabel(goal.status)}</span><h3 className="mt-2 truncate text-lg font-bold text-slate-900">{goal.title}</h3></div></div>
                    <p className="text-right text-sm font-bold text-slate-700">{progress.percent}%</p>
                  </div>
                  <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${goal.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-slate-400"><span>{rupiah(progress.amount)} dari {rupiah(goal.target_amount)}</span><span>{storyCount} cerita</span></div>
                  {goal.status === 'COMPLETED' ? <Link href={`/mutations?goal_id=${encodeURIComponent(goal.id)}&goal_title=${encodeURIComponent(goal.title)}`} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-rose-500 hover:underline"><AppIcon name="heart" size={17} /> Tulis cerita perayaan</Link> : null}
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <Modal open={formOpen} title={editing ? 'Atur Goal Journey' : 'Mulai Goal Journey'} description="Tentukan mimpi, target, dan milestone yang mau kalian rayakan." mobileSheet onClose={closeForm}>
        <form className="space-y-5" onSubmit={submitGoal}>
          <div>
            <label className="form-label" htmlFor="goal-title">Nama mimpi</label>
            <div className="mt-2 flex gap-2">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-2xl">{form.icon}</div>
              <input id="goal-title" className="form-input" maxLength={80} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Contoh: Liburan ke Bali" />
            </div>
          </div>

          <div>
            <span className="form-label">Pilih simbol mimpi</span>
            <div className="mt-2 grid grid-cols-8 gap-2">
              {GOAL_ICONS.map((icon) => <button key={icon} type="button" onClick={() => setForm({ ...form, icon })} aria-pressed={form.icon === icon} className={`flex aspect-square items-center justify-center rounded-2xl text-xl transition ${form.icon === icon ? 'bg-violet-100 ring-2 ring-violet-300' : 'bg-slate-50 hover:bg-slate-100'}`}>{icon}</button>)}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between"><label className="form-label" htmlFor="goal-description">Cerita singkat</label><span className="text-xs font-medium text-slate-400">{form.description.length}/240</span></div>
            <textarea id="goal-description" className="form-input mt-2 min-h-24 resize-none" maxLength={240} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Kenapa mimpi ini penting buat kalian?" />
          </div>

          <div>
            <label className="form-label" htmlFor="goal-target">Target tabungan</label>
            <RupiahInput id="goal-target" className="mt-2" value={form.target_amount} onValueChange={updateTarget} placeholder="0" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="form-label" htmlFor="goal-start-date">Mulai perjalanan</label><input id="goal-start-date" type="date" className="form-input mt-2" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} /></div>
            <div><label className="form-label" htmlFor="goal-target-date">Target tanggal <span className="font-medium text-slate-400">(opsional)</span></label><input id="goal-target-date" type="date" min={form.start_date} className="form-input mt-2" value={form.target_date} onChange={(event) => setForm({ ...form, target_date: event.target.value })} /></div>
          </div>

          <div>
            <span className="form-label">Mulai progress dari mana?</span>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <button type="button" disabled={Boolean(editing)} onClick={() => setForm({ ...form, progress_mode: 'CURRENT_BALANCE' })} className={`rounded-[22px] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${form.progress_mode === 'CURRENT_BALANCE' ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white'}`}><p className="font-bold text-slate-800">Hitung saldo sekarang</p><p className="mt-1 text-xs font-medium leading-5 text-slate-500">Progress awal menjadi {rupiah(totals.balance)}.</p></button>
              <button type="button" disabled={Boolean(editing)} onClick={() => setForm({ ...form, progress_mode: 'FROM_ZERO' })} className={`rounded-[22px] border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${form.progress_mode === 'FROM_ZERO' ? 'border-violet-300 bg-violet-50 ring-2 ring-violet-100' : 'border-slate-200 bg-white'}`}><p className="font-bold text-slate-800">Mulai dari nol</p><p className="mt-1 text-xs font-medium leading-5 text-slate-500">Hanya perubahan saldo setelah goal dibuat yang dihitung.</p></button>
            </div>
            {editing ? <p className="mt-2 text-xs font-medium text-slate-400">Cara menghitung progress dikunci setelah perjalanan dimulai agar riwayat tetap konsisten.</p> : null}
          </div>

          <div className="rounded-[26px] bg-slate-50 p-4">
            <div><p className="font-bold text-slate-800">Milestone otomatis</p><p className="mt-1 text-xs font-medium text-slate-500">Nominal mengikuti 25%, 50%, 75%, dan 100% dari target. Nama perayaannya bisa kalian ubah.</p></div>
            <div className="mt-4 space-y-3">
              {milestoneDrafts.map((milestone, index) => (
                <div key={index} className="grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-2xl bg-white p-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 text-xs font-bold text-violet-600">{[25, 50, 75, 100][index] || index + 1}%</span>
                  <input className="min-w-0 border-0 bg-transparent text-sm font-semibold text-slate-700 outline-none" maxLength={80} value={milestone.title} onChange={(event) => setMilestoneDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                  <span className="text-xs font-bold text-slate-400">{rupiah(milestone.target_amount)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1"><Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>Batal</Button><Button type="submit" disabled={saving}>{saving ? 'Menyimpan...' : editing ? 'Simpan perubahan' : 'Mulai perjalanan'}</Button></div>
        </form>
      </Modal>

      <ConfirmDialog open={Boolean(confirmAction)} title={confirmAction?.title || ''} description={confirmAction?.description} confirmLabel={confirmAction?.confirmLabel} tone={confirmAction?.tone} loading={confirmLoading} onClose={() => confirmLoading ? undefined : setConfirmAction(null)} onConfirm={runConfirm} />
    </main>
  );
}
