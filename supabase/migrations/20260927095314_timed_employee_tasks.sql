-- Task-only employee access uses a manager-approved, verified email. It never
-- grants business membership or access to payroll/other employees' records.
create table public.task_employee_access (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null unique check (email = lower(trim(email)) and email like '%@%'),
  foreign key (employee_id,business_id) references public.employees(id,business_id)
);
alter table public.task_employee_access enable row level security;
revoke all on public.task_employee_access from anon;
grant select,insert,update,delete on public.task_employee_access to authenticated;
create policy task_access_managers on public.task_employee_access for all to authenticated
using (private.is_business_manager(business_id)) with check (private.is_business_manager(business_id));

create function private.is_task_employee(target_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.employees e
    where e.id = target_employee and e.active and (
      e.user_id = auth.uid() or exists (
        select 1 from public.task_employee_access a join auth.users u on u.id = auth.uid()
        where a.employee_id = e.id and lower(u.email) = a.email and u.email_confirmed_at is not null
      )
    )
  );
$$;
revoke all on function private.is_task_employee(uuid) from public,anon;
grant execute on function private.is_task_employee(uuid) to authenticated;

create function private.task_workspace() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('businessId', b.id, 'businessName', b.name, 'role','employee','userId',auth.uid())
  from public.employees e join public.businesses b on b.id = e.business_id
  where auth.uid() is not null and private.is_task_employee(e.id) order by e.created_at limit 1;
$$;
revoke all on function private.task_workspace() from public,anon;
grant execute on function private.task_workspace() to authenticated;
create function public.get_task_workspace() returns jsonb language sql security invoker set search_path = '' as $$ select private.task_workspace(); $$;
revoke all on function public.get_task_workspace() from public,anon;
grant execute on function public.get_task_workspace() to authenticated;

alter table public.tasks add column duration_minutes integer check (duration_minutes > 0 and duration_minutes <= 525600);
alter table public.tasks add column assigned_by_name text;
alter table public.tasks add column assigned_by_role text;
alter table public.tasks add column seen_at timestamptz;
alter table public.tasks add column started_at timestamptz;
alter table public.tasks add column problem_note text;
alter table public.tasks add column completed_by uuid references auth.users(id);
alter table public.tasks add constraint tasks_employee_business_fk foreign key (employee_id,business_id) references public.employees(id,business_id);
create index tasks_completed_by_idx on public.tasks(completed_by);
create index task_access_business_idx on public.task_employee_access(business_id);

drop policy "tasks: members can read" on public.tasks;
create policy tasks_visible on public.tasks for select to authenticated using (
  private.is_business_manager(business_id) or private.is_task_employee(employee_id)
);
-- Employee joins reveal only their own employee row, not colleagues' wages.
drop policy if exists "employees: members can read" on public.employees;
drop policy if exists "employees: managers and self can read" on public.employees;
create policy "employees: members can read" on public.employees for select to authenticated using (
  private.is_business_manager(business_id) or private.is_task_employee(id)
);

create function private.validate_timed_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or not private.is_business_manager(new.business_id) then raise exception 'Manager access required.'; end if;
    if new.employee_id is null or not exists (select 1 from public.employees where id=new.employee_id and business_id=new.business_id and active) then raise exception 'Choose an active employee.'; end if;
    if new.duration_minutes is null then raise exception 'Set the time allowed for this task.'; end if;
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
    new.due_at := new.created_at + make_interval(mins => new.duration_minutes);
    select coalesce(nullif(trim(p.full_name),''),'Manager') into new.assigned_by_name from public.profiles p where p.id=auth.uid();
    new.assigned_by_name := coalesce(new.assigned_by_name,'Manager');
    select role::text into new.assigned_by_role from public.business_memberships where business_id=new.business_id and user_id=auth.uid();
    new.completed_at := null; new.completed_by := null; new.started_at := null; new.seen_at := null; new.problem_note := null;
  else
    if (to_jsonb(new) - array['seen_at','started_at','completed_at','completed_by','problem_note','updated_at','verified_at','verified_by'])
      is distinct from (to_jsonb(old) - array['seen_at','started_at','completed_at','completed_by','problem_note','updated_at','verified_at','verified_by']) then
      raise exception 'Sent task details and deadlines cannot be changed.';
    end if;
    if old.completed_at is not null then raise exception 'Completed tasks cannot be changed.'; end if;
    if new.completed_at is not null then new.completed_at := clock_timestamp(); new.completed_by := auth.uid(); end if;
  end if;
  return new;
end; $$;
revoke all on function private.validate_timed_task() from public,anon,authenticated;
create trigger tasks_validate_timing before insert or update on public.tasks for each row execute function private.validate_timed_task();
create trigger tasks_audit_change after insert or update on public.tasks for each row execute function private.audit_staff_change();
-- Preserve the task history.
drop policy "tasks: managers can delete" on public.tasks;

