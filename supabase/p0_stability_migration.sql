-- P0 STABILITY & SECURITY MIGRATION
-- Versi target aplikasi: 2.4.0
-- Jalankan SATU KALI setelah:
--   1) schema/stage1 + strict member ownership
--   2) stage2_story_album.sql
--   3) stage2_2_auto_yearly_deposits.sql
--   4) stage2_5_love_capsule.sql
-- Migration ini idempotent dan boleh dijalankan ulang saat deployment P0.

begin;

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. DATABASE-BACKED RATE LIMIT UNTUK ENDPOINT SERVER
-- ============================================================
create table if not exists public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default timezone('utc', now()),
  request_count integer not null default 0 check (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (scope, key_hash)
);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.api_rate_limits%rowtype;
  v_retry integer := 0;
begin
  if btrim(coalesce(p_scope, '')) = '' or btrim(coalesce(p_key_hash, '')) = '' then
    raise exception 'Rate-limit key tidak valid';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'Konfigurasi rate limit tidak valid';
  end if;

  insert into public.api_rate_limits(scope, key_hash, window_started_at, request_count, updated_at)
  values (p_scope, p_key_hash, v_now, 0, v_now)
  on conflict (scope, key_hash) do nothing;

  select * into v_row
  from public.api_rate_limits
  where scope = p_scope and key_hash = p_key_hash
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    v_retry := greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  if v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.api_rate_limits
    set window_started_at = v_now,
        request_count = 1,
        blocked_until = null,
        updated_at = v_now
    where scope = p_scope and key_hash = p_key_hash;
    return query select true, 0;
    return;
  end if;

  if v_row.request_count + 1 > p_limit then
    update public.api_rate_limits
    set request_count = request_count + 1,
        blocked_until = v_now + make_interval(secs => p_block_seconds),
        updated_at = v_now
    where scope = p_scope and key_hash = p_key_hash;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.api_rate_limits
  set request_count = request_count + 1,
      blocked_until = null,
      updated_at = v_now
  where scope = p_scope and key_hash = p_key_hash;

  return query select true, 0;
end;
$$;

revoke all on function public.consume_api_rate_limit(text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer,integer) to service_role;

-- ============================================================
-- 2. SATU SUMBER VALIDASI SALDO + LOCK PER HOUSEHOLD
-- ============================================================
create or replace function public.assert_household_balance_nonnegative(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date;
  v_balance numeric;
begin
  with flows as (
    select make_date(d.year, d.month, 1) as period_start,
           sum(coalesce(d.paid_amount, 0))::numeric as net_amount
    from public.monthly_deposits d
    where d.household_id = p_household_id and d.deleted_at is null
    group by d.year, d.month

    union all

    select date_trunc('month', m.mutation_date)::date as period_start,
           sum(case when m.type = 'Tambah' then m.amount else -m.amount end)::numeric as net_amount
    from public.other_mutations m
    where m.household_id = p_household_id and m.deleted_at is null
    group by date_trunc('month', m.mutation_date)::date
  ), monthly as (
    select period_start, sum(net_amount)::numeric as net_amount
    from flows
    group by period_start
  ), running as (
    select period_start,
           sum(net_amount) over (order by period_start rows between unbounded preceding and current row)::numeric as ending_balance
    from monthly
  )
  select period_start, ending_balance
  into v_period, v_balance
  from running
  where ending_balance < 0
  order by period_start
  limit 1;

  if v_period is not null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Saldo akhir %s akan menjadi minus (%s). Periksa nominal atau tanggal transaksi.',
        to_char(v_period, 'FMMonth YYYY'),
        trim(to_char(v_balance, 'FM999999999999999990D00'))
      );
  end if;
end;
$$;

revoke all on function public.assert_household_balance_nonnegative(uuid) from public, anon, authenticated;

