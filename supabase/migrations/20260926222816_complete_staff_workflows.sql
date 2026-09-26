-- Add recorded hours and immutable display snapshots without rewriting paid rows.
alter table public.attendance_entries add column sick_minutes integer not null default 0 check (sick_minutes between 0 and 1440);
alter table public.pay_runs add column overtime_minutes integer not null default 0 check (overtime_minutes between 0 and worked_minutes);
alter table public.pay_runs add column sick_minutes integer not null default 0 check (sick_minutes >= 0);
alter table public.pay_runs add column employee_name text;
alter table public.pay_runs add column employee_job_title text;
alter table public.pay_runs add column business_name text;

alter table public.employees add constraint employees_wage_frequency_check check (
  (wage_type = 'monthly_salary' and pay_frequency = 'monthly')
  or (wage_type = 'weekly_salary' and pay_frequency in ('weekly', 'fortnightly'))
  or wage_type in ('hourly_rate', 'daily_rate')
);
alter table public.attendance_entries add constraint attendance_employee_business_fk
  foreign key (employee_id, business_id) references public.employees(id, business_id);

-- Serialize attendance/pay preparation for each employee so edits and drafts
-- cannot race past each other's checks.
create or replace function private.validate_attendance_entry()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  target_id uuid;
  target_business uuid;
  target_date date;
  employee_record record;
  elapsed numeric;
begin
  if tg_op = 'DELETE' then
    target_id := old.employee_id; target_business := old.business_id; target_date := old.work_date;
  else
    target_id := new.employee_id; target_business := new.business_id; target_date := new.work_date;
    if tg_op = 'UPDATE' and (new.employee_id <> old.employee_id or new.business_id <> old.business_id or new.work_date <> old.work_date) then
      raise exception 'Attendance identity cannot be changed.';
    end if;
  end if;
  select start_date, end_date into employee_record from public.employees
    where id = target_id and business_id = target_business for update;
  if not found then raise exception 'Employee not found in this business.'; end if;
  if exists (select 1 from public.pay_runs where employee_id = target_id and business_id = target_business
    and status <> 'cancelled' and target_date between period_start and period_end) then
    raise exception 'Attendance is locked by a pay record. Cancel a draft before correcting attendance; paid periods cannot be changed.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if target_date > (now() at time zone 'Africa/Johannesburg')::date
    or target_date < employee_record.start_date
    or (employee_record.end_date is not null and target_date > employee_record.end_date) then
    raise exception 'Attendance date must be within employment dates and no later than today.';
  end if;
  if new.break_minutes not between 0 and 1440 or new.overtime_minutes not between 0 and 1440 then
    raise exception 'Breaks and overtime must be between 0 and 1440 minutes.';
  end if;
  if new.clock_out_at is not null and new.clock_in_at is null then raise exception 'Clock-in is required before clock-out.'; end if;
  if new.status <> 'present' and (new.clock_in_at is not null or new.clock_out_at is not null or new.break_minutes <> 0 or new.overtime_minutes <> 0) then
    raise exception 'Only present entries can have clock times, breaks or overtime.';
  end if;
  if new.sick_minutes > 0 and new.status not in ('present', 'sick') then raise exception 'Sick hours require Present or Sick status.'; end if;
  if new.clock_out_at is null and (new.break_minutes > 0 or new.overtime_minutes > 0) then raise exception 'Complete clock times before recording breaks or overtime.'; end if;
  if new.clock_in_at is not null and (new.clock_in_at at time zone 'Africa/Johannesburg')::date <> new.work_date then
    raise exception 'Clock-in must be on the attendance date.';
  end if;
  if new.clock_out_at is not null then
    if (new.clock_out_at at time zone 'Africa/Johannesburg')::date <> new.work_date then raise exception 'Split overnight shifts into separate dates.'; end if;
    elapsed := extract(epoch from (new.clock_out_at - new.clock_in_at)) / 60;
    if elapsed < 0 or new.break_minutes > elapsed or new.overtime_minutes > elapsed - new.break_minutes
      or elapsed - new.break_minutes + new.sick_minutes > 1440 then
      raise exception 'Check shift length, breaks, overtime and sick hours.';
    end if;
  end if;
  return new;
end;
$$;
create trigger attendance_validate_entry before insert or update or delete on public.attendance_entries
  for each row execute function private.validate_attendance_entry();
revoke all on function private.validate_attendance_entry() from public, anon, authenticated;

