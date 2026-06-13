-- HOTFIX 1.0.5 - WAJIB GANTI PASSWORD PADA LOGIN PERTAMA
-- Jalankan SETELAH hotfix username login 1.0.4.
--
-- Efek:
-- 1) Akun Kakak dan Mpip yang belum pernah menyelesaikan setup password akan diberi
--    app_metadata.must_change_password = true.
-- 2) Selama flag tersebut masih true, current_household_id() mengembalikan NULL sehingga
--    seluruh policy data household menolak akses.
-- 3) Policy Storage juga ditutup sampai password berhasil diganti dan user login ulang.
--
-- SQL aman dijalankan ulang: akun yang sudah memiliki password_changed_at tidak dipaksa ulang.

begin;

-- Tandai kedua akun untuk melakukan penggantian password pertama.
update auth.users u
set raw_app_meta_data =
  (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'password_changed_at')
  || jsonb_build_object('must_change_password', true)
from public.household_members hm
where hm.user_id = u.id
  and lower(btrim(hm.display_name)) in ('kakak', 'mpip')
  and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'password_changed_at');

-- Satu pintu seluruh RLS household: user yang masih wajib ganti password belum memperoleh household_id.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select hm.household_id
  from public.household_members hm
  where hm.user_id = auth.uid()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'must_change_password', 'false') <> 'true'
  limit 1;
$$;

revoke all on function public.current_household_id() from public, anon;
grant execute on function public.current_household_id() to authenticated;

-- Ganti seluruh policy bucket agar tidak ada jalur lama yang melewati current_household_id().
drop policy if exists "Household can read transfer proofs" on storage.objects;
drop policy if exists "Household can upload transfer proofs" on storage.objects;
drop policy if exists "Household can update transfer proofs" on storage.objects;
drop policy if exists "Household can delete transfer proofs" on storage.objects;

create policy "Household can read transfer proofs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'transfer-proofs'
  and public.current_household_id() is not null
  and (
    (storage.foldername(name))[1] = public.current_household_id()::text
    or exists (
      select 1
      from public.monthly_deposits d
      where d.id::text = (storage.foldername(name))[1]
        and d.household_id = public.current_household_id()
    )
  )
);

create policy "Household can upload transfer proofs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'transfer-proofs'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
);

create policy "Household can update transfer proofs"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'transfer-proofs'
  and public.current_household_id() is not null
  and (
    exists (
      select 1
      from public.monthly_deposits d
      where (
        d.id::text = (storage.foldername(name))[2]
        or d.id::text = (storage.foldername(name))[1]
      )
      and public.can_manage_member(d.member_id)
    )
    or (
      owner_id = auth.uid()::text
      and (storage.foldername(name))[1] = public.current_household_id()::text
      and not exists (
        select 1
        from public.monthly_deposits d
        where d.id::text = (storage.foldername(name))[2]
           or d.id::text = (storage.foldername(name))[1]
      )
    )
  )
)
with check (
  bucket_id = 'transfer-proofs'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
);

create policy "Household can delete transfer proofs"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'transfer-proofs'
  and public.current_household_id() is not null
  and (
    exists (
      select 1
      from public.monthly_deposits d
      where (
        d.id::text = (storage.foldername(name))[2]
        or d.id::text = (storage.foldername(name))[1]
      )
      and public.can_manage_member(d.member_id)
    )
    or (
      owner_id = auth.uid()::text
      and (storage.foldername(name))[1] = public.current_household_id()::text
      and not exists (
        select 1
        from public.monthly_deposits d
        where d.id::text = (storage.foldername(name))[2]
           or d.id::text = (storage.foldername(name))[1]
      )
    )
  )
);

commit;

-- VERIFIKASI: sebelum login pertama selesai, dua baris harus berstatus WAJIB GANTI PASSWORD.
select
  hm.display_name,
  lu.username,
  u.email,
  case
    when coalesce(u.raw_app_meta_data ->> 'must_change_password', 'false') = 'true'
      then 'WAJIB GANTI PASSWORD'
    else 'SUDAH SELESAI'
  end as status_password,
  u.raw_app_meta_data ->> 'password_changed_at' as password_changed_at
from public.household_members hm
join auth.users u on u.id = hm.user_id
left join public.login_usernames lu on lu.user_id = hm.user_id
where lower(btrim(hm.display_name)) in ('kakak', 'mpip')
order by hm.display_name;
