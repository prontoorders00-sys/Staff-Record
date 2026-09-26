"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { today } from "@/lib/format";
import { validDate, validateWage, validateAttendance, calculatePay } from "@/lib/pay-rules";

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

  await supabase.from("profiles").upsert({ id: user.id, full_name: fullName });
  redirect("/dashboard");
}

export async function addEmployee(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("You do not have permission to add employees.");
  const fullName = textValue(formData, "fullName");
  const wageRate = moneyValue(formData, "wageRate");
  validateWage(textValue(formData, "wageType"), textValue(formData, "payFrequency"));
  if (!textValue(formData, "wageRate") || !validDate(textValue(formData, "startDate"))) throw new Error("Enter a wage and valid start date.");
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
  if (!validDate(workDate) || workDate > today()) throw new Error("Choose today or an earlier attendance date.");
  const breakMinutes = Number(textValue(formData, "breakMinutes") || 0);
  const overtimeMinutes = Number(textValue(formData, "overtimeMinutes") || 0);
  const sickHours = Number(textValue(formData, "sickHours") || 0);
  if (!Number.isFinite(sickHours) || sickHours < 0 || sickHours > 24) throw new Error("Sick hours must be between 0 and 24.");
  const sickMinutes = Math.round(sickHours * 60);
  validateAttendance({ status, clockIn, clockOut, breakMinutes, overtimeMinutes, sickMinutes });
  const supabase = await createClient();
  const { data: employee } = await supabase.from("employees").select("id,start_date,end_date").eq("id", employeeId).eq("business_id", workspace.businessId).maybeSingle();
  if (!employee) throw new Error("Employee not found.");
  if (workDate < employee.start_date || (employee.end_date && workDate > employee.end_date)) throw new Error("Choose a date within the employee's employment dates.");
  const payload = {
    business_id: workspace.businessId,
    employee_id: employeeId,
    work_date: workDate,
    status,
    clock_in_at: clockIn ? `${workDate}T${clockIn}:00+02:00` : null,
    clock_out_at: clockOut ? `${workDate}T${clockOut}:00+02:00` : null,
    break_minutes: breakMinutes,
    overtime_minutes: overtimeMinutes,
    sick_minutes: sickMinutes,
    note: textValue(formData, "note") || null,
    created_by: workspace.userId,
  };
  const { error } = await supabase.from("attendance_entries").upsert(payload, { onConflict: "employee_id,work_date" });
  if (error) throw new Error(error.message);
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
    .select("id,wage_type,wage_rate,pay_frequency")
    .eq("id", employeeId)
    .eq("business_id", workspace.businessId)
    .eq("active", true)
    .maybeSingle();
  if (employeeError) throw new Error(employeeError.message);
  if (!employee) throw new Error("Active employee not found.");

  const inclusivePeriodDays = periodDays + 1;
  if (employee.pay_frequency === "weekly" && inclusivePeriodDays !== 7) {
    throw new Error("This employee is paid weekly. Choose an exact 7-day period.");
  }
  if (employee.pay_frequency === "fortnightly" && inclusivePeriodDays !== 14) {
    throw new Error("This employee is paid fortnightly. Choose an exact 14-day period.");
  }
  if (employee.pay_frequency === "monthly") {
    const start = new Date(`${periodStart}T12:00:00Z`);
    const expectedStart = `${periodStart.slice(0, 8)}01`;
    const expectedEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (periodStart !== expectedStart || periodEnd !== expectedEnd) {
      throw new Error("This employee is paid monthly. Choose one complete calendar month.");
    }
  }

  const [attendanceResult, advancesResult] = await Promise.all([
    supabase
      .from("attendance_entries")
      .select("status,clock_in_at,clock_out_at,break_minutes,overtime_minutes,sick_minutes")
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
  const { workedDays, workedMinutes, overtimeMinutes, sickMinutes, grossPay: calculatedGross } = calculatePay(
    employee.wage_type, employee.pay_frequency, Number(employee.wage_rate), attendance,
  );
  let grossPay = calculatedGross;

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
      wage_rate: Number(employee.wage_rate),
      pay_frequency: employee.pay_frequency,
      worked_days: workedDays,
      worked_minutes: workedMinutes,
      overtime_minutes: overtimeMinutes,
      sick_minutes: sickMinutes,
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
  if (error?.code === "23P01") throw new Error("This pay period overlaps another active pay record for the employee.");
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

export async function updateEmployee(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("Manager access required.");
  const id = textValue(formData, "employeeId");
  const fullName = textValue(formData, "fullName");
  const startDate = textValue(formData, "startDate");
  const wageType = textValue(formData, "wageType");
  const payFrequency = textValue(formData, "payFrequency");
  validateWage(wageType, payFrequency);
  if (fullName.length < 2 || fullName.length > 120 || !validDate(startDate) || !textValue(formData, "wageRate")) throw new Error("Enter a valid name, wage and start date.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").update({
    full_name: fullName, phone: textValue(formData, "phone") || null,
    job_title: textValue(formData, "jobTitle") || null, responsibilities: textValue(formData, "responsibilities") || null,
    start_date: startDate, wage_type: wageType, pay_frequency: payFrequency, wage_rate: moneyValue(formData, "wageRate"),
  }).eq("id", id).eq("business_id", workspace.businessId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Employee not found.");
  revalidatePath("/employees"); revalidatePath("/payroll"); revalidatePath("/attendance"); revalidatePath("/dashboard");
}

export async function setEmployeeActive(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("Manager access required.");
  const active = textValue(formData, "active") === "true";
  const endDate = active ? null : textValue(formData, "endDate");
  if (!active && (!endDate || !validDate(endDate) || endDate > today())) throw new Error("Choose a valid leaving date, no later than today.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").update({ active, end_date: endDate })
    .eq("id", textValue(formData, "employeeId")).eq("business_id", workspace.businessId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Employee not found.");
  revalidatePath("/employees"); revalidatePath("/attendance"); revalidatePath("/dashboard"); revalidatePath("/payroll");
}

export async function cancelPayRun(formData: FormData) {
  const workspace = await getWorkspace();
  if (workspace.role === "employee") throw new Error("Manager access required.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("pay_runs").update({ status: "cancelled" })
    .eq("id", textValue(formData, "payRunId")).eq("business_id", workspace.businessId).eq("status", "draft").select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only a draft can be cancelled.");
  revalidatePath("/payroll"); revalidatePath("/attendance"); revalidatePath(`/payroll/${data.id}`); revalidatePath("/dashboard");
}

async function formResult(action: (data: FormData) => Promise<void>, data: FormData, success: string) {
  try { await action(data); return { success }; }
  catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof Error ? error.message : "Unable to save. Please try again." };
  }
}
export async function saveNewEmployee(data: FormData) { return formResult(addEmployee, data, "Employee added."); }
export async function saveEmployee(data: FormData) { return formResult(updateEmployee, data, "Employee updated."); }
export async function saveEmployeeStatus(data: FormData) { return formResult(setEmployeeActive, data, "Employee status updated. Previous records are preserved."); }
export async function saveAttendance(data: FormData) { return formResult(recordAttendance, data, "Attendance saved."); }
export async function preparePay(data: FormData) { return formResult(createPayRun, data, "Draft pay record prepared. Review it before marking paid."); }
export async function confirmPay(data: FormData) { return formResult(markPayRunPaid, data, "Payment recorded."); }
export async function cancelDraftPay(data: FormData) { return formResult(cancelPayRun, data, "Draft cancelled. You can correct attendance and prepare a replacement."); }