create function private.respond_to_task(target_task uuid, response text, note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from public.tasks where id=target_task for update;
  if not found or not (private.is_business_manager(t.business_id) or private.is_task_employee(t.employee_id)) then raise exception 'Task not found.'; end if;
  if response not in ('seen','start','done','problem') or response is null then raise exception 'Invalid task response.'; end if;
  if t.completed_at is not null then return; end if;
  if response='seen' and t.seen_at is not null then return; end if;
  if response='start' and t.started_at is not null then return; end if;
  if response='problem' and (note is null or char_length(trim(note)) not between 2 and 1000) then raise exception 'Describe the problem (2–1000 characters).'; end if;
  update public.tasks set
    seen_at=coalesce(seen_at,clock_timestamp()),
    started_at=case when response='start' then coalesce(started_at,clock_timestamp()) else started_at end,
    completed_at=case when response='done' then clock_timestamp() else completed_at end,
    problem_note=case when response='problem' then trim(note) when response='start' then null else problem_note end
  where id=target_task;
end; $$;
revoke all on function private.respond_to_task(uuid,text,text) from public,anon;
grant execute on function private.respond_to_task(uuid,text,text) to authenticated;
create function public.respond_to_task(target_task uuid, response text, note text default null) returns void
language sql security invoker set search_path = '' as $$ select private.respond_to_task(target_task,response,note); $$;
revoke all on function public.respond_to_task(uuid,text,text) from public,anon;
grant execute on function public.respond_to_task(uuid,text,text) to authenticated;

-- Web Push credentials are never exposed to the browser; subscriptions are scoped
-- to the signed-in worker and rechecked against current task access on every send.
create table private.task_push_config (id boolean primary key default true check(id), public_key text not null, private_key text not null);
revoke all on private.task_push_config from public,anon,authenticated;
grant select,insert,update on private.task_push_config to service_role;
grant usage on schema private to service_role;
create function public.task_push_public_key() returns text language sql stable security definer set search_path='' as $$
 select public_key from private.task_push_config where id and auth.uid() is not null;
$$;
revoke all on function public.task_push_public_key() from public,anon;
grant execute on function public.task_push_public_key() to authenticated;
create function public.task_push_credentials() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('publicKey',public_key,'privateKey',private_key) from private.task_push_config where id;
$$;
revoke all on function public.task_push_credentials() from public,anon,authenticated;
grant execute on function public.task_push_credentials() to service_role;

create table public.task_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 employee_id uuid not null references public.employees(id) on delete cascade,
 endpoint text not null unique check (length(endpoint) <= 4096),
 p256dh text not null check (length(p256dh) between 40 and 256),
 auth text not null check (length(auth) between 16 and 128),
 created_at timestamptz not null default now()
);
alter table public.task_push_subscriptions enable row level security;
grant select,insert,update,delete on public.task_push_subscriptions to authenticated;
grant all on public.task_push_subscriptions to service_role;
revoke all on public.task_push_subscriptions from anon;
create policy task_push_own on public.task_push_subscriptions for all to authenticated
using (user_id=auth.uid()) with check (user_id=auth.uid() and private.is_task_employee(employee_id));
create index task_push_employee_idx on public.task_push_subscriptions(employee_id);
create index task_push_user_idx on public.task_push_subscriptions(user_id);

create function public.task_push_recipients(target_employee uuid) returns setof public.task_push_subscriptions
language sql stable security definer set search_path='' as $$
 select s.* from public.task_push_subscriptions s join auth.users u on u.id=s.user_id
 join public.employees e on e.id=s.employee_id
 left join public.task_employee_access a on a.employee_id=e.id
 where e.id=target_employee and e.active and
 (e.user_id=u.id or (lower(u.email)=a.email and u.email_confirmed_at is not null));
$$;
revoke all on function public.task_push_recipients(uuid) from public,anon,authenticated;
grant execute on function public.task_push_recipients(uuid) to service_role;

-- Deduplicate sends even if the caller retries the notification endpoint.
create table private.task_push_deliveries (task_id uuid primary key references public.tasks(id) on delete cascade, claimed_at timestamptz not null default now());
revoke all on private.task_push_deliveries from public,anon,authenticated;
grant select,insert,delete on private.task_push_deliveries to service_role;
create function public.claim_task_push(target_task uuid) returns boolean language sql security invoker set search_path='' as $$
 with inserted as (insert into private.task_push_deliveries(task_id) values(target_task) on conflict do nothing returning task_id) select exists(select 1 from inserted);
$$;
revoke all on function public.claim_task_push(uuid) from public,anon,authenticated;
grant execute on function public.claim_task_push(uuid) to service_role;
