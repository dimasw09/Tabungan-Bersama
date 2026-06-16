# Supabase — cara kerja project ini

Database utama project dikelola langsung melalui **Supabase Dashboard → SQL Editor**.
Folder ini tidak memakai migration runner otomatis.

## Acuan utama

- Struktur dan data yang sedang aktif di Supabase adalah sumber kebenaran utama.
- `schema.sql` adalah referensi/bootstrap untuk project baru, bukan perintah untuk dijalankan ulang ke database aktif.
- `link-users.example.sql` adalah contoh untuk menghubungkan user Authentication dengan Kakak dan Mpip.
- `sql-history/` berisi SQL manual yang pernah dibuat untuk tahap fitur atau hotfix. Periksa isi dan kondisi database sebelum menjalankan ulang.
- `archive/unused/` berisi eksperimen atau fitur yang saat ini tidak digunakan. Jangan dieksekusi ke database aktif.

## Alur perubahan database

1. Backup tabel yang terdampak bila perubahan menyentuh data penting.
2. Jalankan SQL yang diperlukan langsung dari Supabase SQL Editor.
3. Simpan SQL final ke `sql-history/` dengan nama yang jelas.
4. Tambahkan komentar tanggal, tujuan, dan apakah aman dijalankan ulang.
5. Setelah perubahan besar, perbarui `schema.sql` dari struktur database terbaru bila diperlukan.

## Catatan penting

Jangan menjalankan semua file dalam `sql-history/` secara berurutan tanpa pemeriksaan. Sebagian file dibuat untuk kondisi database pada tahap tertentu dan bisa saja sudah diterapkan di database aktif.
