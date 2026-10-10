import type { Member, MonthlyDeposit, OtherMutation } from './types';
import { currentYearMonth, monthLabel, safeDueDate, toNumber } from './format';

export type DepositReminder = {
  id: string;
  memberName: string;
  dueDate: string;
  remaining: number;
  daysUntilDue: number;
  status: 'overdue' | 'today' | 'soon' | 'upcoming';
};

export type DashboardActivity = {
  id: string;
  kind: 'deposit' | 'addition' | 'withdrawal';
  title: string;
  description: string;
  amount: number;
  date: string;
  updatedAt: string;
};

function dateAtUtcMidnight(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function buildDepositReminders(members: Member[], deposits: MonthlyDeposit[], now = new Date()): DepositReminder[] {
  const { year, month } = currentYearMonth(now);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  return members
    .map((member) => {
      const deposit = deposits.find((item) => item.member_id === member.id && item.year === year && item.month === month);
      const required = toNumber(deposit?.required_amount ?? member.monthly_amount);
      const remaining = Math.max(required - toNumber(deposit?.paid_amount), 0);
      if (remaining <= 0) return null;

      const dueDate = deposit?.due_date || safeDueDate(year, month, member.payday);
      const daysUntilDue = Math.round((dateAtUtcMidnight(dueDate) - today) / 86_400_000);
      const status = daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : daysUntilDue <= 3 ? 'soon' : 'upcoming';

      return {
        id: `${member.id}-${year}-${month}`,
        memberName: member.name,
        dueDate,
        remaining,
        daysUntilDue,
        status
      } satisfies DepositReminder;
    })
    .filter((item): item is DepositReminder => Boolean(item))
    .sort((left, right) => left.daysUntilDue - right.daysUntilDue || left.memberName.localeCompare(right.memberName));
}

export function buildDashboardActivities(deposits: MonthlyDeposit[], mutations: OtherMutation[], limit = 5): DashboardActivity[] {
  const depositActivities = deposits
    .filter((deposit) => toNumber(deposit.paid_amount) > 0)
    .map((deposit) => ({
      id: `deposit-${deposit.id}`,
      kind: 'deposit' as const,
      title: `${deposit.members?.name || 'Anggota'} menyetor`,
      description: `Setoran ${monthLabel(deposit.year, deposit.month)}`,
      amount: toNumber(deposit.paid_amount),
      date: deposit.actual_transfer_date || deposit.updated_at.slice(0, 10) || deposit.due_date,
      updatedAt: deposit.updated_at
    }));

  const mutationActivities = mutations.map((mutation) => ({
    id: `mutation-${mutation.id}`,
    kind: mutation.type === 'Tambah' ? 'addition' as const : 'withdrawal' as const,
    title: mutation.type === 'Tambah' ? 'Tambah rezeki' : 'Kepakai buat kita',
    description: mutation.description || 'Tanpa keterangan',
    amount: toNumber(mutation.amount),
    date: mutation.mutation_date,
    updatedAt: mutation.updated_at
  }));

  return [...depositActivities, ...mutationActivities]
    .sort((left, right) => right.date.localeCompare(left.date) || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(limit, 0));
}
