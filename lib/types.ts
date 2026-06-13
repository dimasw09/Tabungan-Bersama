export type MutationType = 'Tambah' | 'Penarikan';

export type DepositStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'PAID_LATE';
export type MonthlyProgressStatus = 'EMPTY' | 'INCOMPLETE' | 'COMPLETE' | 'OVERPAID';

export interface HouseholdMember {
  user_id: string;
  household_id: string;
  display_name: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface Profile {
  id: string;
  household_id: string;
  display_name: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  household_id: string;
  auth_user_id: string | null;
  name: string;
  monthly_amount: number;
  payday: number;
  color: string | null;
  created_at: string;
}

export interface MonthlyDeposit {
  id: string;
  household_id: string;
  member_id: string;
  year: number;
  month: number;
  due_date: string;
  required_amount: number;
  actual_transfer_date: string | null;
  paid_amount: number;
  proof_image_url: string | null;
  status: DepositStatus | string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  members?: Member | null;
}

export interface OtherMutation {
  id: string;
  household_id: string;
  mutation_date: string;
  type: MutationType;
  amount: number;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}


export interface StoryPhoto {
  id: string;
  household_id: string;
  mutation_id: string;
  storage_path: string;
  sort_order: number;
  uploaded_by: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  household_id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'SOFT_DELETE' | 'DELETE';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
}

export interface MonthlyRecap {
  key: string;
  year: number;
  month: number;
  mpipDeposit: number;
  kakakDeposit: number;
  totalPaidDeposits: number;
  additions: number;
  withdrawals: number;
  endingBalance: number;
}