-- ============================================================
-- 3. SETORAN: SIMPAN/RESET/ARSIP/PULIHKAN VIA RPC TERKUNCI
-- ============================================================
create or replace function public.save_monthly_deposit(
  p_id uuid,
  p_member_id uuid,
  p_year integer,
  p_month integer,
  p_due_date date,
  p_required_amount numeric,
  p_actual_transfer_date date,
  p_paid_amount numeric,
  p_proof_image_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_household_id uuid := public.current_household_id();
  v_existing public.monthly_deposits%rowtype;
  v_status text;
  v_today date := timezone('Asia/Jakarta', now())::date;
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  if not public.can_manage_member(p_member_id) then raise exception 'Setoran ini bukan milik akun yang sedang login'; end if;
  if p_year < 2000 or p_year > 2200 or p_month not between 1 and 12 then raise exception 'Periode setoran tidak valid'; end if;
  if p_due_date is null or extract(year from p_due_date)::integer <> p_year or extract(month from p_due_date)::integer <> p_month then
    raise exception 'Jatuh tempo harus berada pada periode setoran';
  end if;
  if p_required_amount is null or p_required_amount <= 0 or p_required_amount > 1000000000 then raise exception 'Nominal wajib tidak valid'; end if;
  if p_paid_amount is null or p_paid_amount < 0 or p_paid_amount > 1000000000 then raise exception 'Nominal setoran tidak valid'; end if;
  if p_paid_amount > 0 and p_actual_transfer_date is null then raise exception 'Tanggal transfer wajib diisi'; end if;
  if p_actual_transfer_date is not null and p_actual_transfer_date > v_today then raise exception 'Tanggal transfer tidak boleh lebih dari hari ini'; end if;
  if p_paid_amount > 0 and nullif(btrim(coalesce(p_proof_image_url, '')), '') is null then raise exception 'Bukti transfer wajib diupload'; end if;

  -- Lock ini menjadi antrean tunggal seluruh perubahan saldo pada household.
  perform 1 from public.households where id = v_household_id for update;

  select * into v_existing from public.monthly_deposits where id = v_id for update;
  if v_existing.id is not null then
    if v_existing.household_id <> v_household_id or v_existing.member_id <> p_member_id then
      raise exception 'Setoran tidak ditemukan atau akses ditolak';
    end if;
  end if;

  v_status := case
    when p_paid_amount <= 0 then 'UNPAID'
    when p_paid_amount < p_required_amount then 'PARTIAL'
    when p_actual_transfer_date > p_due_date then 'PAID_LATE'
    else 'PAID'
  end;

  if v_existing.id is null then
    insert into public.monthly_deposits(
      id, household_id, member_id, year, month, due_date, required_amount,
      actual_transfer_date, paid_amount, proof_image_url, status, deleted_at, deleted_by
    ) values (
      v_id, v_household_id, p_member_id, p_year, p_month, p_due_date, p_required_amount,
      case when p_paid_amount > 0 then p_actual_transfer_date else null end,
      p_paid_amount, nullif(btrim(coalesce(p_proof_image_url, '')), ''), v_status, null, null
    );
  else
    update public.monthly_deposits
    set year = p_year,
        month = p_month,
        due_date = p_due_date,
        required_amount = p_required_amount,
        actual_transfer_date = case when p_paid_amount > 0 then p_actual_transfer_date else null end,
        paid_amount = p_paid_amount,
        proof_image_url = nullif(btrim(coalesce(p_proof_image_url, '')), ''),
        status = v_status,
        deleted_at = null,
        deleted_by = null
    where id = v_id;
  end if;

  perform public.assert_household_balance_nonnegative(v_household_id);
  return v_id;
end;
$$;

create or replace function public.set_monthly_deposit_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid := public.current_household_id();
  v_deposit public.monthly_deposits%rowtype;
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  perform 1 from public.households where id = v_household_id for update;

  select * into v_deposit from public.monthly_deposits where id = p_id for update;
  if v_deposit.id is null or v_deposit.household_id <> v_household_id or not public.can_manage_member(v_deposit.member_id) then
    raise exception 'Setoran tidak ditemukan atau akses ditolak';
  end if;

  update public.monthly_deposits
  set deleted_at = case when coalesce(p_archived, false) then timezone('utc', now()) else null end,
      deleted_by = case when coalesce(p_archived, false) then auth.uid() else null end
  where id = p_id;

  perform public.assert_household_balance_nonnegative(v_household_id);
end;
$$;

create or replace function public.update_member_settings(
  p_member_id uuid,
  p_monthly_amount numeric,
  p_payday integer,
  p_color text,
  p_sync_unpaid boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid := public.current_household_id();
  v_count integer := 0;
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  if not public.can_manage_member(p_member_id) then raise exception 'Pengaturan ini bukan milik akun yang sedang login'; end if;
  if p_monthly_amount is null or p_monthly_amount <= 0 or p_monthly_amount > 1000000000 then raise exception 'Nominal setoran tidak valid'; end if;
  if p_payday not between 1 and 31 then raise exception 'Tanggal setor harus 1 sampai 31'; end if;
  if coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Warna profil tidak valid'; end if;

  perform 1 from public.households where id = v_household_id for update;

  update public.members
  set monthly_amount = p_monthly_amount,
      payday = p_payday,
      color = upper(p_color)
  where id = p_member_id and household_id = v_household_id;

  if coalesce(p_sync_unpaid, false) then
    update public.monthly_deposits d
    set due_date = make_date(
          d.year,
          d.month,
          least(
            p_payday,
            extract(day from (make_date(d.year, d.month, 1) + interval '1 month - 1 day'))::integer
          )
        ),
        required_amount = p_monthly_amount,
        status = 'UNPAID'
    where d.member_id = p_member_id
      and d.household_id = v_household_id
      and d.deleted_at is null
      and coalesce(d.paid_amount, 0) <= 0;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

revoke all on function public.save_monthly_deposit(uuid,uuid,integer,integer,date,numeric,date,numeric,text) from public, anon;
revoke all on function public.set_monthly_deposit_archived(uuid,boolean) from public, anon;
revoke all on function public.update_member_settings(uuid,numeric,integer,text,boolean) from public, anon;
grant execute on function public.save_monthly_deposit(uuid,uuid,integer,integer,date,numeric,date,numeric,text) to authenticated;
grant execute on function public.set_monthly_deposit_archived(uuid,boolean) to authenticated;
grant execute on function public.update_member_settings(uuid,numeric,integer,text,boolean) to authenticated;

-- ============================================================
-- 4. CERITA + REFERENSI FOTO DISIMPAN DALAM SATU TRANSAKSI DB
-- ============================================================
create or replace function public.save_story_mutation(
  p_id uuid,
  p_mutation_date date,
  p_type text,
  p_amount numeric,
  p_description text,
  p_delete_ids uuid[],
  p_new_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_household_id uuid := public.current_household_id();
  v_existing public.other_mutations%rowtype;
  v_remaining integer;
  v_path text;
  v_index integer := 0;
  v_today date := timezone('Asia/Jakarta', now())::date;
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  if p_mutation_date is null or p_mutation_date > v_today then raise exception 'Tanggal cerita tidak valid'; end if;
  if p_type not in ('Tambah', 'Penarikan') then raise exception 'Jenis cerita tidak valid'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Nominal cerita tidak valid'; end if;
  if char_length(coalesce(p_description, '')) > 160 then raise exception 'Cerita maksimal 160 karakter'; end if;
  if p_type = 'Penarikan' and btrim(coalesce(p_description, '')) = '' then raise exception 'Cerita singkat wajib diisi untuk penarikan'; end if;

  perform 1 from public.households where id = v_household_id for update;

  select * into v_existing from public.other_mutations where id = v_id for update;
  if v_existing.id is null then
    insert into public.other_mutations(id, household_id, mutation_date, type, amount, description, deleted_at, deleted_by)
    values (v_id, v_household_id, p_mutation_date, p_type, p_amount, nullif(btrim(coalesce(p_description, '')), ''), null, null);
  else
    if v_existing.household_id <> v_household_id or v_existing.deleted_at is not null then
      raise exception 'Cerita tidak ditemukan atau berada di arsip';
    end if;
    update public.other_mutations
    set mutation_date = p_mutation_date,
        type = p_type,
        amount = p_amount,
        description = nullif(btrim(coalesce(p_description, '')), '')
    where id = v_id;
  end if;

  delete from public.story_photos
  where mutation_id = v_id
    and id = any(coalesce(p_delete_ids, array[]::uuid[]));

  select count(*) into v_remaining from public.story_photos where mutation_id = v_id;
  if v_remaining + cardinality(coalesce(p_new_paths, array[]::text[])) > 10 then
    raise exception 'Satu cerita maksimal memiliki 10 foto';
  end if;

  set constraints story_photos_mutation_order_unique deferred;
  with ordered as (
    select id, (row_number() over (order by sort_order, created_at, id) - 1)::smallint as new_order
    from public.story_photos where mutation_id = v_id
  )
  update public.story_photos p
  set sort_order = ordered.new_order
  from ordered where p.id = ordered.id;

  select count(*) into v_remaining from public.story_photos where mutation_id = v_id;
  foreach v_path in array coalesce(p_new_paths, array[]::text[])
  loop
    if v_path is null or btrim(v_path) = ''
       or split_part(v_path, '/', 1) <> v_household_id::text
       or split_part(v_path, '/', 2) <> v_id::text then
      raise exception 'Path foto cerita tidak valid';
    end if;
    insert into public.story_photos(household_id, mutation_id, storage_path, sort_order, uploaded_by)
    values (v_household_id, v_id, v_path, v_remaining + v_index, auth.uid());
    v_index := v_index + 1;
  end loop;

  perform public.assert_household_balance_nonnegative(v_household_id);
  return v_id;
end;
$$;

create or replace function public.set_story_mutation_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid := public.current_household_id();
  v_mutation public.other_mutations%rowtype;
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  perform 1 from public.households where id = v_household_id for update;

  select * into v_mutation from public.other_mutations where id = p_id for update;
  if v_mutation.id is null or v_mutation.household_id <> v_household_id then
    raise exception 'Cerita tidak ditemukan atau akses ditolak';
  end if;

  update public.other_mutations
  set deleted_at = case when coalesce(p_archived, false) then timezone('utc', now()) else null end,
      deleted_by = case when coalesce(p_archived, false) then auth.uid() else null end
  where id = p_id;

  perform public.assert_household_balance_nonnegative(v_household_id);
end;
$$;

revoke all on function public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[]) from public, anon;
revoke all on function public.set_story_mutation_archived(uuid,boolean) from public, anon;
grant execute on function public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[]) to authenticated;
grant execute on function public.set_story_mutation_archived(uuid,boolean) to authenticated;

-- Fungsi lama tidak lagi menjadi jalur tulis publik setelah P0.
revoke execute on function public.sync_story_photos(uuid,uuid[],text[]) from authenticated;

-- ============================================================
-- 5. LOVE CAPSULE: METADATA + ISI + REFERENSI FOTO ATOMIC
-- ============================================================
create or replace function public.save_love_capsule_atomic(
  p_id uuid,
  p_recipient_user_id uuid,
  p_unlock_at timestamptz,
  p_teaser text,
  p_theme text,
  p_is_anniversary boolean,
  p_title text,
  p_message text,
  p_delete_ids uuid[],
  p_new_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_household_id uuid := public.current_household_id();
  v_existing public.love_capsules%rowtype;
  v_recipient_household uuid;
  v_remaining integer;
  v_path text;
  v_index integer := 0;
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  if p_unlock_at is null or p_unlock_at <= now() then raise exception 'Tanggal buka harus berada di masa depan'; end if;
  if p_recipient_user_id is null or p_recipient_user_id = auth.uid() then raise exception 'Love Capsule harus ditujukan kepada pasangan'; end if;
  if p_theme not in ('rose','lavender','sky','sunset') then raise exception 'Tema kapsul tidak valid'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Judul kapsul wajib diisi, maksimal 80 karakter'; end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 3000 then raise exception 'Pesan kapsul wajib diisi, maksimal 3000 karakter'; end if;
  if char_length(btrim(coalesce(p_teaser, ''))) > 100 then raise exception 'Teaser maksimal 100 karakter'; end if;

  select household_id into v_recipient_household
  from public.household_members where user_id = p_recipient_user_id;
  if v_recipient_household is null or v_recipient_household <> v_household_id then
    raise exception 'Penerima bukan anggota household yang sama';
  end if;

  perform 1 from public.households where id = v_household_id for update;
  select * into v_existing from public.love_capsules where id = v_id for update;

  if v_existing.id is null then
    insert into public.love_capsules(
      id, household_id, sender_user_id, recipient_user_id, unlock_at, teaser, theme, is_anniversary
    ) values (
      v_id, v_household_id, auth.uid(), p_recipient_user_id, p_unlock_at,
      nullif(btrim(coalesce(p_teaser, '')), ''), p_theme, coalesce(p_is_anniversary, false)
    );
    insert into public.love_capsule_contents(capsule_id, household_id, title, message)
    values (v_id, v_household_id, btrim(p_title), btrim(p_message));
  else
    if v_existing.household_id <> v_household_id
       or v_existing.sender_user_id <> auth.uid()
       or v_existing.opened_at is not null
       or v_existing.unlock_at <= now() then
      raise exception 'Kapsul tidak dapat diubah';
    end if;
    update public.love_capsules
    set recipient_user_id = p_recipient_user_id,
        unlock_at = p_unlock_at,
        teaser = nullif(btrim(coalesce(p_teaser, '')), ''),
        theme = p_theme,
        is_anniversary = coalesce(p_is_anniversary, false)
    where id = v_id;
    insert into public.love_capsule_contents(capsule_id, household_id, title, message)
    values (v_id, v_household_id, btrim(p_title), btrim(p_message))
    on conflict (capsule_id) do update
    set title = excluded.title,
        message = excluded.message,
        household_id = excluded.household_id;
  end if;

  delete from public.love_capsule_photos
  where capsule_id = v_id
    and id = any(coalesce(p_delete_ids, array[]::uuid[]));

  select count(*) into v_remaining from public.love_capsule_photos where capsule_id = v_id;
  if v_remaining + cardinality(coalesce(p_new_paths, array[]::text[])) > 10 then
    raise exception 'Satu Love Capsule maksimal memiliki 10 foto';
  end if;

  set constraints love_capsule_photo_order_unique deferred;
  with ordered as (
    select id, (row_number() over (order by sort_order, created_at, id) - 1)::smallint as new_order
    from public.love_capsule_photos where capsule_id = v_id
  )
  update public.love_capsule_photos p
  set sort_order = ordered.new_order
  from ordered where p.id = ordered.id;

  select count(*) into v_remaining from public.love_capsule_photos where capsule_id = v_id;
  foreach v_path in array coalesce(p_new_paths, array[]::text[])
  loop
    if v_path is null or btrim(v_path) = ''
       or split_part(v_path, '/', 1) <> v_household_id::text
       or split_part(v_path, '/', 2) <> v_id::text then
      raise exception 'Path foto Love Capsule tidak valid';
    end if;
    insert into public.love_capsule_photos(household_id, capsule_id, storage_path, sort_order, uploaded_by)
    values (v_household_id, v_id, v_path, v_remaining + v_index, auth.uid());
    v_index := v_index + 1;
  end loop;

  update public.love_capsules c
  set photo_count = (select count(*) from public.love_capsule_photos p where p.capsule_id = c.id)
  where c.id = v_id;

  return v_id;
end;
$$;

create or replace function public.delete_love_capsule(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid := public.current_household_id();
  v_capsule public.love_capsules%rowtype;
  v_paths text[] := array[]::text[];
begin
  if auth.uid() is null or v_household_id is null then raise exception 'Session atau household tidak tersedia'; end if;
  perform 1 from public.households where id = v_household_id for update;
  select * into v_capsule from public.love_capsules where id = p_id for update;
  if v_capsule.id is null
     or v_capsule.household_id <> v_household_id
     or v_capsule.sender_user_id <> auth.uid()
     or v_capsule.opened_at is not null
     or v_capsule.unlock_at <= now() then
    raise exception 'Kapsul tidak dapat dihapus';
  end if;

  select coalesce(array_agg(storage_path order by sort_order), array[]::text[])
  into v_paths
  from public.love_capsule_photos where capsule_id = p_id;

  delete from public.love_capsules where id = p_id;
  return v_paths;
end;
$$;

revoke all on function public.save_love_capsule_atomic(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[]) from public, anon;
revoke all on function public.delete_love_capsule(uuid) from public, anon;
grant execute on function public.save_love_capsule_atomic(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[]) to authenticated;
grant execute on function public.delete_love_capsule(uuid) to authenticated;
revoke execute on function public.save_love_capsule(uuid,uuid,timestamptz,text,text,boolean,text,text) from authenticated;
revoke execute on function public.sync_love_capsule_photos(uuid,uuid[],text[]) from authenticated;

-- File baru diupload sebelum transaksi DB. Uploader boleh menaruh file pada UUID kapsul
-- yang belum ada; RPC atomic kemudian memvalidasi path dan mengaitkannya ke metadata.
drop policy if exists "Sender can upload pending love capsule files" on storage.objects;
create policy "Sender can upload pending love capsule files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'love-capsules'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and owner_id = auth.uid()::text
  and (
    public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
    or not exists (
      select 1 from public.love_capsules c
      where c.id = ((storage.foldername(name))[2])::uuid
    )
  )
);

-- Setelah metadata kapsul dihapus, uploader tetap boleh membersihkan file miliknya.
drop policy if exists "Sender can delete pending love capsule files" on storage.objects;
create policy "Sender can delete pending love capsule files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'love-capsules'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and (
    public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
    or owner_id = auth.uid()::text
  )
);

