TABUNGAN BERSAMA KAKAK & MPIP — P1 v2.4.1
================================================

URUTAN DEPLOY
1. Pastikan P0_FIX_EXECUTE_ONCE.sql sudah pernah berhasil dijalankan.
2. Buka Supabase > SQL Editor > New query.
3. Copy seluruh isi supabase/P1_FIX_EXECUTE_ONCE.sql lalu Run satu kali.
4. Pastikan hasil verifikasi paling bawah semuanya true.
5. Deploy source v2.4.1 ke Vercel.

PENTING
- P1_FIX_EXECUTE_ONCE.sql bukan migration chain.
- SQL tidak mereset data, tidak menghapus setoran, cerita, capsule, atau user.
- SQL menjaga target setoran lama agar tidak berubah saat nominal anggota diperbarui.
- Foto aktif lama otomatis memakai file utama sebagai thumbnail fallback.
- Foto milik cerita yang sudah diarsipkan tidak disentuh agar trigger validasi tidak gagal.

YANG BERUBAH DI P1
- Target anggota dapat berlaku mulai bulan ini, bulan depan, periode pilihan, atau tanpa sinkronisasi.
- Hanya setoran belum dibayar mulai periode efektif yang ikut berubah.
- Foto JPG/PNG/WebP otomatis dikompres maksimal dimensi 1920 px.
- Thumbnail 480 px dibuat untuk daftar Cerita dan Love Capsule.
- GIF/HEIC/HEIF tetap disimpan asli apabila browser tidak dapat mengompresnya.
- Signed URL memakai cache agar realtime refresh tidak membuat URL berulang-ulang.
- Cleanup menghapus original dan thumbnail saat foto diganti/dibatalkan.
- Bukti transfer juga dikompres sebelum upload.
- Route besar dipisah ke features/deposits, features/stories, features/capsules, features/reports.
- ESLint, TypeScript, unit test, dan production build menjadi quality gate wajib.

QUALITY COMMAND
npm run lint
npm run typecheck
npm test
npm run build

VERIFIKASI SQL YANG DIHARAPKAN
story_thumbnail_rpc_ok       = true
capsule_thumbnail_rpc_ok     = true
member_period_rpc_ok         = true
story_thumbnail_column_ok    = true
capsule_thumbnail_column_ok  = true
