'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Member, MonthlyDeposit } from '@/lib/types';
import { rupiah, safeDueDate } from '@/lib/format';
import { getComputedDepositStatus } from '@/lib/depositStatus';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';

const DEFAULT_MEMBER_NAMES = ['Mpip', 'Kakak'];

type MemberForm = {
  monthly_amount: number;
  payday: number;
  color: string;
};

const emptyForm: MemberForm = {
  monthly_amount: 0,
  payday: 1,
  color: '#E3A2C8'
};

function sortDefaultMembers(a: Member, b: Member) {
  return DEFAULT_MEMBER_NAMES.indexOf(a.name) - DEFAULT_MEMBER_NAMES.indexOf(b.name);
}

function MemberBigCard({ member, onEdit }: { member: Member; onEdit: (member: Member) => void }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-sm">
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-70" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }} />
      <div className="relative">
        <span className="badge text-stone-700" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>{member.name}</span>
        <p className="mt-5 text-xs font-black uppercase tracking-wide text-stone-400">Setoran wajib</p>
        <p className="mt-1 text-3xl font-black text-stone-900">{rupiah(member.monthly_amount)}</p>
        <p className="mt-2 text-sm font-bold text-stone-500">Setor tiap tanggal {member.payday}</p>
        <Button type="button" variant="secondary" className="mt-5" onClick={() => onEdit(member)}>
          Edit setting
        </Button>
      </div>
    </div>
  );
}

