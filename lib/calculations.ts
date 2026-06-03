import type { Member, MonthlyDeposit, MonthlyRecap, OtherMutation } from './types';
import { currentYearMonth, toNumber } from './format';
import { depositProgress, depositRemaining, getComputedDepositStatus } from './depositStatus';

function keyOf(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeName(name?: string | null) {
  return (name || '').trim().toLowerCase();
}

export function calculateTotals(deposits: MonthlyDeposit[], mutations: OtherMutation[]) {
  const totalDeposits = deposits.reduce((sum, item) => sum + toNumber(item.paid_amount), 0);
  const totalAdditions = mutations
    .filter((item) => item.type === 'Tambah')
    .reduce((sum, item) => sum + toNumber(item.amount), 0);
  const totalWithdrawals = mutations
    .filter((item) => item.type === 'Penarikan')
    .reduce((sum, item) => sum + toNumber(item.amount), 0);

  return {
    balance: totalDeposits + totalAdditions - totalWithdrawals,
    totalDeposits,
    totalAdditions,
    totalWithdrawals
  };
}

export function calculateCurrentMonthStats(members: Member[], deposits: MonthlyDeposit[]) {
  const { year, month } = currentYearMonth();
  const target = members.reduce((sum, member) => sum + toNumber(member.monthly_amount), 0);
  const currentDeposits = deposits.filter((item) => item.year === year && item.month === month);
  const paid = currentDeposits.reduce((sum, item) => sum + toNumber(item.paid_amount), 0);
  const progress = target > 0 ? Math.round((paid / target) * 100) : 0;

  let status = 'Belum Lengkap';
  if (target > 0 && paid === target) status = 'Lengkap';
  if (target > 0 && paid > target) status = 'Lebih';

  return { year, month, target, paid, remaining: Math.max(target - paid, 0), progress, status };
}

export function calculateMemberMonthStats(members: Member[], deposits: MonthlyDeposit[], year: number, month: number) {
  return members.map((member) => {
    const deposit = deposits.find((item) => item.member_id === member.id && item.year === year && item.month === month) || null;
    const required = deposit ? toNumber(deposit.required_amount) : toNumber(member.monthly_amount);
    const paid = deposit ? toNumber(deposit.paid_amount) : 0;

    return {
      member,
      deposit,
      required,
      paid,
      remaining: Math.max(required - paid, 0),
      progress: deposit ? depositProgress(deposit) : 0,
      status: deposit ? getComputedDepositStatus(deposit) : 'Belum Dibayar'
    };
  });
}

export function calculateFilteredDepositSummary(deposits: MonthlyDeposit[]) {
  const required = deposits.reduce((sum, item) => sum + toNumber(item.required_amount), 0);
  const paid = deposits.reduce((sum, item) => sum + toNumber(item.paid_amount), 0);
  const remaining = deposits.reduce((sum, item) => sum + depositRemaining(item), 0);
  const completeCount = deposits.filter((item) => getComputedDepositStatus(item) === 'Terbayar').length;
  const lateCount = deposits.filter((item) => getComputedDepositStatus(item) === 'Terbayar Telat').length;
  const problemCount = deposits.filter((item) => ['Belum Dibayar', 'Kurang'].includes(getComputedDepositStatus(item))).length;

  return { required, paid, remaining, completeCount, lateCount, problemCount, count: deposits.length };
}

export function calculateMonthlyRecaps(deposits: MonthlyDeposit[], mutations: OtherMutation[]): MonthlyRecap[] {
  const buckets = new Map<string, MonthlyRecap>();

  function ensureBucket(year: number, month: number) {
    const key = keyOf(year, month);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        year,
        month,
        mpipDeposit: 0,
        kakakDeposit: 0,
        totalRequiredDeposits: 0,
        additions: 0,
        withdrawals: 0,
        endingBalance: 0
      });
    }
    return buckets.get(key)!;
  }

  deposits.forEach((deposit) => {
    const bucket = ensureBucket(deposit.year, deposit.month);
    const paid = toNumber(deposit.paid_amount);
    const name = normalizeName(deposit.members?.name);

    if (name === 'mpip') bucket.mpipDeposit += paid;
    if (name === 'kakak') bucket.kakakDeposit += paid;
    bucket.totalRequiredDeposits += paid;
  });

  mutations.forEach((mutation) => {
    const date = new Date(`${mutation.mutation_date}T00:00:00`);
    const bucket = ensureBucket(date.getFullYear(), date.getMonth() + 1);
    const amount = toNumber(mutation.amount);

    if (mutation.type === 'Tambah') bucket.additions += amount;
    if (mutation.type === 'Penarikan') bucket.withdrawals += amount;
  });

  const sorted = Array.from(buckets.values()).sort((a, b) => a.year - b.year || a.month - b.month);
  let runningBalance = 0;
  return sorted.map((bucket) => {
    runningBalance += bucket.totalRequiredDeposits + bucket.additions - bucket.withdrawals;
    return { ...bucket, endingBalance: runningBalance };
  });
}
