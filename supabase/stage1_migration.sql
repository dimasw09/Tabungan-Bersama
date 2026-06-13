-- TAHAP 1 MIGRATION - jalankan pada project Supabase yang SUDAH berisi data.
-- Migrasi ini mempertahankan seluruh data lama, menutup akses anon, menambah auth per pasangan,
-- soft delete, audit log, status code konsisten, dan policy Storage yang aman.

begin;
create extension if not exists "pgcrypto";

-- Rumah tangga default untuk seluruh data lama.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.households (id, name)
values ('11111111-1111-4111-8111-111111111111', 'Kakak & Mpip')
on conflict (id) do update set name = excluded.name;

create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default timezone('utc', now())
);

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
  limit 1;
$$;

revoke all on function public.current_household_id() from public, anon;
grant execute on function public.current_household_id() to authenticated;

alter table public.profiles add column if not exists household_id uuid references public.households(id);
update public.profiles set household_id = '11111111-1111-4111-8111-111111111111' where household_id is null;
alter table public.profiles alter column household_id set default public.current_household_id();
alter table public.profiles alter column household_id set not null;

alter table public.members add column if not exists household_id uuid references public.households(id);
update public.members set household_id = '11111111-1111-4111-8111-111111111111' where household_id is null;
alter table public.members alter column household_id set default public.current_household_id();
alter table public.members alter column household_id set not null;

alter table public.monthly_deposits add column if not exists household_id uuid references public.households(id);
alter table public.monthly_deposits add column if not exists deleted_at timestamptz;
alter table public.monthly_deposits add column if not exists deleted_by uuid references auth.users(id);
update public.monthly_deposits d set household_id = m.household_id from public.members m where d.member_id = m.id and d.household_id is null;
update public.monthly_deposits set household_id = '11111111-1111-4111-8111-111111111111' where household_id is null;
alter table public.monthly_deposits alter column household_id set default public.current_household_id();
alter table public.monthly_deposits alter column household_id set not null;

alter table public.other_mutations add column if not exists household_id uuid references public.households(id);
alter table public.other_mutations add column if not exists deleted_at timestamptz;
alter table public.other_mutations add column if not exists deleted_by uuid references auth.users(id);
update public.other_mutations set household_id = '11111111-1111-4111-8111-111111111111' where household_id is null;
alter table public.other_mutations alter column household_id set default public.current_household_id();
alter table public.other_mutations alter column household_id set not null;

-- Status internal stabil. Label manusiawi tetap diatur oleh UI.
update public.monthly_deposits
set status = case
  when coalesce(paid_amount, 0) <= 0 then 'UNPAID'
  when paid_amount < required_amount then 'PARTIAL'
  when actual_transfer_date is not null and actual_transfer_date > due_date then 'PAID_LATE'
  else 'PAID'
end;

alter table public.monthly_deposits alter column status set default 'UNPAID';
alter table public.monthly_deposits drop constraint if exists monthly_deposits_status_check;
alter table public.monthly_deposits add constraint monthly_deposits_status_check check (status in ('UNPAID', 'PARTIAL', 'PAID', 'PAID_LATE'));

