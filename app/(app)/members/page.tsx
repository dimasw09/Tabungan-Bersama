'use client';

import { FormEvent, useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import type { Member } from '@/lib/types';
import { currentYearMonth, rupiah } from '@/lib/format';
import { resolveDepositSyncStart, type DepositSyncMode } from '@/lib/memberSettings';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { RupiahInput } from '@/components/ui/RupiahInput';

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

function MemberBigCard({ member, onEdit, canEdit }: { member: Member; onEdit: (member: Member) => void; canEdit: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-slate-100 bg-white/90 p-5 shadow-sm">
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-70" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }} />
      <div className="relative">
        <span className="badge text-slate-700" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>{member.name}</span>
        <p className="mt-5 text-xs font-bold uppercase tracking-wide text-slate-400">Target setoran</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">{rupiah(member.monthly_amount)}</p>
        <p className="mt-2 text-sm font-bold text-slate-500">Setor tiap tanggal {member.payday}</p>
        <Button type="button" variant="secondary" className="mt-5" onClick={() => onEdit(member)} disabled={!canEdit}>
          {canEdit ? 'Atur' : 'Lihat saja'}
        </Button>
      </div>
    </div>
  );
}

export default function MembersPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [form, setForm] = useState<MemberForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const nowPeriod = currentYearMonth();
  const [syncMode, setSyncMode] = useState<DepositSyncMode>('next');
  const [customSyncMonth, setCustomSyncMonth] = useState(`${nowPeriod.year}-${String(nowPeriod.month).padStart(2, '0')}`);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const editingMember = useMemo(() => members.find((member) => member.id === editingId), [members, editingId]);
  const monthlyTarget = useMemo(() => members.reduce((sum, member) => sum + Number(member.monthly_amount || 0), 0), [members]);

  const fetchMembers = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);

    const { data: userResult, error: userError } = await supabase.auth.getUser();
    const userId = userResult.user?.id;
    if (userError || !userId) {
      if (showLoading) setLoading(false);
      toast({ title: 'Sesi tidak ditemukan', message: userError?.message || 'Silakan login ulang.', type: 'error' });
      return;
    }

    const memberResult = await supabase.from('members').select('*').in('name', DEFAULT_MEMBER_NAMES).order('name');
    if (showLoading) setLoading(false);

    const error = memberResult.error;
    if (error) {
      toast({ title: 'Gagal ambil anggota', message: error.message, type: 'error' });
      return;
    }

    setCurrentUserId(userId);
    setMembers(((memberResult.data || []) as Member[]).sort(sortDefaultMembers));
  }, [toast]);

  useEffect(() => {
    fetchMembers();

    const channel = supabase
      .channel('members-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => fetchMembers(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMembers]);

  function canManageMember(member: Member | null | undefined) {
    return Boolean(member && member.auth_user_id === currentUserId);
  }

  function startEdit(member: Member) {
    if (!canManageMember(member)) {
      toast({ title: 'Pengaturan hanya bisa dilihat', message: `Akun ini tidak punya izin mengubah pengaturan ${member.name}.`, type: 'info' });
      return;
    }
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
    setSyncMode('next');
    setCustomSyncMonth(`${nowPeriod.year}-${String(nowPeriod.month).padStart(2, '0')}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingId) return;
    if (!canManageMember(editingMember)) {
      toast({ title: 'Akses ditolak', message: 'Pengaturan anggota ini tidak boleh diubah oleh akun yang sedang login.', type: 'error' });
      return;
    }

    const monthlyAmount = Number(form.monthly_amount);
    const payday = Number(form.payday);

    if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
      toast({ title: 'Data anggota belum valid', message: 'Nominal setoran harus lebih dari 0.', type: 'error' });
      return;
    }

    if (monthlyAmount > 1_000_000_000) {
      toast({ title: 'Nominal terlalu besar', message: 'Maksimal 1 miliar per anggota.', type: 'error' });
      return;
    }

    if (!Number.isInteger(payday) || payday < 1 || payday > 31) {
      toast({ title: 'Tanggal setor belum valid', message: 'Tanggal setor harus angka bulat 1 sampai 31.', type: 'error' });
      return;
    }

    if (!/^#[0-9A-F]{6}$/i.test(form.color)) {
      toast({ title: 'Warna profil belum valid', message: 'Gunakan format warna HEX, contoh #E3A2C8.', type: 'error' });
      return;
    }

    let syncFrom: string | null;
    try {
      syncFrom = resolveDepositSyncStart(syncMode, customSyncMonth, nowPeriod);
    } catch (error) {
      toast({ title: 'Periode belum valid', message: error instanceof Error ? error.message : 'Pilih periode mulai yang benar.', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('update_member_settings', {
        p_member_id: editingId,
        p_monthly_amount: monthlyAmount,
        p_payday: payday,
        p_color: form.color,
        p_effective_from: syncFrom
      });
      if (error) throw error;
      const syncedRows = Number(data || 0);

      toast({
        title: 'Setting berhasil disimpan',
        message: syncFrom ? `${syncedRows} setoran belum dibayar mulai periode pilihan ikut disesuaikan.` : 'Setoran yang sudah dibuat tidak diubah.',
        type: 'success'
      });
      cancelEdit();
      fetchMembers(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi error tidak diketahui.';
      toast({ title: 'Gagal simpan setting', message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader
        title="Pengaturan"
        description="Atur target setoran, tanggal jatuh tempo, dan warna profil milikmu."
        action={<Link href="/archive" className="inline-flex rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Arsip & audit</Link>}
      />

      <div className="mb-5 rounded-3xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-[#3557bf]">
        Kakak dan Mpip hanya bisa mengubah pengaturan milik akun masing-masing. Data pasangan tetap bisa dilihat.
      </div>

      {members.length < 2 ? (
        <div className="mb-5">
          <EmptyState
            title="Data Kakak/Mpip belum lengkap"
            description="Data Kakak dan Mpip belum tersedia atau belum terhubung ke household ini."
          />
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm font-bold text-slate-500">Target bulanan bersama</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{rupiah(monthlyTarget)}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">Total setoran wajib kita berdua</p>
        </Card>
        {members.map((member) => (
          <MemberBigCard key={member.id} member={member} onEdit={startEdit} canEdit={canManageMember(member)} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card>
          <h2 className="text-lg font-bold text-slate-900">{editingMember ? `Edit ${editingMember.name}` : 'Pilih Kakak/Mpip'}</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Kalau nominal atau tanggal setor berubah, setoran yang belum dibayar bisa ikut disesuaikan biar ke depannya tetap rapi.
          </p>

          {editingMember ? (
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="form-label" htmlFor="member-name">Nama anggota</label>
                <input id="member-name" className="form-input mt-2 bg-stone-100 text-slate-500" value={editingMember.name} disabled />
              </div>
              <div>
                <label className="form-label" htmlFor="member-monthly-amount">Nominal setoran</label>
                <RupiahInput
                  id="member-monthly-amount"
                  className="mt-2"
                  value={form.monthly_amount}
                  onValueChange={(value) => setForm({ ...form, monthly_amount: value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="member-payday">Tanggal setor</label>
                <input
                  id="member-payday"
                  className="form-input mt-2"
                  type="number"
                  value={form.payday}
                  onChange={(event) => setForm({ ...form, payday: Number(event.target.value) })}
                  min={1}
                  max={31}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="member-color-picker">Warna profil</label>
                <div className="mt-2 flex gap-3">
                  <input
                    id="member-color-picker"
                    aria-label="Pilih warna anggota"
                    className="h-12 w-16 cursor-pointer rounded-2xl border border-white bg-white p-1 shadow-sm"
                    type="color"
                    value={form.color}
                    onChange={(event) => setForm({ ...form, color: event.target.value })}
                  />
                  <input aria-label="Kode warna HEX" className="form-input" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
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
              <fieldset className="rounded-3xl palette-card p-4">
                <legend className="form-label px-1">Berlaku untuk setoran</legend>
                <p className="mb-3 text-xs font-semibold leading-5 text-stone-500">Target periode lama tidak akan berubah diam-diam. Hanya setoran belum dibayar mulai periode pilihan yang disesuaikan.</p>
                <div className="space-y-2">
                  {([
                    ['current', 'Mulai bulan ini'],
                    ['next', 'Mulai bulan depan'],
                    ['custom', 'Pilih periode mulai'],
                    ['none', 'Jangan ubah setoran yang sudah dibuat']
                  ] as Array<[DepositSyncMode, string]>).map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/75 px-3 py-2.5 text-sm font-bold text-stone-600">
                      <input type="radio" name="sync-mode" value={value} checked={syncMode === value} onChange={() => setSyncMode(value)} className="h-4 w-4 border-stone-300" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {syncMode === 'custom' ? (
                  <div className="mt-3">
                    <label className="text-xs font-bold text-stone-500" htmlFor="member-sync-month">Periode mulai</label>
                    <input id="member-sync-month" type="month" className="form-input mt-2" min={`${nowPeriod.year}-${String(nowPeriod.month).padStart(2, '0')}`} value={customSyncMonth} onChange={(event) => setCustomSyncMonth(event.target.value)} />
                  </div>
                ) : null}
              </fieldset>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </Button>
                <Button type="button" variant="secondary" onClick={cancelEdit} className="w-full sm:w-auto">
                  Batal
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-3xl palette-card p-4 text-sm font-semibold text-stone-600">
              Klik tombol <b>Atur</b> di card anggota atau tabel sebelah kanan.
            </div>
          )}
        </Card>

        <Card>
          {members.length === 0 ? (
            <EmptyState title="Data Kakak/Mpip belum ada" description="Data Kakak dan Mpip belum tersedia atau belum terhubung ke household ini." />
          ) : (
            <>
              <div className="grid gap-3 md:hidden">
                {members.map((member) => (
                  <div key={member.id} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <span className="badge text-slate-700" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>{member.name}</span>
                      <span className="inline-block h-8 w-14 rounded-full border border-white shadow-sm" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }} />
                    </div>
                    <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Nominal wajib</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{rupiah(member.monthly_amount)}</p>
                    <p className="mt-2 text-sm font-bold text-slate-500">Setor tanggal {member.payday}</p>
                    <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => startEdit(member)} disabled={!canManageMember(member)}>
                      {canManageMember(member) ? 'Edit' : 'Lihat saja'}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] overflow-hidden rounded-3xl bg-white/75">
                  <thead className="bg-white/90">
                    <tr>
                      <th className="table-th">Nama anggota</th>
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
                          <span className="badge text-slate-700" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>
                            {member.name}
                          </span>
                        </td>
                        <td className="table-td font-bold">{rupiah(member.monthly_amount)}</td>
                        <td className="table-td">Tanggal {member.payday}</td>
                        <td className="table-td">
                          <span className="inline-block h-7 w-14 rounded-full border border-white" style={{ backgroundColor: member.color || (member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }} />
                        </td>
                        <td className="table-td">
                          <Button type="button" variant="secondary" onClick={() => startEdit(member)} disabled={!canManageMember(member)}>
                            {canManageMember(member) ? 'Edit' : 'Terkunci'}
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
