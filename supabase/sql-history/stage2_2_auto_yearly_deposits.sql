-- TAHAP 2.2 - SETORAN OTOMATIS PER TAHUN
-- Jalankan sekali setelah migration/hotfix sebelumnya.
-- Perilaku:
-- 1. Tahun berjalan otomatis memiliki Januari-Desember untuk seluruh anggota household.
-- 2. Tahun depan belum dibuat sebelum kalender benar-benar masuk ke tahun tersebut.
-- 3. Data lama tidak diubah.
-- 4. Periode yang sengaja diarsipkan tidak dibuat ulang.

begin;

create or replace function public.ensure_current_year_deposits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_current_year integer := extract(year from timezone('Asia/Jakarta', now()))::integer;
  v_inserted integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select hm.household_id
    into v_household_id
  from public.household_members hm
  where hm.user_id = v_user_id
  limit 1;

  if v_household_id is null then
    raise exception 'Household membership not found';
  end if;

  insert into public.monthly_deposits (
    household_id,
    member_id,
    year,
    month,
    due_date,
    required_amount,
    paid_amount,
    status
  )
  select
    v_household_id,
    m.id,
    v_current_year,
    month_no,
    make_date(
      v_current_year,
      month_no,
      least(
        m.payday,
        extract(
          day from (
            make_date(v_current_year, month_no, 1)
            + interval '1 month - 1 day'
          )
        )::integer
      )
    ),
    m.monthly_amount,
    0,
    'UNPAID'
  from public.members m
  cross join generate_series(1, 12) as months(month_no)
  where m.household_id = v_household_id
    and not exists (
      select 1
      from public.monthly_deposits d
      where d.member_id = m.id
        and d.year = v_current_year
        and d.month = month_no
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.ensure_current_year_deposits() from public, anon;
grant execute on function public.ensure_current_year_deposits() to authenticated;

-- Bersihkan hanya placeholder tahun depan yang masih benar-benar kosong dan
-- masih sama persis dengan nilai default anggota. Data yang sudah pernah diisi
-- atau dimodifikasi tidak disentuh.
delete from public.monthly_deposits d
using public.members m
where d.member_id = m.id
  and d.year > extract(year from timezone('Asia/Jakarta', now()))::integer
  and coalesce(d.paid_amount, 0) = 0
  and d.actual_transfer_date is null
  and d.proof_image_url is null
  and d.required_amount = m.monthly_amount
  and d.due_date = make_date(
    d.year,
    d.month,
    least(
      m.payday,
      extract(
        day from (
          make_date(d.year, d.month, 1)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  );

-- Siapkan Januari-Desember tahun berjalan sekarang juga untuk seluruh household.
insert into public.monthly_deposits (
  household_id,
  member_id,
  year,
  month,
  due_date,
  required_amount,
  paid_amount,
  status
)
select
  m.household_id,
  m.id,
  extract(year from timezone('Asia/Jakarta', now()))::integer,
  month_no,
  make_date(
    extract(year from timezone('Asia/Jakarta', now()))::integer,
    month_no,
    least(
      m.payday,
      extract(
        day from (
          make_date(extract(year from timezone('Asia/Jakarta', now()))::integer, month_no, 1)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  ),
  m.monthly_amount,
  0,
  'UNPAID'
from public.members m
cross join generate_series(1, 12) as months(month_no)
where not exists (
  select 1
  from public.monthly_deposits d
  where d.member_id = m.id
    and d.year = extract(year from timezone('Asia/Jakarta', now()))::integer
    and d.month = month_no
);

commit;

-- VERIFIKASI: tiap anggota seharusnya punya 12 periode pada tahun berjalan.
select
  m.name,
  extract(year from timezone('Asia/Jakarta', now()))::integer as tahun,
  count(d.id) filter (where d.deleted_at is null) as periode_aktif,
  case
    when count(d.id) filter (where d.deleted_at is null) = 12 then 'OK'
    else 'CEK LAGI'
  end as status
from public.members m
left join public.monthly_deposits d
  on d.member_id = m.id
 and d.year = extract(year from timezone('Asia/Jakarta', now()))::integer
group by m.id, m.name
order by m.name;
