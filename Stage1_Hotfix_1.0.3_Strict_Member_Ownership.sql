-- HOTFIX 1.0.3 - STRICT MEMBER OWNERSHIP
-- Jalankan SETELAH hotfix 1.0.2.
-- Aturan final:
-- 1) Kakak hanya boleh mengubah data Kakak.
-- 2) Mpip hanya boleh mengubah data Mpip.
-- 3) Keduanya tetap boleh melihat data household bersama.
-- 4) Role owner tidak dapat mengubah data anggota lain.

begin;

create or replace function public.can_manage_member(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    where m.id = target_member_id
      and m.household_id = public.current_household_id()
      and m.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.can_manage_member(uuid) from public, anon;
grant execute on function public.can_manage_member(uuid) to authenticated;

-- Pastikan policy anggota hanya mengizinkan akun pemilik baris.
drop policy if exists "Household users can update fixed members" on public.members;
drop policy if exists "Users can update allowed members" on public.members;
create policy "Users can update own member"
on public.members
for update
to authenticated
using (
  household_id = public.current_household_id()
  and public.can_manage_member(id)
)
with check (
  household_id = public.current_household_id()
  and public.can_manage_member(id)
);

-- Setoran hanya dapat dibuat/diubah oleh akun pemilik member_id.
drop policy if exists "Members can insert deposits" on public.monthly_deposits;
drop policy if exists "Members can update household deposits" on public.monthly_deposits;
drop policy if exists "Users can insert allowed deposits" on public.monthly_deposits;
drop policy if exists "Users can update allowed deposits" on public.monthly_deposits;
drop policy if exists "Users can insert own deposits" on public.monthly_deposits;
drop policy if exists "Users can update own deposits" on public.monthly_deposits;

create policy "Users can insert own deposits"
on public.monthly_deposits
for insert
to authenticated
with check (
  household_id = public.current_household_id()
  and public.can_manage_member(member_id)
);

create policy "Users can update own deposits"
on public.monthly_deposits
for update
to authenticated
using (
  household_id = public.current_household_id()
  and public.can_manage_member(member_id)
)
with check (
  household_id = public.current_household_id()
  and public.can_manage_member(member_id)
);

-- Bukti transfer hanya boleh diubah/dihapus untuk setoran milik akun sendiri.
drop policy if exists "Household can update transfer proofs" on storage.objects;
drop policy if exists "Household can delete transfer proofs" on storage.objects;

create policy "Household can update transfer proofs"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'transfer-proofs'
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
      and not exists (
        select 1
        from public.monthly_deposits d
        where d.id::text = (storage.foldername(name))[2]
           or d.id::text = (storage.foldername(name))[1]
      )
    )
  )
);

create policy "Household can delete transfer proofs"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'transfer-proofs'
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

-- VERIFIKASI LINK AKUN: dua baris harus berstatus OK.
select
  m.name,
  u.email,
  hm.role,
  case when m.auth_user_id = hm.user_id then 'OK' else 'BELUM TERHUBUNG' end as status_link
from public.members m
left join auth.users u on u.id = m.auth_user_id
left join public.household_members hm on hm.user_id = m.auth_user_id
where lower(m.name) in ('kakak', 'mpip')
order by m.name;
