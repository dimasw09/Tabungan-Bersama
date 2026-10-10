'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/ui/AppIcon';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import {
  AGREEMENTS_ACCEPTED_KEY,
  AGREEMENTS_STORAGE_KEY,
  AGREEMENTS_UPDATED_EVENT,
  agreementRevision,
  readAgreements,
  type Agreement
} from '@/lib/agreements';

export function ShoppingSubsidyAgreement() {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const revision = useMemo(() => agreementRevision(agreements), [agreements]);

  const refresh = useCallback(() => {
    const nextAgreements = readAgreements();
    const nextRevision = agreementRevision(nextAgreements);
    let hasAccepted = false;
    try {
      hasAccepted = Boolean(nextRevision) && window.localStorage.getItem(AGREEMENTS_ACCEPTED_KEY) === nextRevision;
    } catch {
      // Jika penyimpanan browser diblokir, kesepakatan tetap ditampilkan.
    }
    setAgreements(nextAgreements);
    setAccepted(hasAccepted);
    setOpen(nextAgreements.length > 0 && !hasAccepted);
  }, []);

  useEffect(() => {
    refresh();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === AGREEMENTS_STORAGE_KEY || event.key === AGREEMENTS_ACCEPTED_KEY) refresh();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(AGREEMENTS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(AGREEMENTS_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  function acceptAgreement() {
    try {
      window.localStorage.setItem(AGREEMENTS_ACCEPTED_KEY, revision);
    } catch {
      // Persetujuan tetap dapat ditutup untuk sesi ini meski localStorage tidak tersedia.
    }
    setAccepted(true);
    setOpen(false);
  }

  return (
    <>
      <Card className="mb-5 overflow-hidden !border-blue-100 !bg-gradient-to-r !from-blue-50 !to-white !p-4 md:!p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#4267d6] shadow-sm">
              <AppIcon name="receipt" size={21} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold text-slate-900">Kesepakatan Bersama</h2>
                {accepted && agreements.length > 0 ? <span className="badge bg-emerald-100 text-emerald-700">Sudah dibaca</span> : null}
              </div>
              <p className="mt-1 text-sm font-medium leading-6 text-slate-500">
                {agreements.length > 0 ? `${agreements.length} kesepakatan aktif untuk Kakak dan Mpip.` : 'Belum ada kesepakatan yang ditambahkan.'}
              </p>
            </div>
          </div>
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => setOpen(true)} disabled={agreements.length === 0}>
            Baca kesepakatan
          </Button>
        </div>
      </Card>

      <Modal
        open={open && agreements.length > 0}
        title="Kesepakatan Bersama 💸❤️"
        description="Dibaca bersama agar setiap keputusan tetap jelas, adil, dan tidak menimbulkan salah paham."
        onClose={() => setOpen(false)}
        mobileSheet
      >
        <div className="space-y-5">
          {agreements.map((agreement, agreementIndex) => (
            <section key={agreement.id} className="rounded-[1.75rem] border border-slate-100 bg-slate-50/70 p-4" aria-labelledby={`agreement-${agreement.id}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#4267d6] shadow-sm">
                  <AppIcon name={agreementIndex === 0 ? 'receipt' : 'heart'} size={20} />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-500">Kesepakatan {agreementIndex + 1}</p>
                  <h3 id={`agreement-${agreement.id}`} className="mt-1 text-lg font-bold text-slate-900">{agreement.title}</h3>
                  {agreement.summary ? <p className="mt-1 text-sm font-medium leading-6 text-slate-500">{agreement.summary}</p> : null}
                </div>
              </div>

              <ol className="mt-4 space-y-3">
                {agreement.points.map((point, pointIndex) => <AgreementItem key={`${agreement.id}-${pointIndex}`} number={pointIndex + 1} point={point} />)}
              </ol>
            </section>
          ))}
        </div>

        <div className="mt-5 rounded-3xl border border-rose-100 bg-rose-50 p-4">
          <div className="flex gap-3">
            <span className="mt-0.5 text-rose-500"><AppIcon name="heart" size={20} /></span>
            <p className="text-sm font-semibold leading-6 text-slate-700">Kesepakatan dapat dibaca ulang kapan saja dari Beranda dan dikelola melalui halaman Pengaturan.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="secondary" className="min-h-12" onClick={() => setOpen(false)}>Baca lagi nanti</Button>
          <Button type="button" className="min-h-12 gap-2" onClick={acceptAgreement}>
            <AppIcon name="check" size={18} /> Saya mengerti & setuju
          </Button>
        </div>
      </Modal>
    </>
  );
}

function AgreementItem({ number, point }: { number: number; point: string }) {
  const [mainText, example] = point.split(' Contoh:', 2);
  return (
    <li className="flex gap-3 rounded-3xl border border-slate-100 bg-white p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4267d6] text-sm font-black text-white">{number}</span>
      <div className="text-sm font-medium leading-6 text-slate-600">
        <p>{mainText}</p>
        {example ? <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-500">Contoh: {example.trim()}</p> : null}
      </div>
    </li>
  );
}
