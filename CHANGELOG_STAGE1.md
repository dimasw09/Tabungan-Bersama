# Hotfix 1.0.5 — Wajib Ganti Password Pertama

- Kakak dan Mpip diarahkan ke `/change-password` setelah login pertama menggunakan password bawaan.
- Password baru minimal 8 karakter dan wajib memiliki huruf serta angka.
- Password baru tidak boleh sama dengan username atau password bawaan yang sedang aktif.
- Flag keamanan disimpan pada Supabase Auth `app_metadata.must_change_password` sehingga tidak dapat diubah oleh client.
- Endpoint server `/api/auth/change-password` memverifikasi access token sebelum memperbarui password.
- Setelah berhasil, user wajib login ulang agar memperoleh token baru.
- `current_household_id()` menolak akses selama setup password belum selesai.
- Policy Storage bukti transfer juga diblokir sampai password selesai diganti.
- Menambahkan SQL `supabase/hotfix_1_0_5_force_first_password_change.sql`.

# Hotfix 1.0.4 — Username Login

- Login UI menggunakan username + password.
- Username dipetakan ke Supabase Auth hanya melalui endpoint server.
- Email tidak perlu diketahui user dan tidak dikirim kembali ke browser.
- Menambahkan tabel private `login_usernames` dan environment server-only `SUPABASE_SERVICE_ROLE_KEY`.
