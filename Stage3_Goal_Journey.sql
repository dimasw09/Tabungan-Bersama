-- TAHAP 3 - GOAL JOURNEY
-- Jalankan setelah seluruh migration Tahap 1, album Cerita, dan setoran tahunan otomatis.
-- Fitur:
-- 1) Satu goal aktif per household.
-- 2) Progress otomatis mengikuti perubahan saldo.
-- 3) Milestone perjalanan.
-- 4) Goal selesai/arsip tetap tersimpan sebagai riwayat.
-- 5) Cerita dapat dihubungkan ke Goal Journey.

begin;

create table if not exists public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id() references public.households(id) on delete cascade,
  title text not null,
  description text,
  icon text not null default '✨',
  target_amount numeric(18,2) not null,
  start_date date not null default current_date,
  target_date date,
  progress_mode text not null default 'CURRENT_BALANCE' check (progress_mode in ('CURRENT_BALANCE', 'FROM_ZERO')),
  baseline_balance numeric(18,2) not null default 0,
  starting_amount numeric(18,2) not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  completed_amount numeric(18,2),
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint saving_goals_title_length check (char_length(btrim(title)) between 1 and 80),
  constraint saving_goals_description_length check (description is null or char_length(description) <= 240),
  constraint saving_goals_icon_length check (char_length(icon) between 1 and 12),
  constraint saving_goals_target_positive check (target_amount > 0),
  constraint saving_goals_amounts_nonnegative check (baseline_balance >= 0 and starting_amount >= 0 and coalesce(completed_amount, 0) >= 0),
  constraint saving_goals_target_date_valid check (target_date is null or target_date >= start_date)
);

create unique index if not exists saving_goals_one_active_per_household
on public.saving_goals(household_id)
where status = 'ACTIVE';

create index if not exists saving_goals_household_status_idx
on public.saving_goals(household_id, status, created_at desc);

create table if not exists public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id() references public.households(id) on delete cascade,
  goal_id uuid not null references public.saving_goals(id) on delete cascade,
  title text not null,
  target_amount numeric(18,2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint goal_milestones_title_length check (char_length(btrim(title)) between 1 and 80),
  constraint goal_milestones_target_positive check (target_amount > 0),
  constraint goal_milestones_sort_order_nonnegative check (sort_order >= 0),
  constraint goal_milestones_goal_order_unique unique(goal_id, sort_order)
);

create index if not exists goal_milestones_household_goal_idx
on public.goal_milestones(household_id, goal_id, sort_order);

alter table public.other_mutations
  add column if not exists goal_id uuid references public.saving_goals(id) on delete set null;

create index if not exists other_mutations_goal_id_idx
on public.other_mutations(goal_id)
where goal_id is not null;

create or replace function public.validate_goal_milestone()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  goal_household uuid;
  goal_target numeric(18,2);
begin
  select household_id, target_amount
  into goal_household, goal_target
  from public.saving_goals
  where id = new.goal_id;

  if goal_household is null then
    raise exception 'Goal tidak ditemukan';
  end if;
  if new.household_id is null then
    new.household_id = goal_household;
  end if;
  if new.household_id <> goal_household then
    raise exception 'Milestone dan goal harus berada di household yang sama';
  end if;
  if new.target_amount > goal_target then
    raise exception 'Nominal milestone tidak boleh melebihi target goal';
  end if;
  return new;
end;
$$;

create or replace function public.validate_story_goal()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  goal_household uuid;
begin
  if new.goal_id is null then return new; end if;
  select household_id into goal_household from public.saving_goals where id = new.goal_id;
  if goal_household is null then raise exception 'Goal Journey tidak ditemukan'; end if;
  if goal_household <> new.household_id then raise exception 'Cerita dan goal harus berada di household yang sama'; end if;
  return new;
end;
$$;