create or replace function private.protect_employee_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.business_id <> old.business_id or new.user_id is distinct from old.user_id then
    raise exception 'Employee identity cannot be changed through employee editing.';
  end if;
  if (new.wage_type, new.wage_rate, new.pay_frequency, new.active) is distinct from (old.wage_type, old.wage_rate, old.pay_frequency, old.active)
    and exists (select 1 from public.pay_runs where employee_id = old.id and status = 'draft') then
    raise exception 'Cancel or finish existing draft pay records before changing wages or active status.';
  end if;
  if exists (select 1 from public.attendance_entries where employee_id = old.id
    and (work_date < new.start_date or (new.end_date is not null and work_date > new.end_date))) then
    raise exception 'Employment dates cannot exclude existing attendance.';
  end if;
  return new;
end;
$$;
create trigger employees_protect_history before update on public.employees for each row execute function private.protect_employee_history();
revoke all on function private.protect_employee_history() from public, anon, authenticated;

create or replace function private.prepare_pay_run()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare employee_record record; inclusive_days integer;
begin
  select wage_type, wage_rate, pay_frequency, full_name, job_title into employee_record
  from public.employees where id = new.employee_id and business_id = new.business_id and active for update;
  if not found then raise exception 'An active employee in this business is required.'; end if;
  if (new.wage_type, new.wage_rate, new.pay_frequency) is distinct from (employee_record.wage_type, employee_record.wage_rate, employee_record.pay_frequency) then
    raise exception 'Wage details changed while preparing pay. Refresh and prepare again.';
  end if;
  new.wage_type := employee_record.wage_type;
  new.wage_rate := employee_record.wage_rate;
  new.pay_frequency := employee_record.pay_frequency;
  new.employee_name := employee_record.full_name;
  new.employee_job_title := coalesce(employee_record.job_title, 'Employee');
  select name into new.business_name from public.businesses where id = new.business_id;
  inclusive_days := new.period_end - new.period_start + 1;
  if new.pay_frequency = 'weekly' and inclusive_days <> 7 then raise exception 'Weekly payroll periods must contain exactly 7 days.';
  elsif new.pay_frequency = 'fortnightly' and inclusive_days <> 14 then raise exception 'Fortnightly payroll periods must contain exactly 14 days.';
  elsif new.pay_frequency = 'monthly' and (new.period_start <> date_trunc('month', new.period_start)::date
    or new.period_end <> (date_trunc('month', new.period_start) + interval '1 month - 1 day')::date) then
    raise exception 'Monthly payroll periods must cover one complete calendar month.';
  end if;
  -- Detect an attendance change between server calculation and insertion.
  if exists (select 1 from public.attendance_entries where employee_id = new.employee_id
    and work_date between new.period_start and new.period_end
    and (status = 'pending_review' or (new.wage_type = 'hourly_rate' and status = 'present' and (clock_in_at is null or clock_out_at is null)))) then
    raise exception 'Complete attendance before preparing pay.';
  end if;
  if new.worked_days <> (select count(*) from public.attendance_entries where employee_id = new.employee_id and status = 'present' and work_date between new.period_start and new.period_end)
    or new.worked_minutes <> (select coalesce(sum(greatest(0, round(extract(epoch from (clock_out_at-clock_in_at))/60) - break_minutes)),0) from public.attendance_entries where employee_id = new.employee_id and status = 'present' and clock_in_at is not null and clock_out_at is not null and work_date between new.period_start and new.period_end)
    or new.overtime_minutes <> (select coalesce(sum(overtime_minutes),0) from public.attendance_entries where employee_id = new.employee_id and status = 'present' and work_date between new.period_start and new.period_end)
    or new.sick_minutes <> (select coalesce(sum(sick_minutes),0) from public.attendance_entries where employee_id = new.employee_id and work_date between new.period_start and new.period_end) then
    raise exception 'Attendance changed while preparing pay. Refresh and prepare the record again.';
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_pay_run() from public, anon, authenticated;

-- Employee and attendance updates are recorded atomically with the mutation.
create or replace function private.audit_staff_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.audit_events (business_id, actor_user_id, entity_type, entity_id, action, details)
  values (new.business_id, (select auth.uid()), tg_table_name, new.id, lower(tg_op),
    jsonb_build_object('before', case when tg_op = 'UPDATE' then to_jsonb(old) else null end, 'after', to_jsonb(new)));
  return new;
end;
$$;
create trigger employees_audit_change after insert or update on public.employees for each row execute function private.audit_staff_change();
create trigger attendance_audit_change after insert or update on public.attendance_entries for each row execute function private.audit_staff_change();
revoke all on function private.audit_staff_change() from public, anon, authenticated;

-- BEFORE triggers cannot read the generated net_pay value from NEW.
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
      'net_pay', new.gross_pay + new.extra_pay - new.deduction_amount - new.advance_repayment,
      'advance_repayment', new.advance_repayment
    )
  );

  return new;
end;
$$;

