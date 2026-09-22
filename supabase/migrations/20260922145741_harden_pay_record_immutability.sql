-- Final payroll rows are accounting records: managers may work on drafts, but
-- paid or cancelled rows must be immutable even through privileged API paths.
drop policy if exists "pay runs: managers can update" on public.pay_runs;
create policy "pay runs: managers can update drafts"
  on public.pay_runs for update to authenticated
  using (
    private.is_business_manager(business_id)
    and status = 'draft'
  )
  with check (private.is_business_manager(business_id));

drop policy if exists "pay runs: managers can delete" on public.pay_runs;
create policy "pay runs: managers can delete drafts"
  on public.pay_runs for delete to authenticated
  using (
    private.is_business_manager(business_id)
    and status = 'draft'
  );

create or replace function private.enforce_pay_run_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = 'Finalized pay records cannot be updated or deleted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists pay_runs_enforce_immutability on public.pay_runs;
create trigger pay_runs_enforce_immutability
  before update or delete on public.pay_runs
  for each row execute procedure private.enforce_pay_run_immutability();

revoke all on function private.enforce_pay_run_immutability() from public;
revoke all on function private.enforce_pay_run_immutability() from anon;
revoke all on function private.enforce_pay_run_immutability() from authenticated;

-- A cancelled record is also terminal. Record that transition just as the
-- existing payment trigger records the transition to paid.
create or replace function private.audit_pay_run_cancellation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'cancelled' then
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
      'cancelled',
      jsonb_build_object(
        'employee_id', new.employee_id,
        'net_pay', new.net_pay
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists pay_runs_audit_cancellation on public.pay_runs;
create trigger pay_runs_audit_cancellation
  after update of status on public.pay_runs
  for each row execute procedure private.audit_pay_run_cancellation();

revoke all on function private.audit_pay_run_cancellation() from public;
revoke all on function private.audit_pay_run_cancellation() from anon;
revoke all on function private.audit_pay_run_cancellation() from authenticated;

-- Audit events are append-only evidence. Keep reads and legitimate appends,
-- remove mutation/truncate privileges, and enforce immutability with a trigger
-- so service-role mistakes cannot bypass the RLS policy boundary.
drop policy if exists "audit: managers can read" on public.audit_events;
create policy "audit: managers can read"
  on public.audit_events for select to authenticated
  using (private.is_business_manager(business_id));

drop policy if exists "audit: managers can write" on public.audit_events;
create policy "audit: managers can append"
  on public.audit_events for insert to authenticated
  with check (
    private.is_business_manager(business_id)
    and actor_user_id = (select auth.uid())
  );

create or replace function private.prepare_audit_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Never trust caller-supplied attribution or timestamps.
  new.actor_user_id := (select auth.uid());
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists audit_events_prepare_insert on public.audit_events;
create trigger audit_events_prepare_insert
  before insert on public.audit_events
  for each row execute procedure private.prepare_audit_event();

create or replace function private.prevent_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Audit events are append-only and cannot be updated or deleted.';
end;
$$;

drop trigger if exists audit_events_prevent_mutation on public.audit_events;
create trigger audit_events_prevent_mutation
  before update or delete on public.audit_events
  for each row execute procedure private.prevent_audit_event_mutation();

revoke all on function private.prepare_audit_event() from public;
revoke all on function private.prepare_audit_event() from anon;
revoke all on function private.prepare_audit_event() from authenticated;
revoke all on function private.prevent_audit_event_mutation() from public;
revoke all on function private.prevent_audit_event_mutation() from anon;
revoke all on function private.prevent_audit_event_mutation() from authenticated;

revoke all on table public.audit_events from anon;
revoke all on table public.audit_events from authenticated;
grant select, insert on table public.audit_events to authenticated;
revoke all on table public.audit_events from service_role;
grant select, insert on table public.audit_events to service_role;

-- TRUNCATE bypasses row triggers. Neither application role needs it.
revoke truncate on table public.pay_runs from anon;
revoke truncate on table public.pay_runs from authenticated;
revoke truncate on table public.pay_runs from service_role;
