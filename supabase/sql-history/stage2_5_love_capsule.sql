-- TAHAP 2.5 - LOVE CAPSULE & ANNIVERSARY 25 SEPTEMBER
-- Jalankan satu kali setelah seluruh migration Tahap 1, album Cerita, dan auto-setoran tahunan.
-- Isi kapsul benar-benar ditahan oleh RLS sampai waktu buka (Asia/Jakarta) tercapai.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.love_capsules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id() references public.households(id) on delete cascade,
  sender_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  unlock_at timestamptz not null,
  teaser text,
  theme text not null default 'rose' check (theme in ('rose','lavender','sky','sunset')),
  is_anniversary boolean not null default false,
  photo_count smallint not null default 0 check (photo_count between 0 and 10),
  opened_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint love_capsules_sender_recipient_different check (sender_user_id <> recipient_user_id),
  constraint love_capsules_teaser_length check (char_length(coalesce(teaser, '')) <= 100)
);

create table if not exists public.love_capsule_contents (
  capsule_id uuid primary key references public.love_capsules(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint love_capsule_title_length check (char_length(btrim(title)) between 1 and 80),
  constraint love_capsule_message_length check (char_length(btrim(message)) between 1 and 3000)
);

create table if not exists public.love_capsule_photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  capsule_id uuid not null references public.love_capsules(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null default 0 check (sort_order between 0 and 9),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint love_capsule_photo_order_unique unique (capsule_id, sort_order) deferrable initially immediate
);

create index if not exists love_capsules_household_unlock_idx
on public.love_capsules(household_id, unlock_at desc);
create index if not exists love_capsules_recipient_due_idx
on public.love_capsules(recipient_user_id, unlock_at, opened_at);
create index if not exists love_capsule_photos_capsule_idx
on public.love_capsule_photos(capsule_id, sort_order);

-- Helper SECURITY DEFINER dipakai juga oleh policy Storage. Semuanya tetap memverifikasi auth.uid().
create or replace function public.can_read_love_capsule(p_capsule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.love_capsules c
    where c.id = p_capsule_id
      and c.household_id = public.current_household_id()
      and (
        c.sender_user_id = auth.uid()
        or (c.recipient_user_id = auth.uid() and c.unlock_at <= now())
      )
  );
$$;

create or replace function public.can_manage_love_capsule(p_capsule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.love_capsules c
    where c.id = p_capsule_id
      and c.household_id = public.current_household_id()
      and c.sender_user_id = auth.uid()
      and c.opened_at is null
      and c.unlock_at > now()
  );
$$;

revoke all on function public.can_read_love_capsule(uuid) from public, anon;
revoke all on function public.can_manage_love_capsule(uuid) from public, anon;
grant execute on function public.can_read_love_capsule(uuid) to authenticated;
grant execute on function public.can_manage_love_capsule(uuid) to authenticated;

create or replace function public.validate_love_capsule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_household uuid;
  v_recipient_household uuid;
begin
  v_household := public.current_household_id();
  if v_household is null then raise exception 'Akses household tidak tersedia'; end if;

  if tg_op = 'INSERT' then
    new.household_id := v_household;
    new.sender_user_id := auth.uid();
  else
    -- Satu-satunya perubahan yang diizinkan setelah jatuh tempo adalah menandai opened_at
    -- oleh penerima lewat RPC open_love_capsule(). Field lain harus tetap identik.
    if new.opened_at is distinct from old.opened_at then
      if old.opened_at is null
         and new.opened_at is not null
         and old.recipient_user_id = auth.uid()
         and old.unlock_at <= now()
         and new.household_id = old.household_id
         and new.sender_user_id = old.sender_user_id
         and new.recipient_user_id = old.recipient_user_id
         and new.unlock_at = old.unlock_at
         and new.teaser is not distinct from old.teaser
         and new.theme = old.theme
         and new.is_anniversary = old.is_anniversary
         and new.photo_count = old.photo_count then
        return new;
      end if;
      raise exception 'Status buka hanya dapat diubah oleh penerima setelah waktunya tiba';
    end if;

    if old.sender_user_id <> auth.uid() or old.unlock_at <= now() or old.opened_at is not null then
      raise exception 'Kapsul yang sudah jatuh tempo atau terbuka tidak dapat diubah';
    end if;
    if new.household_id <> old.household_id or new.sender_user_id <> old.sender_user_id then
      raise exception 'Pemilik kapsul tidak dapat diubah';
    end if;
  end if;

  if new.unlock_at <= now() then raise exception 'Tanggal buka harus berada di masa depan'; end if;
  if new.recipient_user_id = auth.uid() then raise exception 'Love Capsule harus ditujukan kepada pasangan'; end if;

  select hm.household_id into v_recipient_household
  from public.household_members hm
  where hm.user_id = new.recipient_user_id;

  if v_recipient_household is null or v_recipient_household <> v_household then
    raise exception 'Penerima bukan anggota household yang sama';
  end if;

  new.teaser := nullif(btrim(coalesce(new.teaser, '')), '');
  return new;
end;
$$;

drop trigger if exists validate_love_capsule_trg on public.love_capsules;
create trigger validate_love_capsule_trg
before insert or update on public.love_capsules
for each row execute function public.validate_love_capsule();

drop trigger if exists love_capsules_updated_at_trg on public.love_capsules;
create trigger love_capsules_updated_at_trg
before update on public.love_capsules
for each row execute function public.set_updated_at();

drop trigger if exists love_capsule_contents_updated_at_trg on public.love_capsule_contents;
create trigger love_capsule_contents_updated_at_trg
before update on public.love_capsule_contents
for each row execute function public.set_updated_at();

-- Audit hanya metadata kapsul. Isi rahasia tidak dimasukkan ke audit_logs agar tidak bocor ke pasangan sebelum waktunya.
drop trigger if exists audit_love_capsules_trg on public.love_capsules;
create trigger audit_love_capsules_trg
after insert or update or delete on public.love_capsules
for each row execute function public.audit_row_change();

alter table public.love_capsules enable row level security;
alter table public.love_capsule_contents enable row level security;
alter table public.love_capsule_photos enable row level security;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('love_capsules','love_capsule_contents','love_capsule_photos')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Metadata kapsul dapat dilihat pengirim dan penerima, tetapi tidak memuat judul/pesan rahasia.
create policy "Participants can read capsule metadata"
on public.love_capsules for select to authenticated
using (
  household_id = public.current_household_id()
  and auth.uid() in (sender_user_id, recipient_user_id)
);

create policy "Users can create capsule for partner"
on public.love_capsules for insert to authenticated
with check (
  household_id = public.current_household_id()
  and sender_user_id = auth.uid()
  and recipient_user_id <> auth.uid()
  and exists (
    select 1 from public.household_members hm
    where hm.user_id = recipient_user_id
      and hm.household_id = public.current_household_id()
  )
);

create policy "Sender can update pending capsule"
on public.love_capsules for update to authenticated
using (public.can_manage_love_capsule(id))
with check (public.can_manage_love_capsule(id));

create policy "Sender can delete pending capsule"
on public.love_capsules for delete to authenticated
using (public.can_manage_love_capsule(id));

-- Isi hanya terlihat oleh pengirim, atau penerima setelah waktu buka tercapai.
create policy "Allowed participant can read capsule content"
on public.love_capsule_contents for select to authenticated
using (
  household_id = public.current_household_id()
  and public.can_read_love_capsule(capsule_id)
);

create policy "Sender can insert capsule content"
on public.love_capsule_contents for insert to authenticated
with check (
  household_id = public.current_household_id()
  and public.can_manage_love_capsule(capsule_id)
);

create policy "Sender can update pending capsule content"
on public.love_capsule_contents for update to authenticated
using (public.can_manage_love_capsule(capsule_id))
with check (public.can_manage_love_capsule(capsule_id));

-- Foto memakai aturan akses yang sama dengan isi rahasia.
create policy "Allowed participant can read capsule photos"
on public.love_capsule_photos for select to authenticated
using (
  household_id = public.current_household_id()
  and public.can_read_love_capsule(capsule_id)
);

create policy "Sender can insert pending capsule photos"
on public.love_capsule_photos for insert to authenticated
with check (
  household_id = public.current_household_id()
  and uploaded_by = auth.uid()
  and public.can_manage_love_capsule(capsule_id)
);

create policy "Sender can update pending capsule photos"
on public.love_capsule_photos for update to authenticated
using (public.can_manage_love_capsule(capsule_id))
with check (public.can_manage_love_capsule(capsule_id));

create policy "Sender can delete pending capsule photos"
on public.love_capsule_photos for delete to authenticated
using (public.can_manage_love_capsule(capsule_id));

grant select, insert, update, delete on public.love_capsules to authenticated;
grant select, insert, update on public.love_capsule_contents to authenticated;
grant select, insert, update, delete on public.love_capsule_photos to authenticated;
revoke all on public.love_capsules, public.love_capsule_contents, public.love_capsule_photos from anon;

-- Simpan metadata + isi sebagai satu transaksi. p_id boleh UUID baru atau ID kapsul milik pengirim yang masih pending.
create or replace function public.save_love_capsule(
  p_id uuid,
  p_recipient_user_id uuid,
  p_unlock_at timestamptz,
  p_teaser text,
  p_theme text,
  p_is_anniversary boolean,
  p_title text,
  p_message text
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
begin
  if v_household is null then raise exception 'Akses household tidak tersedia'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Judul kapsul wajib diisi'; end if;
  if btrim(coalesce(p_message, '')) = '' then raise exception 'Pesan kapsul wajib diisi'; end if;
  if p_theme not in ('rose','lavender','sky','sunset') then raise exception 'Tema kapsul tidak valid'; end if;

  select exists(select 1 from public.love_capsules where id = v_id) into v_exists;

  if v_exists then
    if not public.can_manage_love_capsule(v_id) then raise exception 'Kapsul tidak dapat diubah'; end if;
    update public.love_capsules
    set recipient_user_id = p_recipient_user_id,
        unlock_at = p_unlock_at,
        teaser = p_teaser,
        theme = p_theme,
        is_anniversary = coalesce(p_is_anniversary, false)
    where id = v_id;

    update public.love_capsule_contents
    set title = btrim(p_title), message = btrim(p_message)
    where capsule_id = v_id;
  else
    insert into public.love_capsules(
      id, household_id, sender_user_id, recipient_user_id, unlock_at, teaser, theme, is_anniversary
    ) values (
      v_id, v_household, auth.uid(), p_recipient_user_id, p_unlock_at, p_teaser, p_theme, coalesce(p_is_anniversary, false)
    );

    insert into public.love_capsule_contents(capsule_id, household_id, title, message)
    values (v_id, v_household, btrim(p_title), btrim(p_message));
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_love_capsule(uuid,uuid,timestamptz,text,text,boolean,text,text) from public, anon;
grant execute on function public.save_love_capsule(uuid,uuid,timestamptz,text,text,boolean,text,text) to authenticated;

-- Sinkron foto maksimal 10 dalam satu transaksi metadata.
create or replace function public.sync_love_capsule_photos(
  p_capsule_id uuid,
  p_delete_ids uuid[],
  p_new_paths text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household uuid;
  v_remaining integer;
  v_path text;
  v_index integer := 0;
begin
  if not public.can_manage_love_capsule(p_capsule_id) then raise exception 'Kapsul tidak dapat diubah'; end if;

  select household_id into v_household from public.love_capsules where id = p_capsule_id for update;

  delete from public.love_capsule_photos
  where capsule_id = p_capsule_id
    and id = any(coalesce(p_delete_ids, array[]::uuid[]));

  select count(*) into v_remaining from public.love_capsule_photos where capsule_id = p_capsule_id;
  if v_remaining + cardinality(coalesce(p_new_paths, array[]::text[])) > 10 then
    raise exception 'Satu Love Capsule maksimal memiliki 10 foto';
  end if;

  set constraints love_capsule_photo_order_unique deferred;
  with ordered as (
    select id, (row_number() over (order by sort_order, created_at, id) - 1)::smallint as new_order
    from public.love_capsule_photos where capsule_id = p_capsule_id
  )
  update public.love_capsule_photos p
  set sort_order = ordered.new_order
  from ordered where p.id = ordered.id;

  select count(*) into v_remaining from public.love_capsule_photos where capsule_id = p_capsule_id;

  foreach v_path in array coalesce(p_new_paths, array[]::text[])
  loop
    if v_path is null or btrim(v_path) = '' then raise exception 'Path foto tidak valid'; end if;
    if split_part(v_path, '/', 1) <> v_household::text
       or split_part(v_path, '/', 2) <> p_capsule_id::text then
      raise exception 'Path foto tidak sesuai dengan kapsul';
    end if;

    insert into public.love_capsule_photos(household_id, capsule_id, storage_path, sort_order, uploaded_by)
    values (v_household, p_capsule_id, v_path, v_remaining + v_index, auth.uid());
    v_index := v_index + 1;
  end loop;

  update public.love_capsules c
  set photo_count = (select count(*) from public.love_capsule_photos p where p.capsule_id = c.id)
  where c.id = p_capsule_id;
end;
$$;

revoke all on function public.sync_love_capsule_photos(uuid,uuid[],text[]) from public, anon;
grant execute on function public.sync_love_capsule_photos(uuid,uuid[],text[]) to authenticated;

-- Pembukaan hanya oleh penerima dan hanya setelah waktunya tiba. Pemanggilan berulang aman.
create or replace function public.open_love_capsule(p_capsule_id uuid)
returns table(capsule_id uuid, title text, message text, opened_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capsule public.love_capsules%rowtype;
begin
  select * into v_capsule from public.love_capsules where id = p_capsule_id for update;
  if v_capsule.id is null then raise exception 'Love Capsule tidak ditemukan'; end if;
  if v_capsule.household_id <> public.current_household_id() then raise exception 'Akses ditolak'; end if;
  if v_capsule.recipient_user_id <> auth.uid() then raise exception 'Hanya penerima yang dapat membuka kapsul'; end if;
  if v_capsule.unlock_at > now() then raise exception 'Belum waktunya membuka Love Capsule ini'; end if;

  if v_capsule.opened_at is null then
    update public.love_capsules
    set opened_at = timezone('utc', now())
    where id = p_capsule_id;
  end if;

  return query
  select c.capsule_id, c.title, c.message, lc.opened_at
  from public.love_capsule_contents c
  join public.love_capsules lc on lc.id = c.capsule_id
  where c.capsule_id = p_capsule_id;
end;
$$;

revoke all on function public.open_love_capsule(uuid) from public, anon;
grant execute on function public.open_love_capsule(uuid) to authenticated;

-- Bucket privat. Path wajib: household_id/capsule_id/file.ext
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('love-capsules', 'love-capsules', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Allowed participant can read love capsule files" on storage.objects;
drop policy if exists "Sender can upload pending love capsule files" on storage.objects;
drop policy if exists "Sender can update pending love capsule files" on storage.objects;
drop policy if exists "Sender can delete pending love capsule files" on storage.objects;

create policy "Allowed participant can read love capsule files"
on storage.objects for select to authenticated
using (
  bucket_id = 'love-capsules'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and public.can_read_love_capsule(((storage.foldername(name))[2])::uuid)
);

create policy "Sender can upload pending love capsule files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'love-capsules'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
);

create policy "Sender can update pending love capsule files"
on storage.objects for update to authenticated
using (
  bucket_id = 'love-capsules'
  and public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
)
with check (
  bucket_id = 'love-capsules'
  and (storage.foldername(name))[1] = public.current_household_id()::text
  and public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
);

create policy "Sender can delete pending love capsule files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'love-capsules'
  and public.can_manage_love_capsule(((storage.foldername(name))[2])::uuid)
);

commit;

-- VERIFIKASI
select
  to_regclass('public.love_capsules') as tabel_kapsul,
  to_regclass('public.love_capsule_contents') as tabel_isi_rahasia,
  to_regclass('public.love_capsule_photos') as tabel_foto,
  exists(select 1 from storage.buckets where id = 'love-capsules' and public = false) as bucket_privat,
  10 as maksimal_foto,
  '25 September' as anniversary_utama;
