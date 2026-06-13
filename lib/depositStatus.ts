import type { DepositStatus, MonthlyDeposit } from './types';
import { toNumber, todayInput } from './format';

interface DepositStatusInput {
  paidAmount: number | string | null | undefined;
  requiredAmount: number | string | null | undefined;
  actualTransferDate?: string | null;
  dueDate: string;
}

export const DEPOSIT_STATUS_OPTIONS: Array<{ value: DepositStatus; label: string }> = [
  { value: 'UNPAID', label: 'Belum Dibayar' },
  { value: 'PARTIAL', label: 'Kurang dikit' },
  { value: 'PAID', label: 'Terbayar' },
  { value: 'PAID_LATE', label: 'Terbayar Telat' }
];

export function depositStatusLabel(status: DepositStatus | string | null | undefined) {
  return DEPOSIT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Belum Dibayar';
}

export function getDepositStatus(input: DepositStatusInput): DepositStatus {
  const paidAmount = toNumber(input.paidAmount);
  const requiredAmount = toNumber(input.requiredAmount);

  if (!paidAmount || paidAmount <= 0) return 'UNPAID';
  if (paidAmount < requiredAmount) return 'PARTIAL';
  if (input.actualTransferDate && input.actualTransferDate > input.dueDate) return 'PAID_LATE';
  return 'PAID';
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
  return { ...deposit, status: getComputedDepositStatus(deposit) };
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

export function isDepositOverdue(deposit: Pick<MonthlyDeposit, 'paid_amount' | 'required_amount' | 'due_date'>, today = todayInput()) {
  return depositRemaining(deposit) > 0 && deposit.due_date < today;
}

export function statusBadgeClass(status: DepositStatus | string | null | undefined) {
  switch (status) {
    case 'PAID':
      return 'bg-skysoft-100 text-stone-800 ring-1 ring-skysoft-200';
    case 'PAID_LATE':
      return 'bg-creamsoft-100 text-stone-800 ring-1 ring-creamsoft-200';
    case 'PARTIAL':
      return 'bg-blush-100 text-stone-800 ring-1 ring-blush-200';
    default:
      return 'bg-stone-100 text-stone-600 ring-1 ring-stone-200';
  }
}

export function statusDotClass(status: DepositStatus | string | null | undefined) {
  switch (status) {
    case 'PAID':
      return 'bg-skysoft-300';
    case 'PAID_LATE':
      return 'bg-creamsoft-200';
    case 'PARTIAL':
      return 'bg-blush-300';
    default:
      return 'bg-stone-300';
  }
}
