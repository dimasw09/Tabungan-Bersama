export type Agreement = {
  id: string;
  title: string;
  summary: string;
  points: string[];
  updatedAt: string;
};

export const AGREEMENTS_STORAGE_KEY = 'tabungan-bersama:agreements:v1';
export const AGREEMENTS_ACCEPTED_KEY = 'tabungan-bersama:agreements-accepted:v1';
export const AGREEMENTS_UPDATED_EVENT = 'tabungan-bersama:agreements-updated';

export const DEFAULT_AGREEMENTS: Agreement[] = [
  {
    id: 'shopping-subsidy',
    title: 'Kesepakatan Subsidi Belanja 💸❤️',
    summary: 'Aturan subsidi tiga bulanan supaya hak Kakak dan Mpip tetap adil, fleksibel, dan seimbang.',
    updatedAt: '2026-10-10T00:00:00.000Z',
    points: [
      'Periode subsidi berlaku setiap 3 bulan sekali.',
      'Jika membeli barang di bawah Rp200.000, subsidi yang didapat sebesar 80% dari harga barang. Contoh: Barang Rp100.000 → subsidi Rp80.000.',
      'Jika membeli barang Rp200.000 atau lebih, subsidi maksimal sebesar Rp200.000. Contoh: Barang Rp250.000 → subsidi Rp200.000. Barang Rp1.000.000 → tetap subsidi Rp200.000.',
      'Kesempatan subsidi tidak wajib digunakan jika sedang tidak membutuhkan barang. Tidak perlu memaksakan belanja hanya karena sedang masuk periode subsidi.',
      'Jika salah satu membutuhkan barang dan yang satunya tidak, pihak yang tidak belanja tetap mendapat nominal yang sama dengan subsidi pasangannya, dalam bentuk cash atau dimasukkan ke tabungan. Contoh: Mpip membeli barang Rp100.000 dan mendapat subsidi Rp80.000 → Kakak juga mendapat hak Rp80.000.',
      'Jika hak subsidi tidak digunakan, nominalnya dibawa ke periode 3 bulan berikutnya. Hak periode berikutnya menjadi subsidi normal ditambah sisa hak sebelumnya.',
      'Jika keduanya ingin membeli barang dari toko yang sama, pembelian dapat digabung menjadi satu pesanan agar bukti transaksi atau resi lebih sederhana.',
      'Tidak harus selalu belanja bersamaan atau membeli barang dengan harga yang sama. Yang terpenting, hak subsidi tetap dibuat seimbang sesuai kesepakatan.'
    ]
  }
];

function cloneDefaults() {
  return DEFAULT_AGREEMENTS.map((item) => ({ ...item, points: [...item.points] }));
}

function isAgreement(value: unknown): value is Agreement {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Agreement>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.summary === 'string'
    && typeof item.updatedAt === 'string'
    && Array.isArray(item.points)
    && item.points.every((point) => typeof point === 'string');
}

export function readAgreements() {
  try {
    const saved = window.localStorage.getItem(AGREEMENTS_STORAGE_KEY);
    if (!saved) return cloneDefaults();
    const parsed = JSON.parse(saved) as unknown;
    return Array.isArray(parsed) && parsed.every(isAgreement) ? parsed : cloneDefaults();
  } catch {
    return cloneDefaults();
  }
}

export function writeAgreements(agreements: Agreement[]) {
  window.localStorage.setItem(AGREEMENTS_STORAGE_KEY, JSON.stringify(agreements));
  window.dispatchEvent(new CustomEvent(AGREEMENTS_UPDATED_EVENT));
}

export function agreementRevision(agreements: Agreement[]) {
  return agreements.map((item) => `${item.id}:${item.updatedAt}`).join('|');
}
