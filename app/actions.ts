"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

function textValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function moneyValue(formData: FormData, key: string) {
  const raw = textValue(formData, key);
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 99999999.99) {
    throw new Error("Enter valid money amounts.");
  }
  return Math.round(value * 100) / 100;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function createBusiness(formData: FormData) {
  const name = textValue(formData, "businessName");
  const fullName = textValue(formData, "ownerName");
  if (name.length < 2 || fullName.length < 2) throw new Error("Please enter valid names.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase.from("business_memberships").select("business_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (existing) redirect("/dashboard");

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({ name, owner_user_id: user.id, timezone: "Africa/Johannesburg" })
    .select("id")
    .single();
  if (businessError) throw new Error(businessError.message);

  const { error: membershipError } = await supabase.from("business_memberships").insert({ business_id: business.id, user_id: user.id, role: "owner" });
  if (membershipError) throw new Error(membershipError.message);

  await supabase.from("profiles").upsert({ id: user.id, full_name: fullName });
  redirect("/dashboard");
}

export async function addEmployee(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to add employees.");
  const fullName = textValue(formData, "fullName");
  const wageRate = Number(textValue(formData, "wageRate"));
  if (fullName.length < 2 || !Number.isFinite(wageRate) || wageRate < 0) throw new Error("Enter a valid name and wage.");
  const supabase = await createClient();
  const { error } = await supabase.from("employees").insert({
    business_id: workspace.businessId,
    full_name: fullName,
    phone: textValue(formData, "phone") || null,
    job_title: textValue(formData, "jobTitle") || null,
    responsibilities: textValue(formData, "responsibilities") || null,
    wage_type: textValue(formData, "wageType"),
    pay_frequency: textValue(formData, "payFrequency"),
    wage_rate: wageRate,
    start_date: textValue(formData, "startDate"),
  });
  if (error) throw new Error(error.message);
  await logEvent("employee", null, "created", { full_name: fullName });
  revalidatePath("/employees");
  revalidatePath("/dashboard");
}

export async function recordAttendance(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to record attendance.");
  const employeeId = textValue(formData, "employeeId");
  const workDate = textValue(formData, "workDate");
  const status = textValue(formData, "status");
  const clockIn = textValue(formData, "clockIn");
  const clockOut = textValue(formData, "clockOut");
  const supabase = await createClient();
  const { data: employee } = await supabase.from("employees").select("id").eq("id", employeeId).eq("business_id", workspace.businessId).maybeSingle();
  if (!employee) throw new Error("Employee not found.");
  const payload = {
    business_id: workspace.businessId,
    employee_id: employeeId,
    work_date: workDate,
    status,
    clock_in_at: clockIn ? `${workDate}T${clockIn}:00+02:00` : null,
    clock_out_at: clockOut ? `${workDate}T${clockOut}:00+02:00` : null,
    break_minutes: Number(textValue(formData, "breakMinutes") || 0),
    note: textValue(formData, "note") || null,
    created_by: workspace.userId,
  };
  const { error } = await supabase.from("attendance_entries").upsert(payload, { onConflict: "employee_id,work_date" });
  if (error) throw new Error(error.message);
  await logEvent("attendance", employeeId, "recorded", { work_date: workDate, status });
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

export async function addAdvance(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to record advances.");
  const employeeId = textValue(formData, "employeeId");
  const amount = Number(textValue(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount.");
  const supabase = await createClient();
  const { data: employee } = await supabase.from("employees").select("id").eq("id", employeeId).eq("business_id", workspace.businessId).maybeSingle();
  if (!employee) throw new Error("Employee not found.");
  const { error } = await supabase.from("advances").insert({
    business_id: workspace.businessId,
    employee_id: employeeId,
    amount,
    issued_on: textValue(formData, "issuedOn"),
    recovery_note: textValue(formData, "recoveryNote") || null,
    created_by: workspace.userId,
  });
  if (error) throw new Error(error.message);
  await logEvent("advance", employeeId, "created", { amount });
  revalidatePath("/advances");
  revalidatePath("/dashboard");
}

export async function createPayRun(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to prepare pay records.");

  const employeeId = textValue(formData, "employeeId");
  const periodStart = textValue(formData, "periodStart");
  const periodEnd = textValue(formData, "periodEnd");
  const payDate = textValue(formData, "payDate");
  const grossOverrideRaw = textValue(formData, "grossOverride");
  const extraPay = moneyValue(formData, "extraPay");
  const deductionAmount = moneyValue(formData, "deductionAmount");
  const advanceRepayment = moneyValue(formData, "advanceRepayment");
  const deductionReason = textValue(formData, "deductionReason");
  const paymentMethod = textValue(formData, "paymentMethod");
  const note = textValue(formData, "note");

  if (!employeeId || !validDate(periodStart) || !validDate(periodEnd) || !validDate(payDate)) {
    throw new Error("Choose an employee and valid pay-period dates.");
  }
  const periodDays = Math.round((Date.parse(`${periodEnd}T12:00:00Z`) - Date.parse(`${periodStart}T12:00:00Z`)) / 86400000);
  if (periodDays < 0 || periodDays > 92) throw new Error("The pay period must be between 1 and 93 days.");
  if (deductionAmount > 0 && deductionReason.length < 2) throw new Error("Add a reason for the deduction.");
  if (paymentMethod && (paymentMethod.length < 2 || paymentMethod.length > 80)) throw new Error("Enter a valid payment method.");
  if (note.length > 1000) throw new Error("Keep the pay note under 1,000 characters.");

  const supabase = await createClient();
  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id,wage_type,wage_rate")
    .eq("id", employeeId)
    .eq("business_id", workspace.businessId)
    .eq("active", true)
    .maybeSingle();
  if (employeeError) throw new Error(employeeError.message);
  if (!employee) throw new Error("Active employee not found.");

  const [attendanceResult, advancesResult] = await Promise.all([
    supabase
      .from("attendance_entries")
      .select("status,clock_in_at,clock_out_at,break_minutes,overtime_minutes")
      .eq("business_id", workspace.businessId)
      .eq("employee_id", employeeId)
      .gte("work_date", periodStart)
      .lte("work_date", periodEnd),
    supabase
      .from("advances")
      .select("amount,repaid_amount")
      .eq("business_id", workspace.businessId)
      .eq("employee_id", employeeId)
      .in("status", ["open", "partially_repaid"]),
  ]);
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (advancesResult.error) throw new Error(advancesResult.error.message);

  const attendance = attendanceResult.data ?? [];
  const workedDays = attendance.filter((entry) => entry.status === "present").length;
  const workedMinutes = attendance.reduce((total, entry) => {
    if (entry.status !== "present" || !entry.clock_in_at || !entry.clock_out_at) return total;
    const elapsed = Math.max(0, Math.round((Date.parse(entry.clock_out_at) - Date.parse(entry.clock_in_at)) / 60000));
    return total + Math.max(0, elapsed - Number(entry.break_minutes ?? 0) + Number(entry.overtime_minutes ?? 0));
  }, 0);
  const wageRate = Number(employee.wage_rate);
  let grossPay = employee.wage_type === "daily_rate"
    ? wageRate * workedDays
    : employee.wage_type === "hourly_rate"
      ? wageRate * workedMinutes / 60
      : wageRate;

  if (grossOverrideRaw) {
    grossPay = moneyValue(formData, "grossOverride");
  }
  grossPay = Math.round(grossPay * 100) / 100;

  const outstandingAdvance = (advancesResult.data ?? []).reduce(
    (total, advance) => total + Number(advance.amount) - Number(advance.repaid_amount),
    0,
  );
  if (advanceRepayment > outstandingAdvance + 0.005) {
    throw new Error("Advance recovery is higher than the employee's outstanding balance.");
  }
  if (deductionAmount + advanceRepayment > grossPay + extraPay) {
    throw new Error("Deductions cannot be more than the employee's pay.");
  }

  const { data: payRun, error } = await supabase
    .from("pay_runs")
    .insert({
      business_id: workspace.businessId,
      employee_id: employeeId,
      period_start: periodStart,
      period_end: periodEnd,
      pay_date: payDate,
      wage_type: employee.wage_type,
      wage_rate: wageRate,
      worked_days: workedDays,
      worked_minutes: workedMinutes,
      gross_pay: grossPay,
      extra_pay: extraPay,
      deduction_amount: deductionAmount,
      deduction_reason: deductionAmount ? deductionReason : null,
      advance_repayment: advanceRepayment,
      payment_method: paymentMethod || null,
      note: note || null,
      created_by: workspace.userId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") throw new Error("A pay record already exists for this employee and period.");
  if (error) throw new Error(error.message);

  await logEvent("pay_run", payRun.id, "created", { employee_id: employeeId, period_start: periodStart, period_end: periodEnd, gross_pay: grossPay });
  revalidatePath("/payroll");
  revalidatePath("/dashboard");
}

export async function markPayRunPaid(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to mark payroll as paid.");
  const payRunId = textValue(formData, "payRunId");
  if (!payRunId) throw new Error("Pay record not found.");

  const supabase = await createClient();
  const { data: payRun } = await supabase
    .from("pay_runs")
    .select("id")
    .eq("id", payRunId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (!payRun) throw new Error("Pay record not found.");

  const { data: paidRun, error } = await supabase
    .from("pay_runs")
    .update({ status: "paid" })
    .eq("id", payRun.id)
    .eq("business_id", workspace.businessId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!paidRun) throw new Error("Only a draft pay record can be marked paid.");
  revalidatePath("/payroll");
  revalidatePath(`/payroll/${payRun.id}`);
  revalidatePath("/advances");
  revalidatePath("/dashboard");
}

export async function addTask(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to assign tasks.");
  const title = textValue(formData, "title");
  if (title.length < 2) throw new Error("Enter a task title.");
  const employeeId = textValue(formData, "employeeId") || null;
  const supabase = await createClient();
  if (employeeId) {
    const { data: employee } = await supabase.from("employees").select("id").eq("id", employeeId).eq("business_id", workspace.businessId).maybeSingle();
    if (!employee) throw new Error("Employee not found.");
  }
  const due = textValue(formData, "dueAt");
  const { error } = await supabase.from("tasks").insert({
    business_id: workspace.businessId,
    employee_id: employeeId,
    title,
    description: textValue(formData, "description") || null,
    due_at: due ? new Date(due).toISOString() : null,
    created_by: workspace.userId,
  });
  if (error) throw new Error(error.message);
  await logEvent("task", employeeId, "created", { title });
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function completeTask(formData: FormData) {
  const workspace = await getWorkspace();
  const taskId = textValue(formData, "taskId");
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", taskId).eq("business_id", workspace.businessId);
  if (error) throw new Error(error.message);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

async function logEvent(entityType: string, entityId: string | null, action: string, details: Record<string, unknown>) {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  await supabase.from("audit_events").insert({ business_id: workspace.businessId, actor_user_id: workspace.userId, entity_type: entityType, entity_id: entityId, action, details });
}
