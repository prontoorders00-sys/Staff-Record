-- Close the remaining launch-critical authorization and payroll integrity gaps.

-- Business ownership is created by the database, never by a caller choosing
-- their own role. This also keeps business creation and owner membership in
-- the same transaction.
create or replace function private.bootstrap_business_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_memberships (business_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner');
  return new;
end;
$$;

drop trigger if exists businesses_bootstrap_owner_membership on public.businesses;
create trigger businesses_bootstrap_owner_membership
  after insert on public.businesses
  for each row execute procedure private.bootstrap_business_owner_membership();

revoke all on function private.bootstrap_business_owner_membership() from public;
revoke all on function private.bootstrap_business_owner_membership() from anon;
revoke all on function private.bootstrap_business_owner_membership() from authenticated;

-- Repair any legacy business that was created before owner bootstrapping.
insert into public.business_memberships (business_id, user_id, role)
select id, owner_user_id, 'owner'::public.member_role
from public.businesses
on conflict (business_id, user_id) do update set role = 'owner';

create or replace function private.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.businesses
    where id = target_business_id
      and owner_user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_business_owner(uuid) from public;
revoke all on function private.is_business_owner(uuid) from anon;
grant execute on function private.is_business_owner(uuid) to authenticated;

drop policy if exists "memberships: owner can add or self can add" on public.business_memberships;
drop policy if exists "memberships: owner can update" on public.business_memberships;
drop policy if exists "memberships: owners and managers can add" on public.business_memberships;
drop policy if exists "memberships: owners can update" on public.business_memberships;
drop policy if exists "memberships: owners can delete" on public.business_memberships;

create policy "memberships: owners and managers can add"
  on public.business_memberships for insert to authenticated
  with check (
    (
      private.is_business_owner(business_id)
      and role in ('manager', 'employee')
    )
    or (
      private.is_business_manager(business_id)
      and role = 'employee'
    )
  );

create policy "memberships: owners can update"
  on public.business_memberships for update to authenticated
  using (
    private.is_business_owner(business_id)
    and role <> 'owner'
  )
  with check (
    private.is_business_owner(business_id)
    and role in ('manager', 'employee')
  );

create policy "memberships: owners can delete"
  on public.business_memberships for delete to authenticated
  using (
    private.is_business_owner(business_id)
    and role <> 'owner'
  );

create or replace function private.protect_business_membership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      raise exception using
        errcode = '55000',
        message = 'The business owner membership cannot be deleted.';
    end if;
    return old;
  end if;

  if old.business_id <> new.business_id or old.user_id <> new.user_id then
    raise exception using
      errcode = '55000',
      message = 'Membership identity cannot be changed.';
  end if;

  if old.role = 'owner' or new.role = 'owner' then
    raise exception using
      errcode = '55000',
      message = 'Business ownership cannot be changed through memberships.';
  end if;

  return new;
end;
$$;

drop trigger if exists business_memberships_protect_identity on public.business_memberships;
create trigger business_memberships_protect_identity
  before update or delete on public.business_memberships
  for each row execute procedure private.protect_business_membership();

revoke all on function private.protect_business_membership() from public;
revoke all on function private.protect_business_membership() from anon;
revoke all on function private.protect_business_membership() from authenticated;

-- Managers need the complete staff register. Employees may only read their
-- own linked row, preventing disclosure of coworkers' phone and wage details.
drop policy if exists "employees: members can read" on public.employees;
drop policy if exists "employees: managers and self can read" on public.employees;
create policy "employees: managers and self can read"
  on public.employees for select to authenticated
  using (
    private.is_business_manager(business_id)
    or user_id = (select auth.uid())
  );

-- Snapshot and validate the pay frequency used for every calculation.
alter table public.pay_runs
  add column pay_frequency public.pay_frequency;

update public.pay_runs as pay_run
set pay_frequency = employee.pay_frequency
from public.employees as employee
where employee.id = pay_run.employee_id
  and employee.business_id = pay_run.business_id;

alter table public.pay_runs
  alter column pay_frequency set not null;

create or replace function private.prepare_pay_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  employee_record record;
  inclusive_days integer;
begin
  select wage_type, wage_rate, pay_frequency
  into employee_record
  from public.employees
  where id = new.employee_id
    and business_id = new.business_id
    and active;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'An active employee in this business is required.';
  end if;

  new.wage_type := employee_record.wage_type;
  new.wage_rate := employee_record.wage_rate;
  new.pay_frequency := employee_record.pay_frequency;
  inclusive_days := new.period_end - new.period_start + 1;

  if new.pay_frequency = 'weekly' and inclusive_days <> 7 then
    raise exception using
      errcode = '23514',
      message = 'Weekly payroll periods must contain exactly 7 days.';
  elsif new.pay_frequency = 'fortnightly' and inclusive_days <> 14 then
    raise exception using
      errcode = '23514',
      message = 'Fortnightly payroll periods must contain exactly 14 days.';
  elsif new.pay_frequency = 'monthly' and (
    new.period_start <> date_trunc('month', new.period_start)::date
    or new.period_end <> (date_trunc('month', new.period_start) + interval '1 month - 1 day')::date
  ) then
    raise exception using
      errcode = '23514',
      message = 'Monthly payroll periods must cover one complete calendar month.';
  end if;

  return new;
end;
$$;

drop trigger if exists pay_runs_prepare_insert on public.pay_runs;
create trigger pay_runs_prepare_insert
  before insert on public.pay_runs
  for each row execute procedure private.prepare_pay_run();

revoke all on function private.prepare_pay_run() from public;
revoke all on function private.prepare_pay_run() from anon;
revoke all on function private.prepare_pay_run() from authenticated;

create extension if not exists btree_gist with schema extensions;

alter table public.pay_runs
  add constraint pay_runs_no_overlapping_active_periods
  exclude using gist (
    employee_id with =,
    daterange(period_start, period_end, '[]') with &&
  )
  where (status <> 'cancelled');

