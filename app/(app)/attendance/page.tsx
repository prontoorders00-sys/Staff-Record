import type { Metadata } from "next";
import Link from "next/link";
import { saveAttendance } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { attendanceTime, initials, prettyDate, today } from "@/lib/format";
import { validDate } from "@/lib/pay-rules";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Attendance" };
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const requested = (await searchParams).date;
  const date = typeof requested === "string" && validDate(requested) && requested <= today() ? requested : today();
  const [employeesResult, attendanceResult, payResult] = await Promise.all([
    supabase.from("employees").select("id,full_name,job_title,start_date,end_date").eq("business_id", workspace.businessId).lte("start_date", date).or(`end_date.is.null,end_date.gte.${date}`).order("full_name"),
    supabase.from("attendance_entries").select("employee_id,status,clock_in_at,clock_out_at,break_minutes,overtime_minutes,sick_minutes,note").eq("business_id", workspace.businessId).eq("work_date", date),
    supabase.from("pay_runs").select("employee_id,status").eq("business_id", workspace.businessId).lte("period_start", date).gte("period_end", date).neq("status", "cancelled"),
  ]);
  if (employeesResult.error || attendanceResult.error || payResult.error) throw new Error("Unable to load attendance. Please try again.");
  const marks = new Map((attendanceResult.data ?? []).map((entry) => [entry.employee_id, entry]));
  const locks = new Map((payResult.data ?? []).map((run) => [run.employee_id, run.status]));
  return <main className="page-content">
    <PageHeader eyebrow="Daily register" title="Attendance" description={`${prettyDate(date)} · Review or correct a day's attendance.`} />
    <form method="get" className="date-filter"><label>Attendance date<input name="date" type="date" defaultValue={date} max={today()} required /></label><button className="button button-primary">Show date</button><Link href="/attendance" className="button button-secondary">Today</Link></form>
    <p className="info-box">Overtime minutes are included in the clocked shift, not added again. Sick hours are recorded separately. Enter any agreed overtime premium or sick pay as Extra pay when preparing payroll.</p>
    <section className="panel attendance-cards">
      {employeesResult.data?.length ? employeesResult.data.map((employee) => {
        const mark = marks.get(employee.id);
        const lock = locks.get(employee.id);
        return <ActionForm action={saveAttendance} className="attendance-card" key={`${employee.id}-${date}`}>
          <input type="hidden" name="employeeId" value={employee.id} /><input type="hidden" name="workDate" value={date} />
          <div className="person-cell"><span className="avatar">{initials(employee.full_name)}</span><p><strong>{employee.full_name}</strong><small>{employee.job_title || "Employee"}</small></p></div>
          <fieldset disabled={Boolean(lock) || workspace.role === "employee"} className="attendance-inputs">
            <label>Status<select name="status" defaultValue={mark?.status ?? "present"}><option value="present">Present</option><option value="absent">Absent</option><option value="sick">Sick</option><option value="leave">On leave</option><option value="pending_review">Review later</option></select></label>
            <label>Clock in<input name="clockIn" type="time" defaultValue={attendanceTime(mark?.clock_in_at)} /></label>
            <label>Clock out<input name="clockOut" type="time" defaultValue={attendanceTime(mark?.clock_out_at)} /></label>
            <label>Break / lunch (minutes)<input name="breakMinutes" type="number" min="0" max="1440" step="1" defaultValue={mark?.break_minutes ?? 0} /></label>
            <label>Overtime (minutes within shift)<input name="overtimeMinutes" type="number" min="0" max="1440" step="1" defaultValue={mark?.overtime_minutes ?? 0} /></label>
            <label>Sick hours<input name="sickHours" type="number" min="0" max="24" step="any" defaultValue={(mark?.sick_minutes ?? 0) / 60} /></label>
            <label className="attendance-note">Note<input name="note" maxLength={1000} defaultValue={mark?.note ?? ""} /></label>
            <SubmitButton className="button button-small" pendingLabel="Saving…">{mark ? "Update attendance" : "Save attendance"}</SubmitButton>
          </fieldset>
          {lock && <p className="muted">{lock === "paid" ? "Locked: this date is included in a paid record." : "Cancel the draft pay record in Payroll before correcting this date."}</p>}
        </ActionForm>;
      }) : <div className="empty"><strong>No employees for this date</strong><p>Choose a date within an employee’s employment period.</p></div>}
    </section>
  </main>;
}
