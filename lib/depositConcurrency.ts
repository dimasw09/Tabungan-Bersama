import type { MonthlyDeposit } from './types';

type PaymentDraftIdentity = {
  member: { id: string };
  deposit: Pick<MonthlyDeposit, 'id' | 'updated_at'> | null;
  year: number;
  month: number;
};

export const DEPOSIT_CONFLICT_MESSAGE = 'Setoran ini baru saja diubah dari tab atau perangkat lain. Muat data terbaru lalu coba lagi.';

export function isPaymentDraftAffectedByChange(draft: PaymentDraftIdentity | null, changed: Partial<MonthlyDeposit>) {
  if (!draft) return false;

  if (draft.deposit) {
    if (!changed.id || changed.id !== draft.deposit.id) return false;
    return !changed.updated_at || changed.updated_at !== draft.deposit.updated_at;
  }

  return changed.member_id === draft.member.id && changed.year === draft.year && changed.month === draft.month;
}
