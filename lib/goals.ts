import type { GoalMilestone, Member, MonthlyDeposit, OtherMutation, SavingGoal } from './types';
import { toNumber } from './format';

export interface GoalProgress {
  amount: number;
  remaining: number;
  percent: number;
  reached: boolean;
}

export function calculateGoalProgress(goal: SavingGoal, currentBalance: number): GoalProgress {
  const target = Math.max(toNumber(goal.target_amount), 0);
  const amount = goal.status !== 'ACTIVE' && goal.completed_amount !== null
    ? Math.max(toNumber(goal.completed_amount), 0)
    : Math.max(toNumber(goal.starting_amount) + currentBalance - toNumber(goal.baseline_balance), 0);
  const percent = target > 0 ? Math.round((amount / target) * 100) : 0;
  return {
    amount,
    remaining: Math.max(target - amount, 0),
    percent,
    reached: target > 0 && amount >= target
  };
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthDifference(start: Date, end: Date) {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

export function calculateAverageMonthlySaving(
  members: Member[],
  deposits: MonthlyDeposit[],
  mutations: OtherMutation[],
  startDate?: string | null
) {
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = startDate ? new Date(`${startDate}T00:00:00`) : new Date(previousMonth.getFullYear(), previousMonth.getMonth() - 5, 1);
  const availableMonths = Math.max(0, monthDifference(new Date(start.getFullYear(), start.getMonth(), 1), previousMonth) + 1);
  const count = Math.min(6, availableMonths);
  const monthlyTarget = members.reduce((sum, member) => sum + toNumber(member.monthly_amount), 0);

  if (count <= 0) return monthlyTarget;

  const nets = new Map<string, number>();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(previousMonth.getFullYear(), previousMonth.getMonth() - offset, 1);
    nets.set(monthKey(date.getFullYear(), date.getMonth() + 1), 0);
  }

  deposits.forEach((deposit) => {
    const key = monthKey(deposit.year, deposit.month);
    if (nets.has(key)) nets.set(key, (nets.get(key) || 0) + toNumber(deposit.paid_amount));
  });

  mutations.forEach((mutation) => {
    const date = new Date(`${mutation.mutation_date}T00:00:00`);
    const key = monthKey(date.getFullYear(), date.getMonth() + 1);
    if (!nets.has(key)) return;
    const signed = mutation.type === 'Tambah' ? toNumber(mutation.amount) : -toNumber(mutation.amount);
    nets.set(key, (nets.get(key) || 0) + signed);
  });

  const average = Array.from(nets.values()).reduce((sum, value) => sum + value, 0) / count;
  return average > 0 ? average : monthlyTarget;
}

export function estimateGoalCompletion(progress: GoalProgress, monthlySaving: number) {
  if (progress.reached) return new Date();
  if (monthlySaving <= 0 || progress.remaining <= 0) return null;
  const months = Math.max(1, Math.ceil(progress.remaining / monthlySaving));
  const result = new Date();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function formatEstimatedMonth(date: Date | null) {
  if (!date) return 'Belum bisa diperkirakan';
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date);
}

export function reachedMilestoneCount(milestones: GoalMilestone[], amount: number) {
  return milestones.filter((milestone) => amount >= toNumber(milestone.target_amount)).length;
}
