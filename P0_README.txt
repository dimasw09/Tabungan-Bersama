TABUNGAN BERSAMA KAKAK & MPIP — P0 FIX v2.3.1

WAJIB SEBELUM MENJALANKAN SOURCE:
1. Buka Supabase > SQL Editor.
2. Jalankan seluruh isi: supabase/P0_FIX_EXECUTE_ONCE.sql
3. Pastikan hasil verifikasi terakhir menampilkan:
   rate_limit_ok = true
   story_atomic_ok = true
   capsule_atomic_ok = true
   member_atomic_ok = true
   capsule_cancel_ok = true
   transfer_proof_limit = 5242880
4. Pastikan environment Vercel/local tetap berisi:
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
5. Jalankan npm ci lalu npm run build.

FIX YANG SUDAH MASUK:
- Penarikan dan pengurangan setoran dikunci per household serta ditolak database jika membuat saldo minus.
- Cerita + metadata album disimpan dalam satu transaksi database.
- Love Capsule + isi + metadata foto disimpan dalam satu transaksi database.
- Pengaturan anggota + sinkronisasi setoran belum dibayar menjadi atomik.
- Export Excel wajib session, dibatasi rate limit, dan datanya diambil ulang dari Supabase server.
- Login dan ganti password memiliki rate limit IP/akun.
- Bucket transfer-proofs dibatasi 5 MB dan hanya menerima format gambar yang diizinkan.
- Love Capsule mengecek waktu otomatis, saat tab aktif kembali, dan snooze berlaku per capsule selama 15 menit.

CATATAN:
- Migration lama tidak dirombak sesuai permintaan. File P0 di atas adalah patch execute-once langsung untuk SQL Editor.
- Jangan deploy source v2.3.1 sebelum SQL P0 dijalankan karena frontend memakai RPC baru.
