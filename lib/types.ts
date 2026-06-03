export type MutationType = 'Tambah' | 'Penarikan';

export type DepositStatus = 'Belum Dibayar' | 'Kurang' | 'Terbayar' | 'Terbayar Telat';

export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  name: string;
  monthly_amount: number;
  payday: number;
  color: string | null;
  created_at: string;
}

export interface MonthlyDeposit {
  id: string;
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
  members?: Member | null;
}

export interface OtherMutation {
  id: string;
  mutation_date: string;
  type: MutationType;
  amount: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyRecap {
  key: string;
  year: number;
  month: number;
  mpipDeposit: number;
  kakakDeposit: number;
  totalRequiredDeposits: number;
  additions: number;
  withdrawals: number;
  endingBalance: number;
}
