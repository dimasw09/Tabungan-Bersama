# Tabungan Bersama Kakak & Mpip — Tahap 2.3

Versi ini memakai source **tanpa Goal Journey** dan mempertahankan fitur yang sudah ada:

- Login username.
- Wajib ganti password pada login pertama.
- Kakak hanya dapat mengubah setoran Kakak.
- Mpip hanya dapat mengubah setoran Mpip.
- Cerita romantis dan album privat maksimal 10 foto.
- Setoran otomatis dibuat per tahun berjalan.
- Soft delete, arsip, audit log, dan RLS.
- Fix dropdown Lainnya pada card Cerita.

## Jejak Kita

Halaman Laporan diperbarui menjadi **Jejak Kita** dengan fokus pada kebersamaan, bukan kompetisi. Nominal Kakak dan Mpip tidak dibandingkan karena target masing-masing mengikuti 3% dari gaji.

Isi laporan:

- Ringkasan saldo dan pergerakan dana.
- Grafik perjalanan saldo bulanan.
- Bulan lengkap bersama dan streak kekompakan.
- Insight otomatis.
- Cerita berkesan dan jumlah foto.
- Ringkasan bulanan yang nyaman di mobile.
- Timeline gabungan Setoran dan Cerita.
- Export Excel berdasarkan periode yang dipilih.

## Export Excel

Klik **Export Excel** pada halaman Jejak Kita. File berisi:

1. Dashboard
2. Setoran Bulanan
3. Rekap Bulanan
4. Cerita
5. Panduan

Format mengikuti tracker Excel contoh: header teal, format Rupiah, tanggal, status berwarna, auto-filter, dan layout landscape.

Export dibuat melalui route server:

```text
POST /api/reports/excel
```

Tidak diperlukan service baru atau SQL tambahan.

## Environment

Buat `.env.local` di folder yang sama dengan `package.json`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=ISI_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=ISI_SERVICE_ROLE_KEY
```

Jangan commit `.env.local` atau membagikan service role key.

## Menjalankan project

```bash
npm install
npm run dev
```

`npm install` akan memasang dependency baru `exceljs`.

## Deploy Vercel

Pastikan ketiga environment variable tersedia di Vercel, lalu redeploy source terbaru.

## Pemeriksaan

```bash
npm run typecheck
npm run build
```

Detail perubahan tersedia di `CHANGELOG_STAGE2_3.md`.