-- ============================================================
-- 6. STORAGE SERVER-SIDE CONSTRAINTS
-- ============================================================
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'transfer-proofs', 'transfer-proofs', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 7. TUTUP JALUR TULIS LANGSUNG DARI CLIENT
-- ============================================================
revoke insert, update, delete on public.monthly_deposits from authenticated;
revoke insert, update, delete on public.other_mutations from authenticated;
revoke insert, update, delete on public.story_photos from authenticated;
revoke insert, update, delete on public.members from authenticated;
revoke insert, update, delete on public.love_capsules from authenticated;
revoke insert, update, delete on public.love_capsule_contents from authenticated;
revoke insert, update, delete on public.love_capsule_photos from authenticated;

grant select on public.monthly_deposits, public.other_mutations, public.story_photos,
  public.members, public.love_capsules, public.love_capsule_contents, public.love_capsule_photos
  to authenticated;

commit;

-- VERIFIKASI P0
select
  to_regprocedure('public.save_monthly_deposit(uuid,uuid,integer,integer,date,numeric,date,numeric,text)') is not null as rpc_setoran,
  to_regprocedure('public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[])') is not null as rpc_cerita,
  to_regprocedure('public.save_love_capsule_atomic(uuid,uuid,timestamp with time zone,text,text,boolean,text,text,uuid[],text[])') is not null as rpc_capsule,
  exists(
    select 1 from storage.buckets
    where id = 'transfer-proofs'
      and public = false
      and file_size_limit = 5242880
  ) as bucket_bukti_aman,
  to_regprocedure('public.consume_api_rate_limit(text,text,integer,integer,integer)') is not null as rate_limit_aktif;
