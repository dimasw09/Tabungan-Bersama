-- P0 STABILITY & SECURITY FIX
-- Jalankan SEKALI langsung di Supabase SQL Editor.
-- Ini bukan rangkaian migration; file ini memasang RPC/trigger yang dipakai source v2.3.1.

begin;

-- =========================================================
-- 1. RATE LIMIT SERVER (hanya service_role yang boleh memakai)
-- =========================================================
create table if not exists public.api_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  hit_count integer not null default 0 check (hit_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.api_rate_limits%rowtype;
  v_reset_at timestamptz;
begin
  if p_key_hash is null or length(p_key_hash) <> 64 then raise exception 'Rate-limit key tidak valid'; end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'Rate-limit limit tidak valid'; end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then raise exception 'Rate-limit window tidak valid'; end if;

  insert into public.api_rate_limits(key_hash, window_started_at, hit_count, updated_at)
  values (p_key_hash, v_now, 0, v_now)
  on conflict (key_hash) do nothing;

  select * into v_row from public.api_rate_limits where key_hash = p_key_hash for update;
  v_reset_at := v_row.window_started_at + make_interval(secs => p_window_seconds);

  if v_reset_at <= v_now then
    update public.api_rate_limits
    set window_started_at = v_now, hit_count = 1, updated_at = v_now
    where key_hash = p_key_hash;
    return query select true, 0;
  elsif v_row.hit_count >= p_limit then
    return query select false, greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer);
  else
    update public.api_rate_limits
    set hit_count = hit_count + 1, updated_at = v_now
    where key_hash = p_key_hash;
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.consume_api_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,integer,integer) to service_role;

-- =========================================================
-- 2. BATAS BUCKET BUKTI TRANSFER DI SERVER
-- =========================================================
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'transfer-proofs', 'transfer-proofs', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =========================================================
-- 3. PENGAMAN SALDO DI DATABASE
-- Semua perubahan mutasi dikunci per household dan tidak boleh membuat saldo minus.
-- =========================================================
create or replace function public.enforce_other_mutation_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_household uuid;
  v_excluded_id uuid;
  v_balance numeric := 0;
begin
  v_household := case when tg_op = 'DELETE' then old.household_id else new.household_id end;
  v_excluded_id := case when tg_op = 'INSERT' then null else old.id end;

  if v_household is null then raise exception 'Household mutasi tidak valid'; end if;
  if tg_op = 'UPDATE' and old.household_id <> new.household_id then raise exception 'Household mutasi tidak boleh diubah'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_household::text, 0));

  select
    coalesce((select sum(d.paid_amount) from public.monthly_deposits d
      where d.household_id = v_household and d.deleted_at is null), 0)
    + coalesce((select sum(case when m.type = 'Tambah' then m.amount else -m.amount end)
      from public.other_mutations m
      where m.household_id = v_household
        and m.deleted_at is null
        and (v_excluded_id is null or m.id <> v_excluded_id)), 0)
  into v_balance;

  if tg_op <> 'DELETE' and new.deleted_at is null then
    v_balance := v_balance + case when new.type = 'Tambah' then new.amount else -new.amount end;
  end if;

  if v_balance < 0 then
    raise exception 'Saldo kita tidak mencukupi untuk perubahan ini';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_other_mutation_balance_trg on public.other_mutations;
create trigger enforce_other_mutation_balance_trg
before insert or update or delete on public.other_mutations
for each row execute function public.enforce_other_mutation_balance();

-- Perubahan setoran juga tidak boleh membuat saldo yang sudah terpakai menjadi minus.
create or replace function public.enforce_monthly_deposit_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_household uuid;
  v_excluded_id uuid;
  v_balance numeric := 0;
begin
  v_household := case when tg_op = 'DELETE' then old.household_id else new.household_id end;
  v_excluded_id := case when tg_op = 'INSERT' then null else old.id end;

  if v_household is null then raise exception 'Household setoran tidak valid'; end if;
  if tg_op = 'UPDATE' and old.household_id <> new.household_id then raise exception 'Household setoran tidak boleh diubah'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_household::text, 0));

  select
    coalesce((select sum(d.paid_amount) from public.monthly_deposits d
      where d.household_id = v_household
        and d.deleted_at is null
        and (v_excluded_id is null or d.id <> v_excluded_id)), 0)
    + coalesce((select sum(case when m.type = 'Tambah' then m.amount else -m.amount end)
      from public.other_mutations m
      where m.household_id = v_household and m.deleted_at is null), 0)
  into v_balance;

  if tg_op <> 'DELETE' and new.deleted_at is null then
    v_balance := v_balance + coalesce(new.paid_amount, 0);
  end if;

  if v_balance < 0 then
    raise exception 'Setoran tidak dapat dikurangi karena sebagian saldo sudah dipakai';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_monthly_deposit_balance_trg on public.monthly_deposits;
