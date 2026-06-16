-- HOTFIX 1.0.4 - LOGIN DENGAN USERNAME
-- Jalankan setelah akun Kakak dan Mpip sudah ada di Authentication
-- dan sudah terhubung di public.household_members.
--
-- UBAH HANYA DUA NILAI DI BLOK "PENGATURAN USERNAME".
-- Username boleh berisi huruf kecil, angka, titik, underscore, atau strip.
-- Contoh username tanggal lahir: 020802 (tetap disimpan sebagai text, nol depan aman).

begin;

create table if not exists public.login_usernames (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(btrim(username))) stored,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint login_usernames_format_check
    check (username ~ '^[A-Za-z0-9._-]{3,32}$')
);

create unique index if not exists login_usernames_normalized_unique
on public.login_usernames (username_normalized);

alter table public.login_usernames enable row level security;
revoke all on table public.login_usernames from public, anon, authenticated;
grant select, insert, update, delete on table public.login_usernames to service_role;

-- PENGATURAN USERNAME: ganti dua nilai di bawah.
do $$
declare
  v_username_kakak text := 'GANTI_USERNAME_KAKAK';
  v_username_mpip text := '020802';
  v_user_kakak uuid;
  v_user_mpip uuid;
begin
  if v_username_kakak = 'GANTI_USERNAME_KAKAK' then
    raise exception 'Ganti v_username_kakak terlebih dahulu sebelum menjalankan SQL.';
  end if;

  if v_username_kakak !~ '^[A-Za-z0-9._-]{3,32}$'
     or v_username_mpip !~ '^[A-Za-z0-9._-]{3,32}$' then
    raise exception 'Username harus 3-32 karakter dan hanya boleh berisi huruf, angka, titik, underscore, atau strip.';
  end if;

  if lower(btrim(v_username_kakak)) = lower(btrim(v_username_mpip)) then
    raise exception 'Username Kakak dan Mpip tidak boleh sama.';
  end if;

  select hm.user_id into v_user_kakak
  from public.household_members hm
  where lower(btrim(hm.display_name)) = 'kakak'
  limit 1;

  select hm.user_id into v_user_mpip
  from public.household_members hm
  where lower(btrim(hm.display_name)) = 'mpip'
  limit 1;

  if v_user_kakak is null then
    raise exception 'Akun Kakak belum ditemukan di household_members.';
  end if;

  if v_user_mpip is null then
    raise exception 'Akun Mpip belum ditemukan di household_members.';
  end if;

  insert into public.login_usernames (user_id, username, updated_at)
  values (v_user_kakak, lower(btrim(v_username_kakak)), timezone('utc', now()))
  on conflict (user_id) do update
  set username = excluded.username,
      updated_at = timezone('utc', now());

  insert into public.login_usernames (user_id, username, updated_at)
  values (v_user_mpip, lower(btrim(v_username_mpip)), timezone('utc', now()))
  on conflict (user_id) do update
  set username = excluded.username,
      updated_at = timezone('utc', now());
end $$;

commit;

-- VERIFIKASI: harus tampil dua baris, masing-masing Kakak dan Mpip.
select
  hm.display_name,
  lu.username,
  u.email,
  case when lu.user_id = hm.user_id then 'OK' else 'BELUM TERHUBUNG' end as status
from public.household_members hm
join public.login_usernames lu on lu.user_id = hm.user_id
join auth.users u on u.id = hm.user_id
where lower(btrim(hm.display_name)) in ('kakak', 'mpip')
order by hm.display_name;