create or replace function public.save_goal_journey(
  p_goal_id uuid,
  p_title text,
  p_description text,
  p_icon text,
  p_target_amount numeric,
  p_start_date date,
  p_target_date date,
  p_progress_mode text,
  p_baseline_balance numeric,
  p_starting_amount numeric,
  p_milestones jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid := public.current_household_id();
  v_goal_id uuid;
  v_item jsonb;
  v_count integer;
  v_current_balance numeric(18,2) := 0;
begin
  if v_household_id is null then raise exception 'Sesi household tidak ditemukan'; end if;

  select
    coalesce((select sum(d.paid_amount) from public.monthly_deposits d where d.household_id = v_household_id and d.deleted_at is null), 0)
    + coalesce((select sum(case when m.type = 'Tambah' then m.amount else -m.amount end) from public.other_mutations m where m.household_id = v_household_id and m.deleted_at is null), 0)
  into v_current_balance;
  v_current_balance := greatest(coalesce(v_current_balance, 0), 0);

  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then raise exception 'Nama goal wajib diisi maksimal 80 karakter'; end if;
  if p_description is not null and char_length(p_description) > 240 then raise exception 'Deskripsi goal maksimal 240 karakter'; end if;
  if p_target_amount is null or p_target_amount <= 0 then raise exception 'Target goal harus lebih dari nol'; end if;
  if p_start_date is null then raise exception 'Tanggal mulai wajib diisi'; end if;
  if p_target_date is not null and p_target_date < p_start_date then raise exception 'Target tanggal tidak boleh sebelum tanggal mulai'; end if;
  if p_progress_mode not in ('CURRENT_BALANCE', 'FROM_ZERO') then raise exception 'Mode progress tidak valid'; end if;
  if coalesce(p_baseline_balance, 0) < 0 or coalesce(p_starting_amount, 0) < 0 then raise exception 'Saldo awal tidak valid'; end if;
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array' then raise exception 'Format milestone tidak valid'; end if;

  v_count := jsonb_array_length(coalesce(p_milestones, '[]'::jsonb));
  if v_count < 1 or v_count > 6 then raise exception 'Goal harus memiliki 1 sampai 6 milestone'; end if;

  if p_goal_id is null then
    if exists (select 1 from public.saving_goals where household_id = v_household_id and status = 'ACTIVE') then
      raise exception 'Selesaikan atau arsipkan goal aktif sebelum membuat goal baru';
    end if;

    insert into public.saving_goals(
      household_id, title, description, icon, target_amount, start_date, target_date,
      progress_mode, baseline_balance, starting_amount, status, created_by
    ) values (
      v_household_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(nullif(btrim(p_icon), ''), '✨'),
      p_target_amount, p_start_date, p_target_date, p_progress_mode,
      v_current_balance, case when p_progress_mode = 'CURRENT_BALANCE' then v_current_balance else 0 end, 'ACTIVE', auth.uid()
    ) returning id into v_goal_id;
  else
    select id into v_goal_id
    from public.saving_goals
    where id = p_goal_id and household_id = v_household_id and status = 'ACTIVE'
    for update;

    if v_goal_id is null then raise exception 'Goal aktif tidak ditemukan atau tidak dapat diubah'; end if;

    update public.saving_goals
    set title = btrim(p_title),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        icon = coalesce(nullif(btrim(p_icon), ''), '✨'),
        target_amount = p_target_amount,
        start_date = p_start_date,
        target_date = p_target_date
    where id = v_goal_id;

    delete from public.goal_milestones where goal_id = v_goal_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_milestones)
  loop
    if coalesce(btrim(v_item ->> 'title'), '') = '' then raise exception 'Nama milestone wajib diisi'; end if;
    if coalesce((v_item ->> 'target_amount')::numeric, 0) <= 0 then raise exception 'Nominal milestone harus lebih dari nol'; end if;
    if (v_item ->> 'target_amount')::numeric > p_target_amount then raise exception 'Nominal milestone tidak boleh melebihi target goal'; end if;

    insert into public.goal_milestones(household_id, goal_id, title, target_amount, sort_order)
    values (
      v_household_id,
      v_goal_id,
      btrim(v_item ->> 'title'),
      (v_item ->> 'target_amount')::numeric,
      coalesce((v_item ->> 'sort_order')::integer, 0)
    );
  end loop;

  return v_goal_id;
end;
$$;