create trigger enforce_monthly_deposit_balance_trg
before insert or update or delete on public.monthly_deposits
for each row execute function public.enforce_monthly_deposit_balance();

-- Simpan mutasi + metadata album sebagai satu transaksi database.
create or replace function public.save_story_mutation(
  p_id uuid,
  p_mutation_date date,
  p_type text,
  p_amount numeric,
  p_description text,
  p_delete_photo_ids uuid[],
  p_new_photo_paths text[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_household uuid := public.current_household_id();
  v_exists boolean;
  v_available numeric := 0;
begin
  if v_household is null then raise exception 'Akses household tidak tersedia'; end if;
  if p_mutation_date is null or p_mutation_date > (now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal cerita tidak valid'; end if;
  if p_type not in ('Tambah','Penarikan') then raise exception 'Jenis cerita tidak valid'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'Nominal cerita tidak valid'; end if;
  if char_length(coalesce(p_description, '')) > 160 then raise exception 'Cerita maksimal 160 karakter'; end if;
  if p_type = 'Penarikan' and btrim(coalesce(p_description, '')) = '' then raise exception 'Cerita penarikan wajib diisi'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_household::text, 0));

  select exists(
    select 1 from public.other_mutations
    where id = v_id and household_id = v_household and deleted_at is null
  ) into v_exists;

  if p_id is not null and not v_exists and exists(select 1 from public.other_mutations where id = p_id) then
    raise exception 'Cerita tidak dapat diubah';
  end if;

  select
    coalesce((select sum(d.paid_amount) from public.monthly_deposits d
      where d.household_id = v_household and d.deleted_at is null), 0)
    + coalesce((select sum(case when m.type = 'Tambah' then m.amount else -m.amount end)
      from public.other_mutations m
      where m.household_id = v_household and m.deleted_at is null and m.id <> v_id), 0)
  into v_available;

  if p_type = 'Penarikan' and p_amount > v_available then
    raise exception 'Saldo kita yang tersedia hanya Rp%', trim(to_char(v_available, 'FM999G999G999G999G990'));
  end if;

  if v_exists then
    update public.other_mutations
    set mutation_date = p_mutation_date,
        type = p_type,
        amount = p_amount,
        description = nullif(btrim(coalesce(p_description, '')), '')
    where id = v_id and household_id = v_household and deleted_at is null;
  else
    insert into public.other_mutations(id, household_id, mutation_date, type, amount, description)
    values (v_id, v_household, p_mutation_date, p_type, p_amount, nullif(btrim(coalesce(p_description, '')), ''));
  end if;

  perform public.sync_story_photos(
    v_id,
    coalesce(p_delete_photo_ids, array[]::uuid[]),
    coalesce(p_new_photo_paths, array[]::text[])
  );

  return v_id;
end;
$$;

revoke all on function public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[]) from public, anon;
grant execute on function public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[]) to authenticated;

-- =========================================================
-- 4. LOVE CAPSULE: metadata, isi, dan daftar foto atomik
-- =========================================================
create or replace function public.save_love_capsule_complete(
  p_id uuid,
  p_recipient_user_id uuid,
  p_unlock_at timestamptz,
  p_teaser text,
  p_theme text,
  p_is_anniversary boolean,
  p_title text,
  p_message text,
  p_delete_photo_ids uuid[],
  p_new_photo_paths text[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := public.save_love_capsule(
    p_id, p_recipient_user_id, p_unlock_at, p_teaser, p_theme,
    p_is_anniversary, p_title, p_message
  );
  perform public.sync_love_capsule_photos(
    v_id,
    coalesce(p_delete_photo_ids, array[]::uuid[]),
    coalesce(p_new_photo_paths, array[]::text[])
  );
  return v_id;
end;
$$;

revoke all on function public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[]) from public, anon;
grant execute on function public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[]) to authenticated;

