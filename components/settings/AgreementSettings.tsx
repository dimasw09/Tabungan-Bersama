'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppIcon } from '@/components/ui/AppIcon';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastProvider';
import { readAgreements, writeAgreements, type Agreement } from '@/lib/agreements';

type AgreementForm = { title: string; summary: string; points: string };
const emptyForm: AgreementForm = { title: '', summary: '', points: '' };

export function AgreementSettings() {
  const { toast } = useToast();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agreement | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [form, setForm] = useState<AgreementForm>(emptyForm);
  const [initialForm, setInitialForm] = useState<AgreementForm>(emptyForm);

  const formDirty = form.title !== initialForm.title
    || form.summary !== initialForm.summary
    || form.points !== initialForm.points;

  useEffect(() => { setAgreements(readAgreements()); }, []);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setInitialForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(agreement: Agreement) {
    const nextForm = { title: agreement.title, summary: agreement.summary, points: agreement.points.join('\n') };
    setEditingId(agreement.id);
    setForm(nextForm);
    setInitialForm(nextForm);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setDiscardConfirmationOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setInitialForm(emptyForm);
  }

  function requestCloseForm() {
    if (formDirty) {
      setDiscardConfirmationOpen(true);
      return;
    }
    closeForm();
  }

  function persist(nextAgreements: Agreement[]) {
    try {
      writeAgreements(nextAgreements);
      setAgreements(nextAgreements);
      return true;
    } catch {
      toast({ title: 'Kesepakatan belum tersimpan', message: 'Penyimpanan browser tidak tersedia atau sedang penuh.', type: 'error' });
      return false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.title.trim();
    const summary = form.summary.trim();
    const points = form.points.split('\n').map((point) => point.trim()).filter(Boolean);

    if (!title || title.length > 100) {
      toast({ title: 'Judul belum valid', message: 'Judul wajib diisi dan maksimal 100 karakter.', type: 'error' });
      return;
    }
    if (summary.length > 240) {
      toast({ title: 'Ringkasan terlalu panjang', message: 'Ringkasan maksimal 240 karakter.', type: 'error' });
      return;
    }
    if (points.length === 0 || points.length > 20) {
      toast({ title: 'Poin belum valid', message: 'Isi minimal 1 dan maksimal 20 poin kesepakatan.', type: 'error' });
      return;
    }
    if (points.some((point) => point.length > 600)) {
      toast({ title: 'Poin terlalu panjang', message: 'Setiap poin maksimal 600 karakter.', type: 'error' });
      return;
    }

    const nextAgreement: Agreement = {
      id: editingId || crypto.randomUUID(),
      title,
      summary,
      points,
      updatedAt: new Date().toISOString()
    };
    const nextAgreements = editingId
      ? agreements.map((item) => item.id === editingId ? nextAgreement : item)
      : [...agreements, nextAgreement];

    if (!persist(nextAgreements)) return;
    toast({ title: editingId ? 'Kesepakatan diperbarui' : 'Kesepakatan ditambahkan', message: 'Beranda akan meminta kesepakatan ini dibaca kembali.', type: 'success' });
    closeForm();
  }

  function removeAgreement() {
    if (!deleteTarget) return;
    const nextAgreements = agreements.filter((item) => item.id !== deleteTarget.id);
    if (!persist(nextAgreements)) return;
    toast({ title: 'Kesepakatan dihapus', message: `${deleteTarget.title} sudah tidak ditampilkan di Beranda.`, type: 'success' });
    setDeleteTarget(null);
  }

  return (
    <Card className="mb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Kesepakatan bersama</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">Atur keterangan yang muncul di Beranda</h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">Tambah, ubah, atau hapus kesepakatan. Setiap perubahan akan meminta versi terbaru dibaca kembali.</p>
        </div>
        <Button type="button" className="shrink-0 gap-2" onClick={openCreate}><AppIcon name="plus" size={18} /> Tambah kesepakatan</Button>
      </div>

      {agreements.length === 0 ? (
        <div className="mt-5"><EmptyState title="Belum ada kesepakatan" description="Tambahkan kesepakatan pertama agar muncul saat Beranda dibuka." /></div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {agreements.map((agreement) => (
            <article key={agreement.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900">{agreement.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm font-medium leading-6 text-slate-500">{agreement.summary || `${agreement.points.length} poin kesepakatan`}</p>
                </div>
                <span className="badge shrink-0 bg-white text-[#4267d6]">{agreement.points.length} poin</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => openEdit(agreement)}>Edit</Button>
                <Button type="button" variant="danger" onClick={() => setDeleteTarget(agreement)}>Hapus</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={formOpen} title={editingId ? 'Edit kesepakatan' : 'Tambah kesepakatan'} description="Tulis setiap poin pada baris terpisah agar mudah dibaca." onClose={() => discardConfirmationOpen ? undefined : requestCloseForm()} mobileSheet>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="form-label" htmlFor="agreement-title">Judul</label>
            <input id="agreement-title" className="form-input mt-2" value={form.title} maxLength={100} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Contoh: Kesepakatan Liburan" required />
          </div>
          <div>
            <label className="form-label" htmlFor="agreement-summary">Ringkasan</label>
            <textarea id="agreement-summary" className="form-input mt-2 min-h-24 resize-y" value={form.summary} maxLength={240} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="Penjelasan singkat tujuan kesepakatan ini." />
            <p className="mt-1 text-right text-xs font-semibold text-slate-400">{form.summary.length}/240</p>
          </div>
          <div>
            <label className="form-label" htmlFor="agreement-points">Poin kesepakatan</label>
            <textarea id="agreement-points" className="form-input mt-2 min-h-56 resize-y" value={form.points} onChange={(event) => setForm({ ...form, points: event.target.value })} placeholder={'Satu poin pada setiap baris\nPoin kedua\nPoin ketiga'} required />
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">Tekan Enter untuk membuat poin baru. Maksimal 20 poin.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="secondary" className="min-h-12" onClick={requestCloseForm}>Batal</Button>
            <Button type="submit" className="min-h-12">{editingId ? 'Simpan perubahan' : 'Tambah kesepakatan'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus kesepakatan?"
        description={deleteTarget ? `${deleteTarget.title} akan dihapus dari Beranda.` : undefined}
        confirmLabel="Iya, hapus"
        tone="danger"
        onConfirm={removeAgreement}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={discardConfirmationOpen}
        title="Buang perubahan?"
        description="Perubahan pada kesepakatan ini belum disimpan. Kalau ditutup sekarang, isian terbarunya akan hilang."
        confirmLabel="Ya, buang perubahan"
        cancelLabel="Lanjut mengedit"
        tone="danger"
        onConfirm={closeForm}
        onClose={() => setDiscardConfirmationOpen(false)}
      />
    </Card>
  );
}