export default function MembersPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState<MemberForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncUnpaid, setSyncUnpaid] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const editingMember = useMemo(() => members.find((member) => member.id === editingId), [members, editingId]);
  const monthlyTarget = useMemo(() => members.reduce((sum, member) => sum + Number(member.monthly_amount || 0), 0), [members]);

  async function fetchMembers(showLoading = true) {
    if (showLoading) setLoading(true);
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .in('name', DEFAULT_MEMBER_NAMES)
      .order('name');
    if (showLoading) setLoading(false);

    if (error) {
      toast({ title: 'Gagal ambil anggota', message: error.message, type: 'error' });
      return;
    }

    setMembers(((data || []) as Member[]).sort(sortDefaultMembers));
  }

  useEffect(() => {
    fetchMembers();

    const channel = supabase
      .channel('members-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => fetchMembers(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function startEdit(member: Member) {
    setEditingId(member.id);
    setForm({
      monthly_amount: Number(member.monthly_amount),
      payday: Number(member.payday),
      color: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0')
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setSyncUnpaid(true);
  }

  async function syncUnpaidDeposits(memberId: string, monthlyAmount: number, payday: number) {
    const { data, error } = await supabase
      .from('monthly_deposits')
      .select('*')
      .eq('member_id', memberId)
      .lte('paid_amount', 0);

    if (error) throw error;

    const rows = ((data || []) as MonthlyDeposit[]).map((deposit) => {
      const dueDate = safeDueDate(deposit.year, deposit.month, payday);
      const nextDeposit = {
        ...deposit,
        due_date: dueDate,
        required_amount: monthlyAmount
      };

      return {
        id: deposit.id,
        member_id: deposit.member_id,
        year: deposit.year,
        month: deposit.month,
        due_date: dueDate,
        required_amount: monthlyAmount,
        actual_transfer_date: deposit.actual_transfer_date,
        paid_amount: Number(deposit.paid_amount || 0),
        proof_image_url: deposit.proof_image_url,
        status: getComputedDepositStatus(nextDeposit)
      };
    });

    if (rows.length === 0) return 0;

    const { error: upsertError } = await supabase.from('monthly_deposits').upsert(rows);
    if (upsertError) throw upsertError;
    return rows.length;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingId) return;

    if (Number(form.monthly_amount) <= 0 || Number(form.payday) < 1 || Number(form.payday) > 31) {
      toast({ title: 'Data anggota belum valid', message: 'Nominal harus lebih dari 0 dan tanggal setor harus 1 sampai 31.', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('members')
        .update({
          monthly_amount: Number(form.monthly_amount),
          payday: Number(form.payday),
          color: form.color
        })
        .eq('id', editingId);

      if (error) throw error;

      let syncedRows = 0;
      if (syncUnpaid) {
        syncedRows = await syncUnpaidDeposits(editingId, Number(form.monthly_amount), Number(form.payday));
      }

      toast({
        title: 'Data anggota berhasil diupdate',
        message: syncUnpaid ? `${syncedRows} setoran belum dibayar ikut disesuaikan.` : 'Setoran yang sudah digenerate tidak diubah.',
        type: 'success'
      });
      cancelEdit();
      fetchMembers(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi error tidak diketahui.';
      toast({ title: 'Gagal update anggota', message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Data Anggota"
        description="Anggota dikunci hanya Kakak dan Mpip. Nama tidak bisa ditambah/hapus/rename, tapi nominal, tanggal setor, dan warna label bisa diatur."
      />

      {members.length < 2 ? (
        <div className="mb-5">
          <EmptyState
            title="Data Kakak/Mpip belum lengkap"
            description="Jalankan supabase/schema.sql dulu supaya data default Kakak dan Mpip otomatis dibuat."
          />
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm font-black text-stone-500">Target bulanan</p>
          <p className="mt-2 text-3xl font-black text-stone-900">{rupiah(monthlyTarget)}</p>
          <p className="mt-1 text-xs font-bold text-stone-400">Total setoran wajib Kakak + Mpip</p>
        </Card>
        {members.map((member) => (
          <MemberBigCard key={member.id} member={member} onEdit={startEdit} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card>
          <h2 className="text-lg font-black text-stone-900">{editingMember ? `Edit ${editingMember.name}` : 'Pilih anggota'}</h2>
          <p className="mt-2 text-sm font-semibold text-stone-500">
            Kalau nominal/tanggal setor diubah, setoran yang belum dibayar bisa otomatis ikut disesuaikan supaya data ke depan tetap rapi.
          </p>

          {editingMember ? (
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="form-label">Nama</label>
                <input className="form-input mt-2 bg-stone-100 text-stone-500" value={editingMember.name} disabled />
              </div>
              <div>
                <label className="form-label">Nominal setoran wajib</label>
                <input
                  className="form-input mt-2"
                  type="number"
                  value={form.monthly_amount}
                  onChange={(event) => setForm({ ...form, monthly_amount: Number(event.target.value) })}
                  min={1}
                />
                <p className="mt-1 text-xs font-bold text-stone-500">Preview: {rupiah(form.monthly_amount)}</p>
              </div>
              <div>
                <label className="form-label">Tanggal setor bulanan</label>
                <input
                  className="form-input mt-2"
                  type="number"
                  value={form.payday}
                  onChange={(event) => setForm({ ...form, payday: Number(event.target.value) })}
                  min={1}
                  max={31}
                />
              </div>
              <div>
                <label className="form-label">Warna label</label>
                <div className="mt-2 flex gap-3">
                  <input
                    className="h-12 w-16 cursor-pointer rounded-2xl border border-white bg-white p-1 shadow-sm"
                    type="color"
                    value={form.color}
                    onChange={(event) => setForm({ ...form, color: event.target.value })}
                  />
                  <input className="form-input" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {['#E3A2C8', '#DFB2CB', '#D9D8D3', '#B4C6E2', '#A4BBE0'].map((paletteColor) => (
                    <button
                      key={paletteColor}
                      type="button"
                      className={`palette-chip ${form.color.toLowerCase() === paletteColor.toLowerCase() ? 'ring-2 ring-stone-400' : ''}`}
                      style={{ backgroundColor: paletteColor }}
                      onClick={() => setForm({ ...form, color: paletteColor })}
                      aria-label={`Pilih warna ${paletteColor}`}
                    />
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer gap-3 rounded-3xl palette-card p-4 text-sm font-bold text-stone-600">
                <input
                  type="checkbox"
                  checked={syncUnpaid}
                  onChange={(event) => setSyncUnpaid(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-stone-300"
                />
                <span>Ikut update nominal & jatuh tempo setoran yang belum dibayar</span>
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                  {saving ? 'Menyimpan...' : 'Update'}
                </Button>
                <Button type="button" variant="secondary" onClick={cancelEdit} className="w-full sm:w-auto">
                  Batal
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-3xl palette-card p-4 text-sm font-semibold text-stone-600">
              Klik tombol <b>Edit setting</b> di card anggota atau tabel sebelah kanan.
            </div>
          )}
        </Card>

        <Card>
          {members.length === 0 ? (
            <EmptyState title="Belum ada anggota" description="Jalankan SQL seed supaya Kakak dan Mpip dibuat otomatis." />
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {members.map((member) => (
                  <div key={member.id} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <span className="badge text-stone-700" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>{member.name}</span>
                      <span className="inline-block h-8 w-14 rounded-full border border-white shadow-sm" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }} />
                    </div>
                    <p className="mt-4 text-xs font-black uppercase tracking-wide text-stone-400">Nominal wajib</p>
                    <p className="mt-1 text-2xl font-black text-stone-900">{rupiah(member.monthly_amount)}</p>
                    <p className="mt-2 text-sm font-bold text-stone-500">Setor tanggal {member.payday}</p>
                    <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => startEdit(member)}>
                      Edit
                    </Button>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] overflow-hidden rounded-3xl bg-white/75">
                  <thead className="bg-white/90">
                    <tr>
                      <th className="table-th">Nama</th>
                      <th className="table-th">Nominal wajib</th>
                      <th className="table-th">Tanggal setor</th>
                      <th className="table-th">Warna</th>
                      <th className="table-th">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white">
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td className="table-td">
                          <span className="badge text-stone-700" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>
                            {member.name}
                          </span>
                        </td>
                        <td className="table-td font-black">{rupiah(member.monthly_amount)}</td>
                        <td className="table-td">Tanggal {member.payday}</td>
                        <td className="table-td">
                          <span className="inline-block h-7 w-14 rounded-full border border-white" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }} />
                        </td>
                        <td className="table-td">
                          <Button type="button" variant="secondary" onClick={() => startEdit(member)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
