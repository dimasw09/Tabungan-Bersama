-- HOTFIX 1.0.2
-- Jalankan SETELAH Stage1_Migration_Supabase.sql dan SETELAH akun Kakak/Mpip
-- sudah terhubung ke public.household_members.
-- Tujuan:
-- 1) Menghubungkan baris members Kakak/Mpip ke user Auth masing-masing.
-- 2) Kakak hanya boleh mengubah data Kakak.
-- 3) Mpip hanya boleh mengubah data Mpip.
-- 4) Role owner tidak memberi akses untuk mengubah data pasangan.
-- 5) Proteksi berlaku di database/RLS, bukan cuma menyembunyikan tombol UI.

begin;

alter table public.members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

-- Cocokkan display_name household_members dengan members.name (Kakak/Mpip).
update public.members m
set auth_user_id = hm.user_id
from public.household_members hm
where hm.household_id = m.household_id
  and lower(trim(hm.display_name)) = lower(trim(m.name))
  and m.auth_user_id is distinct from hm.user_id;

create unique index if not exists members_household_auth_user_unique
on public.members(household_id, auth_user_id)
where auth_user_id is not null;

create or replace function public.current_household_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select hm.role
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;
$$;

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

revoke all on function public.current_household_role() from public, anon;
revoke all on function public.can_manage_member(uuid) from public, anon;
grant execute on function public.current_household_role() to authenticated;
grant execute on function public.can_manage_member(uuid) to authenticated;

-- Cegah client mengganti pemilik/household baris anggota lewat update biasa.
create or replace function public.protect_member_identity()
returns trigger
language plpgsql
as $$
begin
  -- auth.uid() NULL berarti perubahan dijalankan dari SQL Editor/migrasi tepercaya.
  if auth.uid() is not null and (
       new.id is distinct from old.id
       or new.household_id is distinct from old.household_id
       or new.auth_user_id is distinct from old.auth_user_id
       or new.name is distinct from old.name
     ) then
    raise exception 'Identitas anggota tidak boleh diubah dari aplikasi';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_member_identity_trg on public.members;
create trigger protect_member_identity_trg
before update on public.members
for each row execute function public.protect_member_identity();

-- Ganti policy update anggota.
drop policy if exists "Household users can update fixed members" on public.members;
drop policy if exists "Users can update allowed members" on public.members;
create policy "Users can update allowed members"
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

-- Ganti policy insert/update setoran.
drop policy if exists "Members can insert deposits" on public.monthly_deposits;
drop policy if exists "Members can update household deposits" on public.monthly_deposits;
drop policy if exists "Users can insert allowed deposits" on public.monthly_deposits;
drop policy if exists "Users can update allowed deposits" on public.monthly_deposits;

create policy "Users can insert allowed deposits"
on public.monthly_deposits
for insert
to authenticated
with check (
  household_id = public.current_household_id()
  and public.can_manage_member(member_id)
);

create policy "Users can update allowed deposits"
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

-- Storage: semua anggota tetap boleh melihat bukti household,
-- tetapi update/hapus hanya untuk setoran milik akun yang sedang login.
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

-- VERIFIKASI: harus muncul dua baris dan auth_user_id tidak boleh NULL.
select
  m.name,
  m.auth_user_id,
  u.email,
  hm.role,
  case
    when m.auth_user_id is null then 'BELUM TERHUBUNG'
    else 'OK'
  end as status_link
from public.members m
left join auth.users u on u.id = m.auth_user_id
left join public.household_members hm on hm.user_id = m.auth_user_id
where lower(m.name) in ('kakak', 'mpip')
order by m.name;
