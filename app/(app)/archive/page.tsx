'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import type { AuditLog, HouseholdMember, MonthlyDeposit, OtherMutation } from '@/lib/types';
import { formatDate, monthLabel, rupiah } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/ToastProvider';

type RestoreTarget = { kind: 'deposit' | 'mutation'; id: string; label: string } | null;

function auditLabel(log: AuditLog) {
  const table = log.table_name === 'monthly_deposits' ? 'setoran' : log.table_name === 'other_mutations' ? 'cerita' : log.table_name === 'story_photos' ? 'foto cerita' : 'anggota';
  const action = log.action === 'INSERT' ? 'menambah' : log.action === 'SOFT_DELETE' ? 'menghapus' : log.action === 'DELETE' ? 'menghapus permanen' : 'mengubah';
  return `${action} ${table}`;
}

export default function ArchivePage() {
  const { toast } = useToast();
  const [deposits, setDeposits] = useState<MonthlyDeposit[]>([]);
  const [mutations, setMutations] = useState<OtherMutation[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [memberships, setMemberships] = useState<HouseholdMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [target, setTarget] = useState<RestoreTarget>(null);

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    const userId = userResult.user?.id;
    if (userError || !userId) {
      if (showLoading) setLoading(false);
      toast({ title: 'Sesi tidak ditemukan', message: userError?.message || 'Silakan login ulang.', type: 'error' });
      return;
    }

    const [depositResult, mutationResult, logResult, membershipResult] = await Promise.all([
      supabase.from('monthly_deposits').select('*, members(*)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
      supabase.from('other_mutations').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
      supabase.from('audit_logs').select('*').order('changed_at', { ascending: false }).limit(30),
      supabase.from('household_members').select('*')
    ]);
    if (showLoading) setLoading(false);

    const error = depositResult.error || mutationResult.error || logResult.error || membershipResult.error;
    if (error) {
      toast({ title: 'Gagal membuka arsip', message: error.message, type: 'error' });
      return;
    }

    const nextMemberships = (membershipResult.data || []) as HouseholdMember[];
    setCurrentUserId(userId);
    setDeposits((depositResult.data || []) as MonthlyDeposit[]);
    setMutations((mutationResult.data || []) as OtherMutation[]);
    setLogs((logResult.data || []) as AuditLog[]);
    setMemberships(nextMemberships);
  }

  useEffect(() => { fetchData(); }, []);

  const names = useMemo(() => new Map(memberships.map((item) => [item.user_id, item.display_name])), [memberships]);

  function canRestoreDeposit(deposit: MonthlyDeposit) {
    return deposit.members?.auth_user_id === currentUserId;
  }

  async function restore() {
    if (!target) return;
    if (target.kind === 'deposit') {
      const deposit = deposits.find((item) => item.id === target.id);
      if (!deposit || !canRestoreDeposit(deposit)) {
        toast({ title: 'Akses ditolak', message: 'Arsip setoran ini hanya bisa dipulihkan oleh pemilik setoran.', type: 'error' });
        setTarget(null);
        return;
      }
    }
    setRestoring(true);
    const table = target.kind === 'deposit' ? 'monthly_deposits' : 'other_mutations';
    const { error } = await supabase.from(table).update({ deleted_at: null, deleted_by: null }).eq('id', target.id);
    setRestoring(false);

    if (error) {
      toast({ title: 'Gagal memulihkan data', message: error.code === '23505' ? 'Periode setoran aktif yang sama sudah ada. Hapus data pengganti dulu sebelum memulihkan arsip.' : error.message, type: 'error' });
      return;
    }

    toast({ title: 'Data berhasil dipulihkan', message: `${target.label} kembali masuk ke saldo dan riwayat.`, type: 'success' });
    setTarget(null);
    fetchData(false);
  }

  if (loading) return <LoadingState />;

  return (
    <main>
      <PageHeader title="Arsip & Audit" description="Data yang dihapus tidak langsung hilang. Pulihkan arsip dan cek jejak perubahan di sini." action={<Link href="/members" className="text-sm font-semibold text-[#3557bf] underline-offset-4 hover:underline">Kembali ke pengaturan</Link>} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-bold text-slate-900">Setoran terhapus</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Bukti transfer tetap tersimpan selama data berada di arsip.</p>
          {deposits.length === 0 ? <div className="mt-4"><EmptyState title="Arsip setoran kosong" description="Belum ada setoran yang dihapus." /></div> : (
            <div className="mt-4 space-y-3">
              {deposits.map((deposit) => (
                <div key={deposit.id} className="rounded-3xl bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-bold text-slate-900">{deposit.members?.name || 'Anggota'} · {monthLabel(deposit.year, deposit.month)}</p><p className="mt-1 text-sm font-medium text-slate-500">{rupiah(deposit.paid_amount)} · dihapus {formatDate(deposit.deleted_at)}</p></div>
                    <Button type="button" variant="secondary" disabled={!canRestoreDeposit(deposit)} onClick={() => setTarget({ kind: 'deposit', id: deposit.id, label: `Setoran ${deposit.members?.name || ''} ${monthLabel(deposit.year, deposit.month)}` })}>{canRestoreDeposit(deposit) ? 'Pulihkan' : 'Lihat saja'}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">Cerita terarsip</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Cerita yang diarsipkan tidak ikut dihitung dalam saldo. Foto kenangannya tetap aman.</p>
          {mutations.length === 0 ? <div className="mt-4"><EmptyState title="Arsip cerita kosong" description="Belum ada cerita yang diarsipkan." /></div> : (
            <div className="mt-4 space-y-3">
              {mutations.map((mutation) => (
                <div key={mutation.id} className="rounded-3xl bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-bold text-slate-900">{mutation.type} · {rupiah(mutation.amount)}</p><p className="mt-1 text-sm font-medium text-slate-500">{formatDate(mutation.mutation_date)} · {mutation.description || '-'}</p></div>
                    <Button type="button" variant="secondary" onClick={() => setTarget({ kind: 'mutation', id: mutation.id, label: `Cerita ${mutation.type} ${rupiah(mutation.amount)}` })}>Pulihkan</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="text-lg font-bold text-slate-900">30 aktivitas terbaru</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Jejak ini dibuat otomatis oleh database dan tidak bisa diedit dari aplikasi.</p>
        {logs.length === 0 ? <div className="mt-4"><EmptyState title="Belum ada aktivitas" /></div> : (
          <div className="mt-4 divide-y divide-slate-100">
            {logs.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <p className="font-semibold text-slate-700"><span className="capitalize">{names.get(log.changed_by || '') || 'Sistem'}</span> {auditLabel(log)}</p>
                <time className="text-xs font-medium text-slate-400" dateTime={log.changed_at}>{new Date(log.changed_at).toLocaleString('id-ID')}</time>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog open={Boolean(target)} title="Pulihkan data ini?" description={target ? `${target.label} akan kembali masuk ke perhitungan saldo dan riwayat.` : undefined} confirmLabel="Ya, pulihkan" loading={restoring} onClose={() => !restoring && setTarget(null)} onConfirm={restore} />
    </main>
  );
}
