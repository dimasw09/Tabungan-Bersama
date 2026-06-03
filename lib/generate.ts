import type { Member } from './types';
import { safeDueDate } from './format';

export interface DepositInsertRow {
  member_id: string;
  year: number;
  month: number;
  due_date: string;
  required_amount: number;
  paid_amount: number;
  status: string;
}

export function buildMonthlyDepositRows(members: Member[], startYear: number, startMonth: number, totalMonths: number) {
  const rows: DepositInsertRow[] = [];

  for (let index = 0; index < totalMonths; index += 1) {
    const date = new Date(startYear, startMonth - 1 + index, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    members.forEach((member) => {
      rows.push({
        member_id: member.id,
        year,
        month,
        due_date: safeDueDate(year, month, member.payday),
        required_amount: Number(member.monthly_amount),
        paid_amount: 0,
        status: 'Belum Dibayar'
      });
    });
  }

  return rows;
}
