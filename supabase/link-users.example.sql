-- GANTI email di bawah dengan email akun yang sudah dibuat di Supabase Authentication > Users.
-- Jalankan setelah supabase/stage1_migration.sql.

insert into public.household_members (user_id, household_id, display_name, role)
select id, '11111111-1111-4111-8111-111111111111', 'Kakak', 'owner'
from auth.users
where lower(email) = lower('EMAIL_KAKAK@CONTOH.COM')
on conflict (user_id) do update set household_id = excluded.household_id, display_name = excluded.display_name, role = excluded.role;

insert into public.household_members (user_id, household_id, display_name, role)
select id, '11111111-1111-4111-8111-111111111111', 'Mpip', 'member'
from auth.users
where lower(email) = lower('EMAIL_MPIP@CONTOH.COM')
on conflict (user_id) do update set household_id = excluded.household_id, display_name = excluded.display_name, role = excluded.role;

-- Hubungkan data anggota aplikasi ke akun Auth masing-masing.
-- Kolom auth_user_id tersedia setelah hotfix 1.0.2 / schema terbaru dijalankan.
update public.members m
set auth_user_id = hm.user_id
from public.household_members hm
where hm.household_id = m.household_id
  and lower(trim(hm.display_name)) = lower(trim(m.name));

-- Verifikasi: harus muncul tepat dua baris.
select hm.display_name, hm.role, u.email, m.auth_user_id
from public.household_members hm
join auth.users u on u.id = hm.user_id
left join public.members m on m.auth_user_id = hm.user_id
order by hm.role, hm.display_name;