-- Upload baru dilakukan sebelum metadata dibuat agar kegagalan upload tidak menyisakan kapsul setengah jadi.
-- File staging tetap tidak dapat dibaca; hanya pengunggah satu household yang dapat membuat/menghapusnya.
drop policy if exists "Sender can upload pending love capsule files" on storage.objects;
create policy "Sender can upload pending love capsule files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'love-capsules'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and (
    public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
    or not exists (
      select 1 from public.love_capsules c
      where c.id = ((storage.foldername(name))[2])::uuid
    )
  )
);

drop policy if exists "Sender can delete pending love capsule files" on storage.objects;
create policy "Sender can delete pending love capsule files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'love-capsules'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and (
    public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
    or not exists (
      select 1 from public.love_capsules c
      where c.id = ((storage.foldername(name))[2])::uuid
    )
  )
);

-- Hapus metadata terlebih dahulu dan kembalikan path untuk cleanup Storage sesudah commit.
create or replace function public.cancel_love_capsule(p_capsule_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_paths text[];
begin
  if not public.can_manage_love_capsule(p_capsule_id) then raise exception 'Kapsul tidak dapat dibatalkan'; end if;
  select coalesce(array_agg(storage_path order by sort_order), array[]::text[])
  into v_paths
  from public.love_capsule_photos
  where capsule_id = p_capsule_id;

  delete from public.love_capsules where id = p_capsule_id;
  if not found then raise exception 'Love Capsule tidak ditemukan'; end if;
  return v_paths;
end;
$$;

revoke all on function public.cancel_love_capsule(uuid) from public, anon;
grant execute on function public.cancel_love_capsule(uuid) to authenticated;

-- =========================================================
-- 5. PENGATURAN ANGGOTA + SINKRON SETORAN ATOMIK
-- =========================================================
create or replace function public.update_member_settings(
  p_member_id uuid,
  p_monthly_amount numeric,
  p_payday integer,
  p_color text,
  p_sync_unpaid boolean
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household uuid := public.current_household_id();
  v_synced integer := 0;
begin
  if v_household is null then raise exception 'Akses household tidak tersedia'; end if;
  if p_monthly_amount is null or p_monthly_amount <= 0 or p_monthly_amount > 1000000000 then raise exception 'Nominal setoran tidak valid'; end if;
  if p_payday is null or p_payday < 1 or p_payday > 31 then raise exception 'Tanggal setor tidak valid'; end if;
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Warna profil tidak valid'; end if;

  perform 1 from public.members
  where id = p_member_id
    and household_id = v_household
    and auth_user_id = auth.uid()
  for update;
  if not found then raise exception 'Pengaturan anggota ini tidak boleh diubah'; end if;

  update public.members
  set monthly_amount = p_monthly_amount, payday = p_payday, color = upper(p_color)
  where id = p_member_id;

  if coalesce(p_sync_unpaid, false) then
    update public.monthly_deposits d
    set required_amount = p_monthly_amount,
        due_date = make_date(
          d.year,
          d.month,
          least(
            p_payday,
            extract(day from (make_date(d.year, d.month, 1) + interval '1 month - 1 day'))::integer
          )
        ),
        status = 'UNPAID'
    where d.member_id = p_member_id
      and d.household_id = v_household
      and d.deleted_at is null
      and coalesce(d.paid_amount, 0) <= 0;
    get diagnostics v_synced = row_count;
  end if;

  return v_synced;
end;
$$;

revoke all on function public.update_member_settings(uuid,numeric,integer,text,boolean) from public, anon;
grant execute on function public.update_member_settings(uuid,numeric,integer,text,boolean) to authenticated;

commit;

-- VERIFIKASI RINGKAS
select
  to_regprocedure('public.consume_api_rate_limit(text,integer,integer)') is not null as rate_limit_ok,
  to_regprocedure('public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[])') is not null as story_atomic_ok,
  to_regprocedure('public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[])') is not null as capsule_atomic_ok,
  to_regprocedure('public.update_member_settings(uuid,numeric,integer,text,boolean)') is not null as member_atomic_ok,
  to_regprocedure('public.cancel_love_capsule(uuid)') is not null as capsule_cancel_ok,
  (select file_size_limit from storage.buckets where id = 'transfer-proofs') as transfer_proof_limit;
