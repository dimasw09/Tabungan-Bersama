-- P1 CODE QUALITY & MEDIA FIX v2.4.1
-- Jalankan SEKALI di Supabase SQL Editor setelah P0_FIX_EXECUTE_ONCE.sql.
-- Ini bukan migration chain. File ini menambah periode efektif target setoran,
-- thumbnail album, serta RPC atomik versi P1 yang dipakai source v2.4.0.

begin;

-- =========================================================
-- 1. THUMBNAIL PATH UNTUK ALBUM CERITA & LOVE CAPSULE
-- Baris lama tetap aman: thumbnail memakai file utama sampai diganti.
-- =========================================================
alter table public.story_photos add column if not exists thumbnail_path text;
alter table public.love_capsule_photos add column if not exists thumbnail_path text;

-- Hanya backfill foto dengan parent yang masih aktif. Foto dari cerita yang telah
-- diarsipkan dibiarkan NULL; frontend tetap memakai storage_path sebagai fallback.
update public.story_photos sp
set thumbnail_path = sp.storage_path
where sp.thumbnail_path is null
  and exists (
    select 1
    from public.other_mutations m
    where m.id = sp.mutation_id
      and m.deleted_at is null
  );

update public.love_capsule_photos lp
set thumbnail_path = lp.storage_path
where lp.thumbnail_path is null
  and exists (
    select 1
    from public.love_capsules c
    where c.id = lp.capsule_id
  );

-- =========================================================
-- 2. CERITA: metadata original + thumbnail tersimpan atomik
-- =========================================================
drop function if exists public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[]);
drop function if exists public.sync_story_photos(uuid,uuid[],text[]);

create or replace function public.sync_story_photos(
  p_mutation_id uuid,
  p_delete_ids uuid[],
  p_new_paths text[],
  p_new_thumbnail_paths text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household_id uuid;
  v_remaining integer;
  v_count integer := coalesce(array_length(p_new_paths, 1), 0);
  v_thumb_count integer := coalesce(array_length(p_new_thumbnail_paths, 1), 0);
  v_path text;
  v_thumbnail_path text;
  v_index integer;
begin
  select household_id into v_household_id
  from public.other_mutations
  where id = p_mutation_id
    and household_id = public.current_household_id()
    and deleted_at is null
  for update;

  if v_household_id is null then raise exception 'Cerita tidak ditemukan atau akses ditolak'; end if;
  if v_count <> v_thumb_count then raise exception 'Pasangan file original dan thumbnail tidak lengkap'; end if;

  delete from public.story_photos
  where mutation_id = p_mutation_id
    and id = any(coalesce(p_delete_ids, array[]::uuid[]));

  select count(*) into v_remaining from public.story_photos where mutation_id = p_mutation_id;
  if v_remaining + v_count > 10 then raise exception 'Satu cerita maksimal memiliki 10 foto'; end if;

  set constraints story_photos_mutation_order_unique deferred;
  with ordered as (
    select id, (row_number() over (order by sort_order, created_at, id) - 1)::smallint as new_order
    from public.story_photos where mutation_id = p_mutation_id
  )
  update public.story_photos p
  set sort_order = ordered.new_order
  from ordered where p.id = ordered.id;

  select count(*) into v_remaining from public.story_photos where mutation_id = p_mutation_id;

  if v_count > 0 then
    for v_index in 1..v_count loop
      v_path := p_new_paths[v_index];
      v_thumbnail_path := coalesce(nullif(btrim(p_new_thumbnail_paths[v_index]), ''), v_path);
      if v_path is null or btrim(v_path) = '' then raise exception 'Path foto tidak valid'; end if;
      if split_part(v_path, '/', 1) <> v_household_id::text
         or split_part(v_path, '/', 2) <> p_mutation_id::text then
        raise exception 'Path foto tidak sesuai dengan cerita';
      end if;
      if split_part(v_thumbnail_path, '/', 1) <> v_household_id::text
         or split_part(v_thumbnail_path, '/', 2) <> p_mutation_id::text then
        raise exception 'Path thumbnail tidak sesuai dengan cerita';
      end if;

      insert into public.story_photos(
        household_id, mutation_id, storage_path, thumbnail_path, sort_order, uploaded_by
      ) values (
        v_household_id, p_mutation_id, v_path, v_thumbnail_path,
        v_remaining + v_index - 1, auth.uid()
      );
    end loop;
  end if;
end;
$$;

revoke all on function public.sync_story_photos(uuid,uuid[],text[],text[]) from public, anon;
grant execute on function public.sync_story_photos(uuid,uuid[],text[],text[]) to authenticated;

create or replace function public.save_story_mutation(
  p_id uuid,
  p_mutation_date date,
  p_type text,
  p_amount numeric,
  p_description text,
  p_delete_photo_ids uuid[],
  p_new_photo_paths text[],
  p_new_thumbnail_paths text[]
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
    coalesce(p_new_photo_paths, array[]::text[]),
    coalesce(p_new_thumbnail_paths, array[]::text[])
  );
  return v_id;
end;
$$;

revoke all on function public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[],text[]) from public, anon;
grant execute on function public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[],text[]) to authenticated;