create or replace function public.complete_goal_journey(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal public.saving_goals%rowtype;
  v_current_balance numeric(18,2) := 0;
  v_progress numeric(18,2) := 0;
begin
  select * into v_goal
  from public.saving_goals
  where id = p_goal_id
    and household_id = public.current_household_id()
    and status = 'ACTIVE'
  for update;

  if v_goal.id is null then raise exception 'Goal aktif tidak ditemukan'; end if;

  select
    coalesce((select sum(d.paid_amount) from public.monthly_deposits d where d.household_id = v_goal.household_id and d.deleted_at is null), 0)
    + coalesce((select sum(case when m.type = 'Tambah' then m.amount else -m.amount end) from public.other_mutations m where m.household_id = v_goal.household_id and m.deleted_at is null), 0)
  into v_current_balance;

  v_progress := greatest(v_goal.starting_amount + coalesce(v_current_balance, 0) - v_goal.baseline_balance, 0);
  if v_progress < v_goal.target_amount then
    raise exception 'Target belum tercapai. Progress saat ini % dari target %', v_progress, v_goal.target_amount;
  end if;

  update public.saving_goals
  set status = 'COMPLETED',
      completed_amount = v_progress,
      completed_at = timezone('utc', now())
  where id = v_goal.id;
end;
$$;

create or replace function public.archive_goal_journey(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal public.saving_goals%rowtype;
  v_current_balance numeric(18,2) := 0;
  v_progress numeric(18,2) := 0;
begin
  select * into v_goal
  from public.saving_goals
  where id = p_goal_id
    and household_id = public.current_household_id()
    and status = 'ACTIVE'
  for update;

  if v_goal.id is null then raise exception 'Goal aktif tidak ditemukan'; end if;

  select
    coalesce((select sum(d.paid_amount) from public.monthly_deposits d where d.household_id = v_goal.household_id and d.deleted_at is null), 0)
    + coalesce((select sum(case when m.type = 'Tambah' then m.amount else -m.amount end) from public.other_mutations m where m.household_id = v_goal.household_id and m.deleted_at is null), 0)
  into v_current_balance;

  v_progress := greatest(v_goal.starting_amount + coalesce(v_current_balance, 0) - v_goal.baseline_balance, 0);

  update public.saving_goals
  set status = 'ARCHIVED',
      completed_amount = v_progress
  where id = v_goal.id;
end;
$$;

-- Trigger waktu, validasi, dan audit.
drop trigger if exists set_saving_goals_updated_at on public.saving_goals;
create trigger set_saving_goals_updated_at
before update on public.saving_goals
for each row execute function public.set_updated_at();

drop trigger if exists validate_goal_milestone_trg on public.goal_milestones;
create trigger validate_goal_milestone_trg
before insert or update on public.goal_milestones
for each row execute function public.validate_goal_milestone();

drop trigger if exists validate_story_goal_trg on public.other_mutations;
create trigger validate_story_goal_trg
before insert or update on public.other_mutations
for each row execute function public.validate_story_goal();

drop trigger if exists audit_saving_goals_trg on public.saving_goals;
create trigger audit_saving_goals_trg
after insert or update or delete on public.saving_goals
for each row execute function public.audit_row_change();

drop trigger if exists audit_goal_milestones_trg on public.goal_milestones;
create trigger audit_goal_milestones_trg
after insert or update or delete on public.goal_milestones
for each row execute function public.audit_row_change();

alter table public.saving_goals enable row level security;
alter table public.goal_milestones enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename in ('saving_goals', 'goal_milestones')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "Household can read goals"
on public.saving_goals for select to authenticated
using (household_id = public.current_household_id());

create policy "Household can read goal milestones"
on public.goal_milestones for select to authenticated
using (household_id = public.current_household_id());

-- Penulisan Goal Journey hanya melalui RPC tervalidasi.
-- Client authenticated memperoleh akses baca langsung, bukan write langsung.

revoke insert, update, delete on public.saving_goals from authenticated;
revoke insert, update, delete on public.goal_milestones from authenticated;
grant select on public.saving_goals, public.goal_milestones to authenticated;
grant execute on function public.save_goal_journey(uuid, text, text, text, numeric, date, date, text, numeric, numeric, jsonb) to authenticated;
grant execute on function public.complete_goal_journey(uuid) to authenticated;
grant execute on function public.archive_goal_journey(uuid) to authenticated;
revoke all on public.saving_goals, public.goal_milestones from anon;
revoke all on function public.save_goal_journey(uuid, text, text, text, numeric, date, date, text, numeric, numeric, jsonb) from public, anon;
revoke all on function public.complete_goal_journey(uuid) from public, anon;
revoke all on function public.archive_goal_journey(uuid) from public, anon;

commit;

-- VERIFIKASI STRUKTUR.
select
  to_regclass('public.saving_goals') as tabel_goal,
  to_regclass('public.goal_milestones') as tabel_milestone,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'other_mutations' and column_name = 'goal_id'
  ) as cerita_terhubung_goal;
