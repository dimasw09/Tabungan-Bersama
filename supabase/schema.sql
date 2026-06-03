-- Tabungan Bersama Kakak & Mpip - No Login Mode
-- Jalankan file ini di Supabase SQL Editor.
-- App ini sengaja tanpa Supabase Auth. Semua akses dari browser memakai role anon.
-- Artinya: siapa pun yang punya URL aplikasi + anon key bisa CRUD setoran/mutasi.
-- Anggota dikunci hanya Kakak dan Mpip; yang bisa diubah hanya nominal, tanggal setor, dan warna.

create extension if not exists "pgcrypto";

-- =========================
-- Tables
-- =========================
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  monthly_amount numeric not null,
  payday integer not null check (payday between 1 and 31),
  color text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.monthly_deposits (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  due_date date not null,
  required_amount numeric not null,
  actual_transfer_date date null,
  paid_amount numeric default 0 not null,
  proof_image_url text null,
  status text default 'Belum Dibayar',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint monthly_deposits_unique_member_period unique(member_id, year, month)
);

create table if not exists public.other_mutations (
  id uuid primary key default gen_random_uuid(),
  mutation_date date not null,
  type text not null check (type in ('Tambah', 'Penarikan')),
  amount numeric not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Kalau file SQL ini dijalankan ulang, matikan dulu guard agar proses cleanup + seed bisa jalan.
drop trigger if exists guard_fixed_members_trg on public.members;

-- Pastikan data anggota bersih: hanya Kakak dan Mpip.
delete from public.members
where lower(name) not in ('mpip', 'kakak');

create unique index if not exists members_lower_name_unique
on public.members (lower(name));

-- =========================
-- Updated at trigger
-- =========================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_monthly_deposits_updated_at on public.monthly_deposits;
create trigger set_monthly_deposits_updated_at
before update on public.monthly_deposits
for each row execute function public.set_updated_at();

drop trigger if exists set_other_mutations_updated_at on public.other_mutations;
create trigger set_other_mutations_updated_at
before update on public.other_mutations
for each row execute function public.set_updated_at();

-- =========================
-- Row Level Security
-- No-login rule: browser menggunakan role anon.
-- No-login mode: anon boleh CRUD setoran/mutasi.
-- Tabel members sengaja dibatasi hanya Kakak dan Mpip.
-- =========================
alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.monthly_deposits enable row level security;
alter table public.other_mutations enable row level security;

-- Bersihkan policy versi login jika pernah dibuat.
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Authenticated can read members" on public.members;
drop policy if exists "Authenticated can insert members" on public.members;
drop policy if exists "Authenticated can update members" on public.members;
drop policy if exists "Authenticated can delete members" on public.members;
drop policy if exists "Authenticated can read monthly deposits" on public.monthly_deposits;
drop policy if exists "Authenticated can insert monthly deposits" on public.monthly_deposits;
drop policy if exists "Authenticated can update monthly deposits" on public.monthly_deposits;
drop policy if exists "Authenticated can delete monthly deposits" on public.monthly_deposits;
drop policy if exists "Authenticated can read other mutations" on public.other_mutations;
drop policy if exists "Authenticated can insert other mutations" on public.other_mutations;
drop policy if exists "Authenticated can update other mutations" on public.other_mutations;
drop policy if exists "Authenticated can delete other mutations" on public.other_mutations;

-- Policy no-login.
drop policy if exists "Anon can read profiles" on public.profiles;
create policy "Anon can read profiles"
on public.profiles for select
to anon
using (true);

drop policy if exists "Anon can manage profiles" on public.profiles;
create policy "Anon can manage profiles"
on public.profiles for all
to anon
using (true)
with check (true);

drop policy if exists "Anon can read members" on public.members;
create policy "Anon can read members"
on public.members for select
to anon
using (true);

drop policy if exists "Anon can manage members" on public.members;
drop policy if exists "Anon can update fixed members" on public.members;
create policy "Anon can update fixed members"
on public.members for update
to anon
using (lower(name) in ('mpip', 'kakak'))
with check (lower(name) in ('mpip', 'kakak'));

drop policy if exists "Anon can read monthly deposits" on public.monthly_deposits;
create policy "Anon can read monthly deposits"
on public.monthly_deposits for select
to anon
using (true);

drop policy if exists "Anon can manage monthly deposits" on public.monthly_deposits;
create policy "Anon can manage monthly deposits"
on public.monthly_deposits for all
to anon
using (true)
with check (true);

drop policy if exists "Anon can read other mutations" on public.other_mutations;
create policy "Anon can read other mutations"
on public.other_mutations for select
to anon
using (true);

drop policy if exists "Anon can manage other mutations" on public.other_mutations;
create policy "Anon can manage other mutations"
on public.other_mutations for all
to anon
using (true)
with check (true);

-- =========================
-- Supabase Storage Bucket + Policies
-- proof_image_url di tabel monthly_deposits menyimpan storage path.
-- UI membuat signed URL saat preview.
-- =========================
insert into storage.buckets (id, name, public)
values ('transfer-proofs', 'transfer-proofs', false)
on conflict (id) do update set public = false;

-- Bersihkan policy storage versi login jika pernah dibuat.
drop policy if exists "Authenticated can read transfer proofs" on storage.objects;
drop policy if exists "Authenticated can upload transfer proofs" on storage.objects;
drop policy if exists "Authenticated can update transfer proofs" on storage.objects;
drop policy if exists "Authenticated can delete transfer proofs" on storage.objects;

drop policy if exists "Anon can read transfer proofs" on storage.objects;
create policy "Anon can read transfer proofs"
on storage.objects for select
to anon
using (bucket_id = 'transfer-proofs');

drop policy if exists "Anon can upload transfer proofs" on storage.objects;
create policy "Anon can upload transfer proofs"
on storage.objects for insert
to anon
with check (bucket_id = 'transfer-proofs');

drop policy if exists "Anon can update transfer proofs" on storage.objects;
create policy "Anon can update transfer proofs"
on storage.objects for update
to anon
using (bucket_id = 'transfer-proofs')
with check (bucket_id = 'transfer-proofs');

drop policy if exists "Anon can delete transfer proofs" on storage.objects;
create policy "Anon can delete transfer proofs"
on storage.objects for delete
to anon
using (bucket_id = 'transfer-proofs');

-- =========================
-- Default Data
-- Mpip: Rp78.000 tanggal 10 pink soft
-- Kakak: Rp162.000 tanggal 28 biru soft
-- Data awal: Juni 2026 selama 24 bulan
-- =========================
insert into public.profiles (display_name)
values ('Kakak & Mpip')
on conflict do nothing;

insert into public.members (name, monthly_amount, payday, color)
values
  ('Mpip', 78000, 10, '#ffd6e7'),
  ('Kakak', 162000, 28, '#d8ecff')
on conflict (name) do update set
  monthly_amount = excluded.monthly_amount,
  payday = excluded.payday,
  color = excluded.color;

with month_seed as (
  select (date '2026-06-01' + (month_index || ' months')::interval)::date as month_date
  from generate_series(0, 23) as month_index
), default_members as (
  select id, monthly_amount, payday
  from public.members
  where lower(name) in ('mpip', 'kakak')
)
insert into public.monthly_deposits (
  member_id,
  year,
  month,
  due_date,
  required_amount,
  paid_amount,
  status
)
select
  default_members.id,
  extract(year from month_seed.month_date)::int,
  extract(month from month_seed.month_date)::int,
  make_date(
    extract(year from month_seed.month_date)::int,
    extract(month from month_seed.month_date)::int,
    least(
      default_members.payday,
      extract(day from (date_trunc('month', month_seed.month_date)::date + interval '1 month - 1 day'))::int
    )
  ) as due_date,
  default_members.monthly_amount,
  0,
  'Belum Dibayar'
from month_seed
cross join default_members
on conflict (member_id, year, month) do nothing;


-- =========================
-- Guard Anggota Fixed
-- App ini hanya punya 2 anggota: Kakak dan Mpip.
-- Client no-login tidak diberi policy insert/delete members, dan trigger ini jadi pengaman ekstra.
-- =========================
create or replace function public.guard_fixed_members()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if lower(new.name) not in ('mpip', 'kakak') then
      raise exception 'Anggota dikunci hanya Kakak dan Mpip';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if lower(old.name) <> lower(new.name) then
      raise exception 'Nama anggota tidak boleh diubah. Anggota dikunci hanya Kakak dan Mpip';
    end if;

    if lower(new.name) not in ('mpip', 'kakak') then
      raise exception 'Anggota dikunci hanya Kakak dan Mpip';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Anggota Kakak dan Mpip tidak boleh dihapus';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists guard_fixed_members_trg on public.members;
create trigger guard_fixed_members_trg
before insert or update or delete on public.members
for each row execute function public.guard_fixed_members();