-- =========================================================
-- 3. LOVE CAPSULE: original + thumbnail atomik
-- =========================================================
drop function if exists public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[]);
drop function if exists public.sync_love_capsule_photos(uuid,uuid[],text[]);

create or replace function public.sync_love_capsule_photos(
  p_capsule_id uuid,
  p_delete_ids uuid[],
  p_new_paths text[],
  p_new_thumbnail_paths text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household uuid;
  v_remaining integer;
  v_count integer := coalesce(array_length(p_new_paths, 1), 0);
  v_thumb_count integer := coalesce(array_length(p_new_thumbnail_paths, 1), 0);
  v_path text;
  v_thumbnail_path text;
  v_index integer;
begin
  if not public.can_manage_love_capsule(p_capsule_id) then raise exception 'Kapsul tidak dapat diubah'; end if;
  if v_count <> v_thumb_count then raise exception 'Pasangan file original dan thumbnail tidak lengkap'; end if;

  select household_id into v_household from public.love_capsules where id = p_capsule_id for update;

  delete from public.love_capsule_photos
  where capsule_id = p_capsule_id
    and id = any(coalesce(p_delete_ids, array[]::uuid[]));

  select count(*) into v_remaining from public.love_capsule_photos where capsule_id = p_capsule_id;
  if v_remaining + v_count > 10 then raise exception 'Satu Love Capsule maksimal memiliki 10 foto'; end if;

  set constraints love_capsule_photo_order_unique deferred;
  with ordered as (
    select id, (row_number() over (order by sort_order, created_at, id) - 1)::smallint as new_order
    from public.love_capsule_photos where capsule_id = p_capsule_id
  )
  update public.love_capsule_photos p
  set sort_order = ordered.new_order
  from ordered where p.id = ordered.id;

  select count(*) into v_remaining from public.love_capsule_photos where capsule_id = p_capsule_id;

  if v_count > 0 then
    for v_index in 1..v_count loop
      v_path := p_new_paths[v_index];
      v_thumbnail_path := coalesce(nullif(btrim(p_new_thumbnail_paths[v_index]), ''), v_path);
      if v_path is null or btrim(v_path) = '' then raise exception 'Path foto tidak valid'; end if;
      if split_part(v_path, '/', 1) <> v_household::text
         or split_part(v_path, '/', 2) <> p_capsule_id::text then
        raise exception 'Path foto tidak sesuai dengan kapsul';
      end if;
      if split_part(v_thumbnail_path, '/', 1) <> v_household::text
         or split_part(v_thumbnail_path, '/', 2) <> p_capsule_id::text then
        raise exception 'Path thumbnail tidak sesuai dengan kapsul';
      end if;

      insert into public.love_capsule_photos(
        household_id, capsule_id, storage_path, thumbnail_path, sort_order, uploaded_by
      ) values (
        v_household, p_capsule_id, v_path, v_thumbnail_path,
        v_remaining + v_index - 1, auth.uid()
      );
    end loop;
  end if;

  update public.love_capsules c
  set photo_count = (select count(*) from public.love_capsule_photos p where p.capsule_id = c.id)
  where c.id = p_capsule_id;
end;
$$;

revoke all on function public.sync_love_capsule_photos(uuid,uuid[],text[],text[]) from public, anon;
grant execute on function public.sync_love_capsule_photos(uuid,uuid[],text[],text[]) to authenticated;

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
  p_new_photo_paths text[],
  p_new_thumbnail_paths text[]
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
    coalesce(p_new_photo_paths, array[]::text[]),
    coalesce(p_new_thumbnail_paths, array[]::text[])
  );
  return v_id;
