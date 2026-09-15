-- Adds auditable wage calculations, advance recovery, and payroll records.
create type public.payroll_status as enum ('draft', 'paid', 'cancelled');

create unique index if not exists employees_id_business_id_key
  on public.employees(id, business_id);

create table public.pay_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_id uuid not null,
  period_start date not null,
  period_end date not null,
  pay_date date not null default current_date,
  wage_type public.wage_type not null,
  wage_rate numeric(12,2) not null check (wage_rate >= 0),
  worked_days integer not null default 0 check (worked_days >= 0),
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  gross_pay numeric(12,2) not null check (gross_pay >= 0),
  extra_pay numeric(12,2) not null default 0 check (extra_pay >= 0),
  deduction_amount numeric(12,2) not null default 0 check (deduction_amount >= 0),
  deduction_reason text,
  advance_repayment numeric(12,2) not null default 0 check (advance_repayment >= 0),
  net_pay numeric(12,2) generated always as (gross_pay + extra_pay - deduction_amount - advance_repayment) stored,
  payment_method text,
  note text,
  status public.payroll_status not null default 'draft',
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (employee_id, business_id) references public.employees(id, business_id) on delete restrict,
  check (period_end >= period_start),
  check (period_end - period_start <= 92),
  check (gross_pay + extra_pay >= deduction_amount + advance_repayment),
  check (deduction_amount = 0 or char_length(trim(deduction_reason)) between 2 and 240),
  check (payment_method is null or char_length(trim(payment_method)) between 2 and 80),
  check (note is null or char_length(note) <= 1000),
  check (
    (status = 'paid' and paid_at is not null and paid_by is not null)
    or (status <> 'paid' and paid_at is null and paid_by is null)
  )
);

create unique index pay_runs_one_active_period_idx
  on public.pay_runs(employee_id, period_start, period_end)
  where status <> 'cancelled';
create index pay_runs_business_pay_date_idx on public.pay_runs(business_id, pay_date desc);
create index pay_runs_employee_period_idx on public.pay_runs(employee_id, period_end desc);
create index pay_runs_created_by_idx on public.pay_runs(created_by);
create index pay_runs_paid_by_idx on public.pay_runs(paid_by) where paid_by is not null;

create trigger pay_runs_updated_at
  before update on public.pay_runs
  for each row execute procedure public.set_updated_at();

alter table public.pay_runs enable row level security;

create policy "pay runs: managers can read"
  on public.pay_runs for select to authenticated
  using (private.is_business_manager(business_id));
create policy "pay runs: managers can insert"
  on public.pay_runs for insert to authenticated
  with check (
    private.is_business_manager(business_id)
    and created_by = (select auth.uid())
    and status = 'draft'
  );
create policy "pay runs: managers can update"
  on public.pay_runs for update to authenticated
  using (private.is_business_manager(business_id))
  with check (private.is_business_manager(business_id));
create policy "pay runs: managers can delete"
  on public.pay_runs for delete to authenticated
  using (private.is_business_manager(business_id));

revoke all on table public.pay_runs from anon;
grant select, insert, update, delete on table public.pay_runs to authenticated;
grant all on table public.pay_runs to service_role;

create or replace function private.apply_pay_run_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_advance record;
  remaining_repayment numeric(12,2);
  applied_repayment numeric(12,2);
begin
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'A paid record cannot be reopened or cancelled.';
  end if;

  if new.status <> 'paid' or old.status = 'paid' then
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'Only a draft pay record can be marked paid.';
  end if;

  if (select auth.uid()) is null or not exists (
    select 1
    from public.business_memberships
    where business_id = new.business_id
      and user_id = (select auth.uid())
      and role in ('owner', 'manager')
  ) then
    raise exception 'Manager access required.';
  end if;

  remaining_repayment := new.advance_repayment;

  for target_advance in
    select id, amount, repaid_amount
    from public.advances
    where business_id = new.business_id
      and employee_id = new.employee_id
      and status in ('open', 'partially_repaid')
      and repaid_amount < amount
    order by issued_on, id
    for update
  loop
    exit when remaining_repayment <= 0;
    applied_repayment := least(remaining_repayment, target_advance.amount - target_advance.repaid_amount);

    update public.advances
    set
      repaid_amount = repaid_amount + applied_repayment,
      status = case
        when repaid_amount + applied_repayment >= amount then 'repaid'::public.advance_status
        else 'partially_repaid'::public.advance_status
      end
    where id = target_advance.id;

    remaining_repayment := remaining_repayment - applied_repayment;
  end loop;

  if remaining_repayment > 0 then
    raise exception 'Advance recovery exceeds the employee''s outstanding advance balance.';
  end if;

  new.paid_at := now();
  new.paid_by := (select auth.uid());

  insert into public.audit_events (
    business_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    details
  ) values (
    new.business_id,
    (select auth.uid()),
    'pay_run',
    new.id,
    'paid',
    jsonb_build_object(
      'employee_id', new.employee_id,
      'net_pay', new.net_pay,
      'advance_repayment', new.advance_repayment
    )
  );

  return new;
