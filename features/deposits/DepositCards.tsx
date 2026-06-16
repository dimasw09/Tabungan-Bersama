'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AppIcon } from '@/components/ui/AppIcon';
import { AnimatedNumber, AnimatedRupiah } from '@/components/ui/AnimatedNumber';
import { depositProgress, depositRemaining, depositStatusLabel, isDepositOverdue, statusBadgeClass } from '@/lib/depositStatus';
import { formatDate, rupiah } from '@/lib/format';
import { getSignedUrlCached } from '@/lib/storageMedia';
import { LazyStorageImage } from '@/components/ui/LazyStorageImage';
import type { DepositRow } from './depositModel';

export function ProofThumbnail({ path, onPreview }: { path: string | null; onPreview: (url: string) => void }) {
  if (!path) return <span className="text-xs font-semibold text-slate-400">Belum ada bukti cinta</span>;
  async function openPreview() {
    const url = await getSignedUrlCached('transfer-proofs', path);
    if (url) onPreview(url);
  }
  return <button type="button" onClick={() => void openPreview()} className="group h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><LazyStorageImage bucket="transfer-proofs" path={path} alt="Bukti transfer" className="h-14 w-14 object-cover transition group-hover:scale-105" /></button>;
}

export function PaymentCard({ row, onQuick, onCustom, onReset, onDelete, onPreview, saving, canManage }: {
  row: DepositRow;
  onQuick: (row: DepositRow) => void;
  onCustom: (row: DepositRow) => void;
  onReset: (row: DepositRow) => void;
  onDelete: (row: DepositRow) => void;
  onPreview: (url: string) => void;
  saving: boolean;
  canManage: boolean;
}) {
  const progress = depositProgress({ paid_amount: row.paid_amount, required_amount: row.required_amount });
  const remaining = depositRemaining({ paid_amount: row.paid_amount, required_amount: row.required_amount });
  const overdue = isDepositOverdue({ paid_amount: row.paid_amount, required_amount: row.required_amount, due_date: row.due_date });
  const hasPayment = row.paid_amount > 0;

  return (
    <div className="motion-card rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm md:rounded-[28px] md:p-5" style={{ boxShadow: '0 12px 30px rgba(52, 77, 147, 0.10)' }}>
      <div className="flex items-start justify-between gap-3">
        <div><span className="badge text-slate-700" style={{ backgroundColor: row.member.color || (row.member.name === 'Mpip' ? '#E3A2C8' : '#A4BBE0') }}>{row.member.name}</span><p className="mt-3 text-[26px] font-bold leading-tight text-slate-900 md:text-2xl">{rupiah(row.required_amount)}</p><p className="mt-1 text-sm font-medium text-slate-500">Batas setor {formatDate(row.due_date)}</p></div>
        <span className={`badge ${statusBadgeClass(row.status)}`}>{depositStatusLabel(row.status)}</span>
      </div>
      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Udah masuk</p><p className="mt-1 text-xl font-bold text-slate-900"><AnimatedRupiah value={row.paid_amount} /></p></div><p className="text-sm font-semibold text-[#3557bf]"><AnimatedNumber value={progress} formatter={(value) => `${Math.round(value)}%`} /></p></div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white"><div className="progress-reveal h-full rounded-full bg-[#4267d6]" style={{ width: `${progress}%` }} /></div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500"><span>TF: {formatDate(row.actual_transfer_date)}</span>{remaining > 0 ? <span className="text-[#b44967]">• Kurang dikit {rupiah(remaining)}</span> : null}{overdue ? <span className="text-amber-700">• Telat dikit</span> : null}</div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><ProofThumbnail path={row.proof_image_url} onPreview={onPreview} /><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bukti transfer</p><p className="mt-1 text-sm font-semibold text-slate-600">{row.proof_image_url ? 'Sudah tersedia' : 'Belum diunggah'}</p></div></div>
        {canManage ? <div className="flex w-full items-center gap-2 sm:w-auto"><Button type="button" variant={remaining > 0 ? 'primary' : 'secondary'} className="min-h-11 flex-1 px-4 sm:min-w-40" onClick={() => remaining > 0 ? onQuick(row) : onCustom(row)} disabled={saving}>{remaining > 0 ? (hasPayment ? 'Lengkapi setoran' : 'Catat setoran') : 'Lihat & edit'}</Button><details className="action-menu shrink-0"><summary aria-label={`Aksi lainnya untuk setoran ${row.member.name}`} className="flex h-11 w-11 items-center justify-center p-0"><AppIcon name="more" size={19} /></summary><div className="action-menu-panel space-y-2"><Button type="button" variant="secondary" className="w-full whitespace-nowrap" onClick={() => onCustom(row)}>Edit detail</Button>{hasPayment || row.proof_image_url ? <Button type="button" variant="secondary" className="w-full whitespace-nowrap" onClick={() => onReset(row)}>Reset pembayaran</Button> : null}{row.deposit ? <Button type="button" variant="danger" className="w-full whitespace-nowrap" onClick={() => onDelete(row)}>Hapus periode</Button> : null}</div></details></div> : <p className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500 sm:max-w-xs">Mode lihat saja. Hanya {row.member.name} yang dapat mengubah setoran ini.</p>}
      </div>
    </div>
  );
}

export function LocalProofPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  if (!file || !url) return null;
  return <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="mb-2 text-xs font-semibold text-slate-500">Preview bukti yang mau disimpan</p><img src={url} alt="Preview bukti transfer baru" className="max-h-48 w-full rounded-2xl object-contain bg-white" /><p className="mt-2 text-xs font-semibold text-slate-400">{file.name}</p></div>;
}

export function MiniSummaryCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return <div className="rounded-[22px] bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p>{helper ? <p className="mt-1 text-xs font-medium text-slate-400">{helper}</p> : null}</div>;
}