end;
$$;

revoke all on function public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[],text[]) from public, anon;
grant execute on function public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[],text[]) to authenticated;

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

  select coalesce(array_agg(distinct media_path), array[]::text[])
  into v_paths
  from (
    select storage_path as media_path from public.love_capsule_photos where capsule_id = p_capsule_id
    union all
    select thumbnail_path as media_path from public.love_capsule_photos where capsule_id = p_capsule_id and thumbnail_path is not null
  ) media;

  delete from public.love_capsules where id = p_capsule_id;
  if not found then raise exception 'Love Capsule tidak ditemukan'; end if;
  return v_paths;
end;
$$;

revoke all on function public.cancel_love_capsule(uuid) from public, anon;
grant execute on function public.cancel_love_capsule(uuid) to authenticated;

-- =========================================================
-- 4. TARGET SETORAN BERDASARKAN PERIODE EFEKTIF
-- Tidak lagi mengubah seluruh histori unpaid tanpa batas periode.
-- =========================================================
drop function if exists public.update_member_settings(uuid,numeric,integer,text,boolean);

create or replace function public.update_member_settings(
  p_member_id uuid,
  p_monthly_amount numeric,
  p_payday integer,
  p_color text,
  p_effective_from date
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household uuid := public.current_household_id();
  v_synced integer := 0;
  v_current_month date := date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date;
begin
  if v_household is null then raise exception 'Akses household tidak tersedia'; end if;
  if p_monthly_amount is null or p_monthly_amount <= 0 or p_monthly_amount > 1000000000 then raise exception 'Nominal setoran tidak valid'; end if;
  if p_payday is null or p_payday < 1 or p_payday > 31 then raise exception 'Tanggal setor tidak valid'; end if;
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Warna profil tidak valid'; end if;
  if p_effective_from is not null then
    if p_effective_from <> date_trunc('month', p_effective_from)::date then raise exception 'Periode efektif harus tanggal pertama bulan'; end if;
    if p_effective_from < v_current_month then raise exception 'Periode lama tidak boleh diubah'; end if;
  end if;

  perform 1 from public.members
  where id = p_member_id
    and household_id = v_household
    and auth_user_id = auth.uid()
  for update;
  if not found then raise exception 'Pengaturan anggota ini tidak boleh diubah'; end if;

  update public.members
  set monthly_amount = p_monthly_amount, payday = p_payday, color = upper(p_color)
  where id = p_member_id;

  if p_effective_from is not null then
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
      and coalesce(d.paid_amount, 0) <= 0
      and make_date(d.year, d.month, 1) >= p_effective_from;
    get diagnostics v_synced = row_count;
  end if;

  return v_synced;
end;
$$;

revoke all on function public.update_member_settings(uuid,numeric,integer,text,date) from public, anon;
grant execute on function public.update_member_settings(uuid,numeric,integer,text,date) to authenticated;

commit;

-- VERIFIKASI RINGKAS
select
  to_regprocedure('public.save_story_mutation(uuid,date,text,numeric,text,uuid[],text[],text[])') is not null as story_thumbnail_rpc_ok,
  to_regprocedure('public.save_love_capsule_complete(uuid,uuid,timestamptz,text,text,boolean,text,text,uuid[],text[],text[])') is not null as capsule_thumbnail_rpc_ok,
  to_regprocedure('public.update_member_settings(uuid,numeric,integer,text,date)') is not null as member_period_rpc_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='story_photos' and column_name='thumbnail_path') as story_thumbnail_column_ok,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='love_capsule_photos' and column_name='thumbnail_path') as capsule_thumbnail_column_ok;
