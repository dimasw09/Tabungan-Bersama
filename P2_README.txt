TABUNGAN BERSAMA KAKAK & MPIP — P2 MOBILE PERFORMANCE v2.5.1

Tidak ada SQL baru untuk P2. Tetap gunakan database yang sudah menjalankan P0 dan P1_FIX_EXECUTE_ONCE_v2.4.1.sql.

PERUBAHAN UTAMA
1. Cerita hanya merender 8 kartu pertama; data berikutnya dibuka lewat tombol Muat lagi.
2. Love Capsule hanya merender 8 kartu pertama.
3. Riwayat Setoran hanya merender 12 item pertama.
4. Ringkasan bulanan dan timeline Report dirender bertahap.
5. Signed URL foto Cerita, Capsule, dan bukti transfer baru dibuat saat gambar mendekati viewport.
6. Foto original baru dimuat saat viewer benar-benar dibuka.
7. Preview Love Capsule dan viewer album dipisah sebagai dynamic chunk.
8. Grafik Report baru diunduh dan dirender saat bagian grafik mendekati viewport.
9. Realtime Cerita, Capsule, dan Setoran memperbarui item terkait tanpa refresh seluruh halaman.
10. Refresh realtime Dashboard dan Report digabung (debounced) agar beberapa event beruntun hanya memicu satu fetch.
11. Prefetch navigasi utama dimatikan agar halaman awal mobile tidak mengunduh seluruh route sekaligus.
12. Efek blur, jumlah hati, dan animasi loop dikurangi khusus layar kecil; animasi penting tetap aktif.
13. content-visibility diterapkan pada kartu panjang yang belum terlihat.

QUALITY GATE
- npm run lint
- npm run typecheck
- npm test
- npm run build

CATATAN
P2 tidak mengubah struktur database, RLS, nominal, data setoran, Cerita, atau Love Capsule.

HASIL UKUR BUILD (dibanding bundle P1 v2.4.1 di environment yang sama)
- App layout raw chunk: 23,188 B -> 16,088 B (-30.6%)
- Cerita raw route chunk: 37,183 B -> 29,450 B (-20.8%)
- Setoran raw route chunk: 39,042 B -> 30,822 B (-21.1%)
- Love Capsule raw route chunk: 52,666 B -> 40,653 B (-22.8%)
- Production build: 14/14 halaman berhasil dibuat.
- Production login check: HTTP 200.

HOTFIX v2.5.1
- Memutus loop fetch halaman Setoran yang dipicu dependency members pada efek realtime.
- Realtime tetap memakai data anggota terbaru melalui ref tanpa subscribe/fetch ulang.
- Tidak memerlukan SQL tambahan.
