# Tabungan Bersama Kakak & Mpip

Web app full-stack sederhana untuk tracking tabungan bersama pasangan. Versi ini **tanpa login**: begitu link dibuka, langsung masuk dashboard dan semua fitur bisa dipakai.

Default tabungan:

- Mpip: Rp78.000 per bulan, tanggal setor 10
- Kakak: Rp162.000 per bulan, tanggal setor 28
- Target bulanan: Rp240.000
- Data awal: mulai Juni 2026 selama 24 bulan

Stack:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Database
- Supabase Storage untuk foto bukti transfer
- Deploy target: Vercel

## Mode akses

App ini dibuat untuk mode sederhana:

- Tidak ada halaman login
- Tidak ada role
- Tidak ada akun Kakak/Mpip terpisah
- Semua orang yang punya link bisa lihat/tambah/edit/hapus setoran dan mutasi
- Data anggota dikunci hanya **Kakak** dan **Mpip**
- Nama anggota tidak bisa ditambah, dihapus, atau diganti
- Nominal setoran, tanggal setor, dan warna Kakak/Mpip tetap bisa diedit
- Cocok kalau link Vercel hanya dibagikan ke Kakak dan Mpip

> Penting: karena tanpa login, akses app bergantung pada kerahasiaan link. Kalau link tersebar, orang lain bisa ikut mengedit setoran dan mutasi. Kalau nanti mau lebih aman tanpa bikin auth custom, bisa aktifkan Vercel Password Protection / Deployment Protection.

## Fitur

- Dashboard saldo, total setoran, tambahan, penarikan, target bulan ini, progress, dan status bulan ini
- Data anggota fixed hanya Kakak dan Mpip; bisa edit nominal, tanggal setor, dan warna
- Generate setoran 24 bulan dari Juni 2026, generate per tahun, dan generate bulan berjalan
- CRUD setoran bulanan
- Date picker untuk tanggal jatuh tempo dan tanggal transfer aktual
- Upload foto bukti transfer ke Supabase Storage
- Preview kecil foto bukti transfer dan modal gambar besar
- CRUD mutasi lain: Tambah / Penarikan
- Rekap bulanan otomatis dari setoran dan mutasi
- Filter tahun, bulan, anggota, status pembayaran
- Search keterangan mutasi
- Toast notification, loading state, empty state, confirm dialog delete
- UI mobile friendly dengan soft romantic theme

## 1. Setup Supabase

1. Buat project baru di Supabase.
2. Buka **SQL Editor**.
3. Jalankan isi file:

```sql
supabase/schema.sql
```

File tersebut akan membuat:

- `profiles`
- `members`
- `monthly_deposits`
- `other_mutations`
- bucket storage `transfer-proofs`
- RLS policy untuk role `anon`, karena app ini tanpa login
- data default Kakak dan Mpip saja
- guard database supaya anggota selain Kakak/Mpip tidak bisa ditambah
- guard database supaya Kakak/Mpip tidak bisa dihapus atau diganti nama
- setoran awal 24 bulan dari Juni 2026

> Catatan: kolom `monthly_deposits.proof_image_url` menyimpan **storage path**, bukan public URL permanen. UI membuat signed URL saat preview.

### Kalau sebelumnya sudah menjalankan versi login

Paling aman gunakan Supabase project baru / reset tabel dulu, karena versi lama punya policy `authenticated`. Versi no-login ini sudah mencoba drop policy lama dan membuat policy `anon`, tapi kalau schema lama sudah banyak berubah, fresh setup lebih bersih.

## 2. Setup env lokal

Copy `.env.example` menjadi `.env.local`:

```bash
cp .env.example .env.local
```

Isi value dari Supabase Project Settings → API:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 3. Run lokal

Install dependency:

```bash
npm install
```

Jalankan development server:

```bash
npm run dev
```

Buka:

```txt
http://localhost:3000
```

App akan langsung redirect ke:

```txt
http://localhost:3000/dashboard
```

## 4. Cara generate data awal

Data awal sudah dibuat otomatis oleh `supabase/schema.sql`.

Kalau mau generate ulang dari UI:

1. Buka menu **Setoran**.
2. Klik salah satu tombol:
   - Generate 24 bulan dari Juni 2026
   - Generate Tahun
   - Generate Bulan Berjalan

Generate tidak akan duplicate karena tabel `monthly_deposits` punya unique constraint:

```sql
unique(member_id, year, month)
```

## 5. Deploy ke Vercel

1. Push project ini ke GitHub/GitLab.
2. Buka Vercel.
3. Klik **Add New Project**.
4. Import repository.
5. Isi Environment Variables:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

6. Deploy.

Build command default:

```bash
npm run build
```

Output framework akan terdeteksi otomatis sebagai Next.js.

## 6. Struktur folder penting

```txt
app/
  (app)/dashboard/
  (app)/members/
  (app)/deposits/
  (app)/mutations/
  (app)/recap/
components/
  layout/
  ui/
lib/
  calculations.ts
  depositStatus.ts
  format.ts
  generate.ts
  supabase/client.ts
  types.ts
supabase/
  schema.sql
```

## 7. Acceptance Checklist

- Bisa langsung buka app tanpa login
- Data anggota cuma Kakak dan Mpip
- Bisa edit nominal/tanggal/warna Kakak dan Mpip
- Bisa generate setoran bulanan
- Bisa CRUD setoran
- Bisa upload foto bukti TF
- Bisa CRUD mutasi tambah/penarikan
- Dashboard saldo berubah berdasarkan data terbaru
- Rekap bulanan berubah berdasarkan setoran dan mutasi terbaru
- Data tetap ada setelah refresh/browser ditutup karena tersimpan di Supabase
- Bisa deploy ke Vercel dengan env Supabase
