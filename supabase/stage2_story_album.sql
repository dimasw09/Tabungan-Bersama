-- TAHAP 2 - CERITA & ALBUM FOTO
-- Jalankan sekali di Supabase SQL Editor setelah seluruh migration/hotfix Tahap 1.
-- Membuat album privat maksimal 10 foto untuk setiap cerita (other_mutations).

begin;

create table if not exists public.story_photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id() references public.households(id) on delete cascade,
  mutation_id uuid not null references public.other_mutations(id) on delete cascade,
  storage_path text not null,
  sort_order smallint not null default 0 check (sort_order between 0 and 9),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint story_photos_storage_path_unique unique (storage_path),
  constraint story_photos_mutation_order_unique unique (mutation_id, sort_order) deferrable initially immediate
);

alter table public.story_photos drop constraint if exists story_photos_mutation_order_unique;
alter table public.story_photos add constraint story_photos_mutation_order_unique
unique (mutation_id, sort_order) deferrable initially immediate;

create index if not exists story_photos_household_mutation_idx
on public.story_photos(household_id, mutation_id, sort_order);

create or replace function public.validate_story_photo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_household_id uuid;
  v_count integer;
begin
  select household_id into v_household_id
  from public.other_mutations
  where id = new.mutation_id
    and deleted_at is null;

  if v_household_id is null then
    raise exception 'Cerita tidak ditemukan atau sudah berada di arsip';
  end if;

  if new.household_id is null then
    new.household_id = v_household_id;
  end if;

  if new.household_id <> v_household_id then
    raise exception 'Foto dan cerita harus berada di household yang sama';
  end if;

  if new.uploaded_by is null then
    new.uploaded_by = auth.uid();
  end if;

  select count(*) into v_count
  from public.story_photos
  where mutation_id = new.mutation_id
    and id <> new.id;

  if v_count >= 10 then
    raise exception 'Satu cerita maksimal memiliki 10 foto';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_story_photo_trg on public.story_photos;
create trigger validate_story_photo_trg
before insert or update on public.story_photos
for each row execute function public.validate_story_photo();

-- Album juga masuk audit trail. Penghapusan foto bersifat hard-delete,
-- tetapi jejak metadata tetap tersimpan pada audit_logs.
drop trigger if exists audit_story_photos_trg on public.story_photos;
create trigger audit_story_photos_trg
after insert or delete on public.story_photos
for each row execute function public.audit_row_change();

alter table public.story_photos enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'story_photos'
  loop
    execute format('drop policy if exists %I on public.story_photos', r.policyname);
  end loop;
end $$;

create policy "Household can read story photos"
on public.story_photos for select to authenticated
using (household_id = public.current_household_id());

create policy "Household can insert story photos"
on public.story_photos for insert to authenticated
with check (
  household_id = public.current_household_id()
  and exists (
    select 1 from public.other_mutations m
    where m.id = story_photos.mutation_id
      and m.household_id = public.current_household_id()
      and m.deleted_at is null
  )
);

create policy "Household can update story photos"
on public.story_photos for update to authenticated
using (household_id = public.current_household_id())
with check (household_id = public.current_household_id());

create policy "Household can delete story photos"
on public.story_photos for delete to authenticated
using (household_id = public.current_household_id());

grant select, insert, update, delete on public.story_photos to authenticated;
revoke all on public.story_photos from anon;

-- Sinkronisasi album dijalankan sebagai satu transaksi database:
-- foto yang ditandai hapus dan foto baru diterapkan bersamaan.
create or replace function public.sync_story_photos(
  p_mutation_id uuid,
  p_delete_ids uuid[],
  p_new_paths text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household_id uuid;
  v_remaining integer;
  v_path text;
  v_index integer := 0;
begin
  select household_id into v_household_id
  from public.other_mutations
  where id = p_mutation_id
    and household_id = public.current_household_id()
    and deleted_at is null
  for update;

  if v_household_id is null then
    raise exception 'Cerita tidak ditemukan atau akses ditolak';
  end if;

  delete from public.story_photos
  where mutation_id = p_mutation_id
    and id = any(coalesce(p_delete_ids, array[]::uuid[]));

  select count(*) into v_remaining
  from public.story_photos
  where mutation_id = p_mutation_id;

  if v_remaining + cardinality(coalesce(p_new_paths, array[]::text[])) > 10 then
    raise exception 'Satu cerita maksimal memiliki 10 foto';
  end if;

  set constraints story_photos_mutation_order_unique deferred;

  with ordered as (
    select id, (row_number() over (order by sort_order, created_at, id) - 1)::smallint as new_order
    from public.story_photos
    where mutation_id = p_mutation_id
  )
  update public.story_photos p
  set sort_order = ordered.new_order
  from ordered
  where p.id = ordered.id;

  select count(*) into v_remaining
  from public.story_photos
  where mutation_id = p_mutation_id;

  foreach v_path in array coalesce(p_new_paths, array[]::text[])
  loop
    if v_path is null or btrim(v_path) = '' then
      raise exception 'Path foto tidak valid';
    end if;

    if split_part(v_path, '/', 1) <> v_household_id::text
       or split_part(v_path, '/', 2) <> p_mutation_id::text then
      raise exception 'Path foto tidak sesuai dengan cerita';
    end if;

    insert into public.story_photos(
      household_id, mutation_id, storage_path, sort_order, uploaded_by
    ) values (
      v_household_id, p_mutation_id, v_path, v_remaining + v_index, auth.uid()
    );

    v_index := v_index + 1;
  end loop;
end;
$$;

revoke all on function public.sync_story_photos(uuid, uuid[], text[]) from public, anon;
grant execute on function public.sync_story_photos(uuid, uuid[], text[]) to authenticated;

-- Bucket privat. Foto hanya bisa dibaca melalui signed URL oleh anggota household.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('story-albums', 'story-albums', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Household can read story albums" on storage.objects;
drop policy if exists "Household can upload story albums" on storage.objects;
drop policy if exists "Household can update story albums" on storage.objects;
drop policy if exists "Household can delete story albums" on storage.objects;

create policy "Household can read story albums"
on storage.objects for select to authenticated
using (
  bucket_id = 'story-albums'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
);

create policy "Household can upload story albums"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'story-albums'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
);

create policy "Household can update story albums"
on storage.objects for update to authenticated
using (
  bucket_id = 'story-albums'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
)
with check (
  bucket_id = 'story-albums'
  and (storage.foldername(name))[1] = public.current_household_id()::text
);

create policy "Household can delete story albums"
on storage.objects for delete to authenticated
using (
  bucket_id = 'story-albums'
  and public.current_household_id() is not null
  and (storage.foldername(name))[1] = public.current_household_id()::text
);

commit;

-- VERIFIKASI
select
  to_regclass('public.story_photos') as tabel_album,
  exists(select 1 from storage.buckets where id = 'story-albums') as bucket_album_tersedia,
  10 as maksimal_foto_per_cerita;
