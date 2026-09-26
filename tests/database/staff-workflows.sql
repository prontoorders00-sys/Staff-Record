-- Integration regression: run against a migrated database. Everything rolls back.
begin;
create temporary table test_results (name text, passed boolean) on commit drop;
grant all on test_results to authenticated;
select set_config('test.owner', gen_random_uuid()::text, true);
select set_config('test.outsider', gen_random_uuid()::text, true);
insert into auth.users(id) values (current_setting('test.owner')::uuid), (current_setting('test.outsider')::uuid);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare b uuid; e uuid; p uuid; a uuid; blocked boolean; n numeric; event_count integer;
begin
  insert into public.businesses(name,owner_user_id) values ('QA rollback business',auth.uid()) returning id into b;
  insert into public.employees(business_id,full_name,start_date,wage_type,pay_frequency,wage_rate)
    values(b,'QA rollback employee','2026-09-01','hourly_rate','weekly',30) returning id into e;
  insert into test_results values ('owner onboarding and employee create',true);
  blocked := false;
  begin
    update public.employees set wage_type='monthly_salary',pay_frequency='weekly' where id=e;
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'FAIL invalid wage frequency'; end if;
  insert into test_results values ('database rejects incompatible wage frequency',true);
  insert into public.attendance_entries(business_id,employee_id,work_date,status,clock_in_at,clock_out_at,break_minutes,overtime_minutes,created_by)
    values(b,e,'2026-09-21','present','2026-09-21T08:00:00+02:00','2026-09-21T18:00:00+02:00',60,120,auth.uid());
  insert into public.attendance_entries(business_id,employee_id,work_date,status,sick_minutes,created_by)
    values(b,e,'2026-09-22','sick',480,auth.uid());
  update public.attendance_entries set note='Historical correction' where employee_id=e and work_date='2026-09-21';
  insert into test_results values ('historical attendance, overtime and sick hours save',true);
  blocked := false;
  begin update public.attendance_entries set overtime_minutes=541 where employee_id=e and work_date='2026-09-21';
  exception when raise_exception then blocked := true; end;
  if not blocked then raise exception 'FAIL overtime exceeds hours'; end if;
  insert into test_results values ('database rejects excessive overtime',true);
  insert into public.advances(business_id,employee_id,amount,created_by) values(b,e,100,auth.uid()) returning id into a;
  insert into public.pay_runs(business_id,employee_id,period_start,period_end,wage_type,wage_rate,pay_frequency,worked_days,worked_minutes,overtime_minutes,sick_minutes,gross_pay,advance_repayment,created_by)
    values(b,e,'2026-09-21','2026-09-27','hourly_rate',30,'weekly',1,540,120,480,270,50,auth.uid()) returning id into p;
  blocked := false;
  begin update public.attendance_entries set break_minutes=0 where employee_id=e and work_date='2026-09-21';
  exception when raise_exception then blocked := true; end;
  if not blocked then raise exception 'FAIL draft attendance lock'; end if;
  blocked := false;
  begin update public.employees set wage_rate=40 where id=e;
  exception when raise_exception then blocked := true; end;
  if not blocked then raise exception 'FAIL draft wage lock'; end if;
  insert into test_results values ('draft locks attendance and wage changes',true);
  update public.pay_runs set status='cancelled' where id=p;
  update public.attendance_entries set note='Corrected after cancellation' where employee_id=e and work_date='2026-09-21';
  select repaid_amount into n from public.advances where id=a;
  if n <> 0 then raise exception 'FAIL cancellation repaid advance'; end if;
  insert into test_results values ('cancel draft unlocks attendance without recovering advance',true);
  insert into public.pay_runs(business_id,employee_id,period_start,period_end,wage_type,wage_rate,pay_frequency,worked_days,worked_minutes,overtime_minutes,sick_minutes,gross_pay,advance_repayment,created_by)
    values(b,e,'2026-09-21','2026-09-27','hourly_rate',30,'weekly',1,540,120,480,270,50,auth.uid()) returning id into p;
  update public.pay_runs set status='paid' where id=p;
  select repaid_amount into n from public.advances where id=a;
  if n <> 50 then raise exception 'FAIL advance recovery'; end if;
  select (details->>'net_pay')::numeric into n from public.audit_events where entity_id=p and action='paid';
  if n is distinct from 220::numeric then raise exception 'FAIL payment audit net pay: %', n; end if;
  insert into test_results values ('payment recovers advance exactly once and audits correct net pay',true);
  update public.pay_runs set status='paid' where id=p;
  select repaid_amount into n from public.advances where id=a;
  if n <> 50 then raise exception 'FAIL repeated payment'; end if;
  select count(*) into event_count from public.audit_events where entity_id=p and action='paid';
  if event_count <> 1 then raise exception 'FAIL duplicate audit'; end if;
  delete from public.pay_runs where id=p;
  if not exists(select 1 from public.pay_runs where id=p and status='paid') then raise exception 'FAIL paid deletion'; end if;
  insert into test_results values ('paid rows cannot be edited or deleted through manager role',true);
  blocked := false;
  begin update public.attendance_entries set note='Change paid period' where employee_id=e and work_date='2026-09-21';
  exception when raise_exception then blocked := true; end;
  if not blocked then raise exception 'FAIL paid attendance lock'; end if;
  insert into test_results values ('paid attendance cannot be changed',true);
  update public.employees set full_name='QA renamed employee' where id=e;
  if not exists(select 1 from public.pay_runs where id=p and employee_name='QA rollback employee') then raise exception 'FAIL name snapshot'; end if;
  update public.employees set active=false,end_date='2026-09-23' where id=e;
  if not exists(select 1 from public.attendance_entries where employee_id=e) then raise exception 'FAIL former employee history'; end if;
  update public.employees set active=true,end_date=null where id=e;
  insert into test_results values ('employee edit, deactivate/reactivate preserve history and pay snapshot',true);
  blocked := false;
  begin update public.audit_events set action='tampered' where business_id=b;
  exception when insufficient_privilege or raise_exception then blocked := true; end;
  if not blocked then raise exception 'FAIL audit mutation'; end if;
  insert into test_results values ('audit trail rejects edits',true);
  perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.outsider'),'role','authenticated')::text,true);
  if exists(select 1 from public.employees where id=e) or exists(select 1 from public.pay_runs where id=p) then raise exception 'FAIL cross-business isolation'; end if;
  update public.employees set full_name='Outsider write' where id=e;
  perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
  if exists(select 1 from public.employees where id=e and full_name='Outsider write') then raise exception 'FAIL outsider update'; end if;
  insert into test_results values ('unrelated account cannot read or update business records',true);
end;
$$;
select * from test_results;
rollback;
