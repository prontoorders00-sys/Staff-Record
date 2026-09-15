"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

function textValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
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
