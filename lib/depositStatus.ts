import type { DepositStatus, MonthlyDeposit } from './types';
import { toNumber } from './format';

interface DepositStatusInput {
  paidAmount: number | string | null | undefined;
  requiredAmount: number | string | null | undefined;
  actualTransferDate?: string | null;
  dueDate: string;
}

export function getDepositStatus(input: DepositStatusInput): DepositStatus {
  const paidAmount = toNumber(input.paidAmount);
  const requiredAmount = toNumber(input.requiredAmount);

  if (!paidAmount || paidAmount <= 0) return 'Belum Dibayar';
  if (paidAmount < requiredAmount) return 'Kurang';
  if (input.actualTransferDate && input.actualTransferDate > input.dueDate) return 'Terbayar Telat';
  return 'Terbayar';
}

export function getComputedDepositStatus(deposit: Pick<MonthlyDeposit, 'paid_amount' | 'required_amount' | 'actual_transfer_date' | 'due_date'>) {
  return getDepositStatus({
    paidAmount: deposit.paid_amount,
    requiredAmount: deposit.required_amount,
    actualTransferDate: deposit.actual_transfer_date,
    dueDate: deposit.due_date
  });
}

export function normalizeDepositStatus<T extends MonthlyDeposit>(deposit: T): T {
  return {
    ...deposit,
    status: getComputedDepositStatus(deposit)
  };
}

export function normalizeDepositStatuses<T extends MonthlyDeposit>(deposits: T[]): T[] {
  return deposits.map(normalizeDepositStatus);
}

export function depositProgress(deposit: Pick<MonthlyDeposit, 'paid_amount' | 'required_amount'>) {
  const required = toNumber(deposit.required_amount);
  const paid = toNumber(deposit.paid_amount);
  if (required <= 0) return 0;
  return Math.min(Math.round((paid / required) * 100), 100);
}

export function depositRemaining(deposit: Pick<MonthlyDeposit, 'paid_amount' | 'required_amount'>) {
  return Math.max(toNumber(deposit.required_amount) - toNumber(deposit.paid_amount), 0);
}

export function isDepositOverdue(deposit: Pick<MonthlyDeposit, 'paid_amount' | 'required_amount' | 'due_date'>, today = new Date().toISOString().slice(0, 10)) {
  return depositRemaining(deposit) > 0 && deposit.due_date < today;
}

export function statusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'Terbayar':
      return 'bg-skysoft-200 text-stone-800 ring-1 ring-skysoft-300';
    case 'Terbayar Telat':
      return 'bg-creamsoft-200 text-stone-800 ring-1 ring-creamsoft-300';
    case 'Kurang':
      return 'bg-blush-200 text-stone-800 ring-1 ring-blush-300';
    default:
      return 'bg-stone-100 text-stone-600 ring-1 ring-stone-200';
  }
}

export function statusDotClass(status: string | null | undefined) {
  switch (status) {
    case 'Terbayar':
      return 'bg-skysoft-300';
    case 'Terbayar Telat':
      return 'bg-creamsoft-300';
    case 'Kurang':
      return 'bg-blush-300';
    default:
      return 'bg-stone-300';
  }
}
