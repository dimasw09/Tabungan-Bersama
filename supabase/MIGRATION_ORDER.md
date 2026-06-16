# Supabase Migration Order

## Database yang sekarang sudah dipakai

Untuk upgrade source v2.3.0 ke v2.4.0, **jangan ulang seluruh file lama**. Backup lalu jalankan hanya:

```text
p0_stability_migration.sql
```

Setelah hasil VERIFIKASI semuanya `true`, baru deploy source v2.4.0.

## Project Supabase baru dari nol

Jalankan berurutan:

```text
1. schema.sql
2. hotfix_1_0_3_strict_member_ownership.sql
3. hotfix_1_0_4_username_login.sql
4. hotfix_1_0_5_force_first_password_change.sql
5. stage2_2_auto_yearly_deposits.sql
6. stage2_5_love_capsule.sql
7. p0_stability_migration.sql
8. link-users.example.sql (setelah dua user Auth dibuat dan email contoh diganti)
```

`schema.sql` sudah memuat fondasi Tahap 1 dan Story Album. File `stage1_migration.sql`, `hotfix_1_0_2_rls_member_ownership.sql`, dan `stage2_story_album.sql` dipertahankan hanya untuk database lama yang belum pernah mendapat bagian tersebut; jangan dijalankan lagi pada project baru setelah `schema.sql`.

`stage3_goal_journey.sql` bukan bagian dari release v2.4.0 dan tidak boleh dijalankan.

## Aturan deployment

Migration P0 mencabut hak tulis tabel langsung dari client. Source v2.3.0 tidak kompatibel setelah migration P0 aktif. Urutan yang benar adalah migration P0 lalu deploy v2.4.0 dalam maintenance window yang sama.
