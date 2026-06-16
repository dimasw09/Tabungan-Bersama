import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMemberMonthStats, calculateMonthlyRecaps, calculateTotals } from '../lib/calculations';
import { getDepositStatus, isDepositOverdue } from '../lib/depositStatus';
import { safeDueDate } from '../lib/format';
import { jakartaDateTimeToIso, nextAnniversary } from '../lib/loveCapsule';
import { resolveDepositSyncStart } from '../lib/memberSettings';
import { removeById, upsertById } from '../lib/realtimeState';
import type { Member, MonthlyDeposit, OtherMutation } from '../lib/types';

const member: Member = {
  id: 'member-1', household_id: 'household-1', auth_user_id: 'user-1', name: 'Kakak',
  monthly_amount: 200_000, payday: 28, color: '#A4BBE0', created_at: '2026-01-01T00:00:00Z'
};

function deposit(overrides: Partial<MonthlyDeposit> = {}): MonthlyDeposit {
  return {
    id: 'deposit-1', household_id: 'household-1', member_id: member.id,
    year: 2026, month: 6, due_date: '2026-06-28', required_amount: 162_000,
    actual_transfer_date: null, paid_amount: 0, proof_image_url: null, status: 'UNPAID',
    created_at: '', updated_at: '', deleted_at: null, deleted_by: null, members: member,
    ...overrides
  };
}

function mutation(overrides: Partial<OtherMutation>): OtherMutation {
  return {
    id: crypto.randomUUID(), household_id: 'household-1', mutation_date: '2026-06-10',
    type: 'Tambah', amount: 0, description: null, created_at: '', updated_at: '',
    deleted_at: null, deleted_by: null, ...overrides
  };
}

test('saldo menghitung setoran, tambahan, dan penarikan', () => {
  const result = calculateTotals(
    [deposit({ paid_amount: 162_000 })],
    [mutation({ type: 'Tambah', amount: 50_000 }), mutation({ type: 'Penarikan', amount: 25_000 })]
  );
  assert.deepEqual(result, {
    balance: 187_000,
    totalDeposits: 162_000,
    totalAdditions: 50_000,
    totalWithdrawals: 25_000
  });
});

test('rekap bulanan membawa saldo berjalan ke bulan berikutnya', () => {
  const recaps = calculateMonthlyRecaps(
    [deposit({ month: 6, paid_amount: 100_000 }), deposit({ id: 'deposit-2', month: 7, paid_amount: 50_000 })],
    [mutation({ mutation_date: '2026-06-20', type: 'Penarikan', amount: 20_000 }), mutation({ mutation_date: '2026-07-05', type: 'Tambah', amount: 10_000 })]
  );
  assert.equal(recaps[0].endingBalance, 80_000);
  assert.equal(recaps[1].endingBalance, 140_000);
});

test('target historis memakai required_amount snapshot, bukan target anggota terbaru', () => {
  const stats = calculateMemberMonthStats([member], [deposit({ required_amount: 162_000, paid_amount: 162_000 })], 2026, 6);
  assert.equal(stats[0].required, 162_000);
  assert.equal(stats[0].paid, 162_000);
  assert.equal(stats[0].status, 'PAID');
});

test('status setoran membedakan unpaid, partial, paid, dan telat', () => {
  assert.equal(getDepositStatus({ paidAmount: 0, requiredAmount: 100, dueDate: '2026-06-10' }), 'UNPAID');
  assert.equal(getDepositStatus({ paidAmount: 50, requiredAmount: 100, dueDate: '2026-06-10' }), 'PARTIAL');
  assert.equal(getDepositStatus({ paidAmount: 100, requiredAmount: 100, actualTransferDate: '2026-06-10', dueDate: '2026-06-10' }), 'PAID');
  assert.equal(getDepositStatus({ paidAmount: 100, requiredAmount: 100, actualTransferDate: '2026-06-11', dueDate: '2026-06-10' }), 'PAID_LATE');
  assert.equal(isDepositOverdue(deposit({ paid_amount: 50, required_amount: 100, due_date: '2026-06-10' }), '2026-06-11'), true);
});

test('tanggal jatuh tempo aman untuk bulan pendek', () => {
  assert.equal(safeDueDate(2027, 2, 31), '2027-02-28');
  assert.equal(safeDueDate(2028, 2, 31), '2028-02-29');
});

test('periode efektif target setoran tidak menyentuh bulan lalu', () => {
  const current = { year: 2026, month: 6 };
  assert.equal(resolveDepositSyncStart('current', '', current), '2026-06-01');
  assert.equal(resolveDepositSyncStart('next', '', current), '2026-07-01');
  assert.equal(resolveDepositSyncStart('custom', '2026-12', current), '2026-12-01');
  assert.equal(resolveDepositSyncStart('none', '', current), null);
  assert.throws(() => resolveDepositSyncStart('custom', '2026-05', current), /periode yang sudah lewat/i);
});

test('konversi waktu Love Capsule konsisten di WIB', () => {
  assert.equal(jakartaDateTimeToIso('2026-09-25', '00:00'), '2026-09-24T17:00:00.000Z');
  assert.equal(nextAnniversary(new Date('2026-09-25T00:00:01+07:00')).toISOString(), '2027-09-24T17:00:00.000Z');
});


test('realtime upsert memperbarui item tanpa duplikat', () => {
  const rows = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
  const updated = upsertById(rows, { id: 'a', value: 9 });
  assert.equal(updated.length, 2);
  assert.deepEqual(updated.find((row) => row.id === 'a'), { id: 'a', value: 9 });
});

test('realtime upsert bisa menjaga urutan list', () => {
  const rows = [{ id: 'a', value: 1 }, { id: 'b', value: 3 }];
  const updated = upsertById(rows, { id: 'c', value: 2 }, (left, right) => right.value - left.value);
  assert.deepEqual(updated.map((row) => row.id), ['b', 'c', 'a']);
});

test('realtime delete hanya menghapus item target', () => {
  const rows = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
  assert.deepEqual(removeById(rows, 'a'), [{ id: 'b', value: 2 }]);
});
