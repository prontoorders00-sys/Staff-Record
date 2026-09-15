create type public.member_role as enum ('owner', 'manager', 'employee');
create type public.wage_type as enum ('monthly_salary', 'weekly_salary', 'daily_rate', 'hourly_rate');
create type public.pay_frequency as enum ('monthly', 'weekly', 'fortnightly');
create type public.attendance_status as enum ('present', 'absent', 'sick', 'leave', 'pending_review');
create type public.advance_status as enum ('open', 'partially_repaid', 'repaid', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  owner_user_id uuid not null references auth.users(id),
  timezone text not null default 'Africa/Johannesburg',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text,
  job_title text,
  responsibilities text,
  start_date date not null default current_date,
  end_date date,
  wage_type public.wage_type not null,
  pay_frequency public.pay_frequency not null,
  wage_rate numeric(12,2) not null check (wage_rate >= 0),
  wage_rate_effective_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  status public.attendance_status not null default 'present',
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  note text,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date),
  check (clock_out_at is null or clock_in_at is null or clock_out_at >= clock_in_at)
);

create table public.advances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  repaid_amount numeric(12,2) not null default 0 check (repaid_amount >= 0 and repaid_amount <= amount),
  status public.advance_status not null default 'open',
  issued_on date not null default current_date,
  recovery_note text,
  acknowledged_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 160),
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index employees_business_id_idx on public.employees(business_id);
create index attendance_business_work_date_idx on public.attendance_entries(business_id, work_date desc);
create index advances_business_employee_idx on public.advances(business_id, employee_id);
create index tasks_business_employee_idx on public.tasks(business_id, employee_id);
create index audit_events_business_created_idx on public.audit_events(business_id, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger businesses_updated_at before update on public.businesses for each row execute procedure public.set_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute procedure public.set_updated_at();
create trigger attendance_entries_updated_at before update on public.attendance_entries for each row execute procedure public.set_updated_at();
create trigger advances_updated_at before update on public.advances for each row execute procedure public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute procedure public.set_updated_at();

create or replace function public.is_business_member(target_business_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.business_memberships where business_id = target_business_id and user_id = auth.uid()); $$;
create or replace function public.is_business_manager(target_business_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.business_memberships where business_id = target_business_id and user_id = auth.uid() and role in ('owner', 'manager')); $$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_entries enable row level security;
alter table public.advances enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles: own record" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "businesses: members can read" on public.businesses for select using (public.is_business_member(id));
create policy "businesses: authenticated users can create" on public.businesses for insert to authenticated with check (owner_user_id = auth.uid());
create policy "businesses: owners can update" on public.businesses for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "memberships: members can read" on public.business_memberships for select using (public.is_business_member(business_id));
create policy "memberships: owner can add or self can add" on public.business_memberships for insert to authenticated with check (user_id = auth.uid() or public.is_business_manager(business_id));
create policy "memberships: owner can update" on public.business_memberships for update using (public.is_business_manager(business_id)) with check (public.is_business_manager(business_id));
create policy "employees: members can read" on public.employees for select using (public.is_business_member(business_id));
create policy "employees: managers can manage" on public.employees for all using (public.is_business_manager(business_id)) with check (public.is_business_manager(business_id));
create policy "attendance: members can read" on public.attendance_entries for select using (public.is_business_member(business_id));
create policy "attendance: managers can manage" on public.attendance_entries for all using (public.is_business_manager(business_id)) with check (public.is_business_manager(business_id));
create policy "advances: managers can read" on public.advances for select using (public.is_business_manager(business_id));
create policy "advances: managers can manage" on public.advances for all using (public.is_business_manager(business_id)) with check (public.is_business_manager(business_id));
create policy "tasks: members can read" on public.tasks for select using (public.is_business_member(business_id));
create policy "tasks: managers can manage" on public.tasks for all using (public.is_business_manager(business_id)) with check (public.is_business_manager(business_id));
create policy "audit: managers can read" on public.audit_events for select using (public.is_business_manager(business_id));
create policy "audit: managers can write" on public.audit_events for insert with check (public.is_business_manager(business_id));
