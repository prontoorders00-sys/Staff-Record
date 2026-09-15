-- Covers the composite employee/business foreign key used by pay records.
create index pay_runs_employee_business_idx
  on public.pay_runs(employee_id, business_id);