-- Soft-deleted period boleh dibuat ulang tanpa bertabrakan dengan arsip lama.
alter table public.monthly_deposits drop constraint if exists monthly_deposits_unique_member_period;
drop index if exists public.monthly_deposits_unique_member_period;
create unique index if not exists monthly_deposits_active_member_period_unique
on public.monthly_deposits(member_id, year, month)
where deleted_at is null;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'SOFT_DELETE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default timezone('utc', now())
);
create index if not exists audit_logs_household_changed_at_idx on public.audit_logs(household_id, changed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.set_soft_delete_actor()
returns trigger
language plpgsql
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and new.deleted_by is null then
    new.deleted_by = auth.uid();
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    new.deleted_by = null;
  end if;
  return new;
end;
$$;

create or replace function public.validate_deposit_household()
returns trigger
language plpgsql
as $$
declare member_household uuid;
begin
  select household_id into member_household from public.members where id = new.member_id;
  if member_household is null then raise exception 'Anggota setoran tidak ditemukan'; end if;
  if new.household_id is null then new.household_id = member_household; end if;
  if new.household_id <> member_household then raise exception 'Setoran dan anggota harus berada di rumah tangga yang sama'; end if;
  return new;
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_household uuid;
  row_id uuid;
  action_name text;
  old_json jsonb;
  new_json jsonb;
begin
  if tg_op = 'DELETE' then
    old_json = to_jsonb(old);
    new_json = null;
    row_household = old.household_id;
    row_id = old.id;
    action_name = 'DELETE';
  elsif tg_op = 'INSERT' then
    old_json = null;
    new_json = to_jsonb(new);
    row_household = new.household_id;
    row_id = new.id;
    action_name = 'INSERT';
  else
    old_json = to_jsonb(old);
    new_json = to_jsonb(new);
    row_household = new.household_id;
    row_id = new.id;
    action_name = case
      when (old_json ->> 'deleted_at') is null and (new_json ->> 'deleted_at') is not null then 'SOFT_DELETE'
      else 'UPDATE'
    end;
  end if;

  insert into public.audit_logs(household_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (row_household, tg_table_name, row_id, action_name, old_json, new_json, auth.uid());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Trigger aplikasi.
drop trigger if exists set_monthly_deposits_updated_at on public.monthly_deposits;
create trigger set_monthly_deposits_updated_at before update on public.monthly_deposits for each row execute function public.set_updated_at();
drop trigger if exists set_other_mutations_updated_at on public.other_mutations;
create trigger set_other_mutations_updated_at before update on public.other_mutations for each row execute function public.set_updated_at();
drop trigger if exists set_monthly_deposits_soft_delete_actor on public.monthly_deposits;
create trigger set_monthly_deposits_soft_delete_actor before update on public.monthly_deposits for each row execute function public.set_soft_delete_actor();
drop trigger if exists set_other_mutations_soft_delete_actor on public.other_mutations;
create trigger set_other_mutations_soft_delete_actor before update on public.other_mutations for each row execute function public.set_soft_delete_actor();
drop trigger if exists validate_deposit_household_trg on public.monthly_deposits;
create trigger validate_deposit_household_trg before insert or update on public.monthly_deposits for each row execute function public.validate_deposit_household();

drop trigger if exists audit_members_trg on public.members;
create trigger audit_members_trg after insert or update or delete on public.members for each row execute function public.audit_row_change();
drop trigger if exists audit_monthly_deposits_trg on public.monthly_deposits;
create trigger audit_monthly_deposits_trg after insert or update or delete on public.monthly_deposits for each row execute function public.audit_row_change();
drop trigger if exists audit_other_mutations_trg on public.other_mutations;
create trigger audit_other_mutations_trg after insert or update or delete on public.other_mutations for each row execute function public.audit_row_change();

-- RLS: tidak ada lagi akses anon.
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.monthly_deposits enable row level security;
alter table public.other_mutations enable row level security;
alter table public.audit_logs enable row level security;

-- Hapus policy lama maupun policy Tahap 1 bila migrasi dijalankan ulang.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('households','household_members','profiles','members','monthly_deposits','other_mutations','audit_logs')
  loop execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;

create policy "Members can read own household" on public.households for select to authenticated
using (id = public.current_household_id());
create policy "Users can read household memberships" on public.household_members for select to authenticated
using (household_id = public.current_household_id());
create policy "Members can read household profile" on public.profiles for select to authenticated
using (household_id = public.current_household_id());
create policy "Owners can update household profile" on public.profiles for update to authenticated
using (household_id = public.current_household_id() and exists (select 1 from public.household_members hm where hm.user_id = auth.uid() and hm.role = 'owner'))
with check (household_id = public.current_household_id());

create policy "Members can read members" on public.members for select to authenticated
using (household_id = public.current_household_id());
create policy "Household users can update fixed members" on public.members for update to authenticated
using (household_id = public.current_household_id() and lower(name) in ('mpip','kakak'))
with check (household_id = public.current_household_id() and lower(name) in ('mpip','kakak'));

create policy "Members can read household deposits" on public.monthly_deposits for select to authenticated
using (household_id = public.current_household_id());
create policy "Members can insert deposits" on public.monthly_deposits for insert to authenticated
with check (household_id = public.current_household_id());
create policy "Members can update household deposits" on public.monthly_deposits for update to authenticated
using (household_id = public.current_household_id())
with check (household_id = public.current_household_id());

create policy "Members can read household mutations" on public.other_mutations for select to authenticated
using (household_id = public.current_household_id());
create policy "Members can insert mutations" on public.other_mutations for insert to authenticated
with check (household_id = public.current_household_id());
create policy "Members can update household mutations" on public.other_mutations for update to authenticated
using (household_id = public.current_household_id())
with check (household_id = public.current_household_id());

create policy "Members can read audit logs" on public.audit_logs for select to authenticated
using (household_id = public.current_household_id());

-- Storage privat. Path baru: household_id/deposit_id/timestamp.ext.
insert into storage.buckets (id, name, public)
values ('transfer-proofs', 'transfer-proofs', false)
on conflict (id) do update set public = false;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname ilike '%transfer proof%'
  loop execute format('drop policy if exists %I on storage.objects', r.policyname); end loop;
end $$;

create policy "Household can read transfer proofs" on storage.objects for select to authenticated
using (
  bucket_id = 'transfer-proofs' and (
    exists (select 1 from public.household_members hm where hm.user_id = auth.uid() and hm.household_id::text = (storage.foldername(name))[1])
    or exists (select 1 from public.monthly_deposits d where d.id::text = (storage.foldername(name))[1] and d.household_id = public.current_household_id())
  )
);
create policy "Household can upload transfer proofs" on storage.objects for insert to authenticated
with check (
  bucket_id = 'transfer-proofs'
  and exists (select 1 from public.household_members hm where hm.user_id = auth.uid() and hm.household_id::text = (storage.foldername(name))[1])
);
create policy "Household can update transfer proofs" on storage.objects for update to authenticated
using (
  bucket_id = 'transfer-proofs' and (
    exists (select 1 from public.household_members hm where hm.user_id = auth.uid() and hm.household_id::text = (storage.foldername(name))[1])
    or exists (select 1 from public.monthly_deposits d where d.id::text = (storage.foldername(name))[1] and d.household_id = public.current_household_id())
  )
)
with check (bucket_id = 'transfer-proofs');
create policy "Household can delete transfer proofs" on storage.objects for delete to authenticated
using (
  bucket_id = 'transfer-proofs' and (
    exists (select 1 from public.household_members hm where hm.user_id = auth.uid() and hm.household_id::text = (storage.foldername(name))[1])
    or exists (select 1 from public.monthly_deposits d where d.id::text = (storage.foldername(name))[1] and d.household_id = public.current_household_id())
  )
);

commit;

-- SETELAH migrasi selesai:
-- 1. Supabase Dashboard > Authentication > Users: buat akun Kakak dan Mpip.
-- 2. Jalankan supabase/link-users.example.sql setelah mengganti dua email contoh.
-- 3. Authentication > Providers > Email: matikan "Allow new users to sign up".


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

-- Username login (konfigurasi username dilakukan lewat hotfix_1_0_4_username_login.sql).
create table if not exists public.login_usernames (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(btrim(username))) stored,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint login_usernames_format_check check (username ~ '^[A-Za-z0-9._-]{3,32}$')
);
create unique index if not exists login_usernames_normalized_unique on public.login_usernames (username_normalized);
alter table public.login_usernames enable row level security;
revoke all on table public.login_usernames from public, anon, authenticated;
grant select, insert, update, delete on table public.login_usernames to service_role;
