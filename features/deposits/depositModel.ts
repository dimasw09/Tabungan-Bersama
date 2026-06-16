import type { DepositStatus, Member, MonthlyDeposit } from '@/lib/types';
import { monthLabel, rupiah, todayInput } from '@/lib/format';

export const MIN_DEPOSIT_YEAR = 2026;
export const MAX_PROOF_SIZE = 5 * 1024 * 1024;
export const ALLOWED_PROOF_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const DEFAULT_MEMBER_ORDER = ['Mpip', 'Kakak'];

export type DepositRow = {
  member: Member;
  deposit: MonthlyDeposit | null;
  year: number;
  month: number;
  due_date: string;
  required_amount: number;
  actual_transfer_date: string | null;
  paid_amount: number;
  proof_image_url: string | null;
  status: DepositStatus;
};

export type PaymentDraft = {
  member: Member;
  deposit: MonthlyDeposit | null;
  year: number;
  month: number;
  due_date: string;
  required_amount: number;
  actual_transfer_date: string;
  paid_amount: number;
  proofFile: File | null;
  mode: 'quick' | 'custom';
};

export type ConfirmAction = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
};

export function sortMembers(a: Member, b: Member) {
  const aIndex = DEFAULT_MEMBER_ORDER.indexOf(a.name);
  const bIndex = DEFAULT_MEMBER_ORDER.indexOf(b.name);
  if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  return a.name.localeCompare(b.name);
}

export function isValidDateText(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function shiftMonth(year: number, month: number, diff: number) {
  const date = new Date(year, month - 1 + diff, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function validatePaymentDraft(draft: PaymentDraft | null) {
  if (!draft) return 'Setoran belum dipilih, sayang.';
  const paidAmount = Number(draft.paid_amount || 0);
  const requiredAmount = Number(draft.required_amount || 0);
  const hasExistingProof = Boolean(draft.deposit?.proof_image_url);
  const hasNewProof = Boolean(draft.proofFile);

  if (!Number.isFinite(requiredAmount) || requiredAmount <= 0) return 'Nominal wajibnya belum valid.';
  if (!Number.isFinite(paidAmount) || paidAmount < 0) return 'Nominal yang masuk tidak boleh minus.';
  if (paidAmount > 1_000_000_000) return 'Nominal yang masuk terlalu besar. Maksimal Rp1.000.000.000.';
  if (paidAmount > 0 && !draft.actual_transfer_date) return 'Tanggal transfer wajib diisi kalau nominal masuk lebih dari 0.';
  if (draft.actual_transfer_date && !isValidDateText(draft.actual_transfer_date)) return 'Tanggal transfer tidak valid.';
  if (draft.actual_transfer_date && draft.actual_transfer_date > todayInput()) return 'Tanggal transfer tidak boleh lebih dari hari ini.';
  if (paidAmount > 0 && !hasExistingProof && !hasNewProof) return 'Bukti transfer wajib diupload kalau nominal masuk lebih dari 0.';
  if (paidAmount <= 0 && hasNewProof) return 'Nominal yang masuk harus lebih dari 0 kalau upload bukti TF.';
  if (draft.proofFile && !draft.proofFile.type.startsWith('image/')) return 'Bukti transfer wajib berupa file gambar.';
  if (draft.proofFile && draft.proofFile.size > MAX_PROOF_SIZE) return 'Ukuran foto bukti TF maksimal 5MB ya.';
  return null;
}

export function getPaymentDraftWarnings(draft: PaymentDraft) {
  const warnings: string[] = [];
  const paidAmount = Number(draft.paid_amount || 0);
  const requiredAmount = Number(draft.required_amount || 0);

  if (paidAmount > requiredAmount) warnings.push(`Nominal yang masuk lebih besar dari setoran wajib. Kelebihan ${rupiah(paidAmount - requiredAmount)} bakal ikut bikin saldo cinta kita makin gemuk.`);
  if (draft.actual_transfer_date && isValidDateText(draft.actual_transfer_date)) {
    const [transferYear, transferMonth] = draft.actual_transfer_date.split('-').map(Number);
    if (transferYear !== draft.year || transferMonth !== draft.month) warnings.push(`Tanggal transfer berada di luar periode ${monthLabel(draft.year, draft.month)}. Kalau lanjut, data tetap dicatat ke bulan yang dipilih.`);
  }
  if (paidAmount > 0 && paidAmount < requiredAmount) warnings.push(`Nominal yang masuk kurang ${rupiah(requiredAmount - paidAmount)} dari setoran wajib. Status akan menjadi Kurang dikit.`);
  return warnings;
}
