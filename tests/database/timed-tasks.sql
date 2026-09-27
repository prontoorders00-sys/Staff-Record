-- All synthetic people and records roll back. No external notifications are sent.
begin;
create temporary table task_test_results(name text, passed boolean) on commit drop;
grant all on task_test_results to authenticated;
select set_config('test.owner',gen_random_uuid()::text,true);
select set_config('test.worker',gen_random_uuid()::text,true);
select set_config('test.other',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
(current_setting('test.owner')::uuid,'task-owner-'||current_setting('test.owner')||'@example.invalid',now()),
(current_setting('test.worker')::uuid,'task-worker-'||current_setting('test.worker')||'@example.invalid',now()),
(current_setting('test.other')::uuid,'task-other-'||current_setting('test.other')||'@example.invalid',now());
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare b uuid; e uuid; other_employee uuid; t uuid; other_task uuid; blocked boolean; d integer; completed timestamptz;
begin
 insert into public.businesses(name,owner_user_id) values('Timed task rollback test',auth.uid()) returning id into b;
 insert into public.profiles(id,full_name) values(auth.uid(),'QA Manager');
 insert into public.employees(business_id,full_name,wage_type,pay_frequency,wage_rate) values(b,'QA worker','hourly_rate','weekly',30) returning id into e;
 insert into public.employees(business_id,full_name,wage_type,pay_frequency,wage_rate) values(b,'Other worker','hourly_rate','weekly',30) returning id into other_employee;
 insert into public.task_employee_access(employee_id,business_id,email) values(e,b,'task-worker-'||current_setting('test.worker')||'@example.invalid');
 insert into public.tasks(business_id,employee_id,title,duration_minutes,created_by,due_at) values(b,e,'Seven minute task',7,auth.uid(),now()+interval '20 minutes') returning id into t;
 select extract(epoch from (due_at-created_at))/60 into d from public.tasks where id=t;
 if d<>7 or not exists(select 1 from public.tasks where id=t and assigned_by_name='QA Manager' and assigned_by_role='owner') then raise exception 'FAIL deadline or sender'; end if;
 insert into public.tasks(business_id,employee_id,title,duration_minutes,created_by) values(b,other_employee,'Other task',35,auth.uid()) returning id into other_task;
 blocked:=false;
 begin insert into public.tasks(business_id,employee_id,title,duration_minutes,created_by) values(b,e,'Zero task',0,auth.uid()); exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL invalid duration'; end if;
 insert into task_test_results values('Manager duration and sender enforced by database',true);
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.worker'),'role','authenticated')::text,true);
 if (public.get_task_workspace()->>'businessId')::uuid is distinct from b then raise exception 'FAIL task workspace'; end if;
 if not exists(select 1 from public.tasks where id=t) or exists(select 1 from public.tasks where id=other_task) then raise exception 'FAIL task isolation'; end if;
 if exists(select 1 from public.employees where id=other_employee) or exists(select 1 from public.pay_runs where business_id=b) then raise exception 'FAIL private records'; end if;
 blocked:=false;
 begin perform public.respond_to_task(other_task,'done'); exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'FAIL completing another worker task'; end if;
 perform public.respond_to_task(t,'seen');
 perform public.respond_to_task(t,'start');
 perform public.respond_to_task(t,'problem','Waiting for stock');
 if not exists(select 1 from public.tasks where id=t and started_at is not null and seen_at is not null and problem_note='Waiting for stock') then raise exception 'FAIL task response'; end if;
 perform public.respond_to_task(t,'done');
 select completed_at into completed from public.tasks where id=t;
 if completed is null or not exists(select 1 from public.tasks where id=t and completed_by=auth.uid()) then raise exception 'FAIL completion'; end if;
 perform public.respond_to_task(t,'done');
 if not exists(select 1 from public.tasks where id=t and completed_at=completed) then raise exception 'FAIL idempotent completion'; end if;
 blocked:=false;
 begin perform public.task_push_credentials(); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL push credentials privacy'; end if;
 insert into task_test_results values('Worker sees only own tasks, reports problems and completes once',true),('Push secrets inaccessible to employees',true);
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
 if (select count(*) from public.audit_events where entity_id=t and entity_type='tasks')<>5 then raise exception 'FAIL task audit'; end if;
 blocked:=false;
 begin update public.tasks set completed_at=null where id=t; exception when raise_exception then blocked:=true; end;
 if not blocked then raise exception 'FAIL completion protection'; end if;
 delete from public.tasks where id=t;
 if not exists(select 1 from public.tasks where id=t) then raise exception 'FAIL history deletion'; end if;
 delete from public.task_employee_access where employee_id=e;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.worker'),'role','authenticated')::text,true);
 if exists(select 1 from public.tasks where id=t) or public.get_task_workspace() is not null then raise exception 'FAIL revoked access'; end if;
 insert into task_test_results values('History is audited and protected; revoked access takes effect immediately',true);
end $$;
select * from task_test_results;
rollback;
