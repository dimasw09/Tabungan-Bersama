import type { Member, MonthlyDeposit, MonthlyRecap, OtherMutation } from './types';

export interface ReportExcelInput {
  members: Member[];
  deposits: MonthlyDeposit[];
  mutations: OtherMutation[];
  recaps: MonthlyRecap[];
  filterYear: string;
  photoCounts: Record<string, number>;
}