end;
$$;

create trigger pay_runs_apply_payment
  before update of status on public.pay_runs
  for each row execute procedure private.apply_pay_run_payment();

revoke all on function private.apply_pay_run_payment() from public;
revoke all on function private.apply_pay_run_payment() from anon;
revoke all on function private.apply_pay_run_payment() from authenticated;

-- Remove overlapping catch-all policies and give every operation one clear policy.
drop policy if exists "employees: members can read" on public.employees;
drop policy if exists "employees: managers can manage" on public.employees;
create policy "employees: members can read" on public.employees for select to authenticated using (private.is_business_member(business_id));
create policy "employees: managers can insert" on public.employees for insert to authenticated with check (private.is_business_manager(business_id));
create policy "employees: managers can update" on public.employees for update to authenticated using (private.is_business_manager(business_id)) with check (private.is_business_manager(business_id));
create policy "employees: managers can delete" on public.employees for delete to authenticated using (private.is_business_manager(business_id));

drop policy if exists "attendance: members can read" on public.attendance_entries;
drop policy if exists "attendance: managers can manage" on public.attendance_entries;
create policy "attendance: members can read" on public.attendance_entries for select to authenticated using (private.is_business_member(business_id));
create policy "attendance: managers can insert" on public.attendance_entries for insert to authenticated with check (private.is_business_manager(business_id));
create policy "attendance: managers can update" on public.attendance_entries for update to authenticated using (private.is_business_manager(business_id)) with check (private.is_business_manager(business_id));
create policy "attendance: managers can delete" on public.attendance_entries for delete to authenticated using (private.is_business_manager(business_id));

drop policy if exists "advances: managers can read" on public.advances;
drop policy if exists "advances: managers can manage" on public.advances;
create policy "advances: managers can read" on public.advances for select to authenticated using (private.is_business_manager(business_id));
create policy "advances: managers can insert" on public.advances for insert to authenticated with check (private.is_business_manager(business_id));
create policy "advances: managers can update" on public.advances for update to authenticated using (private.is_business_manager(business_id)) with check (private.is_business_manager(business_id));
create policy "advances: managers can delete" on public.advances for delete to authenticated using (private.is_business_manager(business_id));

drop policy if exists "tasks: members can read" on public.tasks;
drop policy if exists "tasks: managers can manage" on public.tasks;
create policy "tasks: members can read" on public.tasks for select to authenticated using (private.is_business_member(business_id));
create policy "tasks: managers can insert" on public.tasks for insert to authenticated with check (private.is_business_manager(business_id));
create policy "tasks: managers can update" on public.tasks for update to authenticated using (private.is_business_manager(business_id)) with check (private.is_business_manager(business_id));
create policy "tasks: managers can delete" on public.tasks for delete to authenticated using (private.is_business_manager(business_id));

drop policy if exists "profiles: own record" on public.profiles;
create policy "profiles: own record" on public.profiles for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "businesses: authenticated users can create" on public.businesses;
create policy "businesses: authenticated users can create" on public.businesses for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "businesses: owners can update" on public.businesses;
create policy "businesses: owners can update" on public.businesses for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "memberships: owner can add or self can add" on public.business_memberships;
create policy "memberships: owner can add or self can add" on public.business_memberships for insert to authenticated
  with check (user_id = (select auth.uid()) or private.is_business_manager(business_id));

-- Add covering indexes for foreign keys used by payroll and existing records.
create index if not exists advances_created_by_idx on public.advances(created_by);
create index if not exists advances_employee_id_idx on public.advances(employee_id);
create index if not exists attendance_entries_created_by_idx on public.attendance_entries(created_by);
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);
create index if not exists business_memberships_user_id_idx on public.business_memberships(user_id);
create index if not exists businesses_owner_user_id_idx on public.businesses(owner_user_id);
create index if not exists tasks_created_by_idx on public.tasks(created_by);
create index if not exists tasks_employee_id_idx on public.tasks(employee_id);
create index if not exists tasks_verified_by_idx on public.tasks(verified_by);
