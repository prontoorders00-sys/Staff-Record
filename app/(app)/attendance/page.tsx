import type { Metadata } from "next";
import { recordAttendance } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { attendanceTime, initials, prettyDate, today } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const date = today();
  const [employeesResult, attendanceResult] = await Promise.all([
    supabase.from("employees").select("id,full_name,job_title").eq("business_id", workspace.businessId).eq("active", true).order("full_name"),
    supabase.from("attendance_entries").select("employee_id,status,clock_in_at,clock_out_at,break_minutes").eq("business_id", workspace.businessId).eq("work_date", date),
  ]);
  const employees = employeesResult.data ?? [];
  const marks = new Map((attendanceResult.data ?? []).map((entry) => [entry.employee_id, entry]));
  return (
    <main className="page-content">
      <PageHeader eyebrow="Daily register" title="Attendance" description={`${prettyDate(date)} · Mark each employee as they arrive or before you close.`} />
      <section className="panel attendance-panel">
        <div className="attendance-head"><span>Employee</span><span>Status & time</span><span>Save</span></div>
        {employees.length ? employees.map((employee) => {
          const mark = marks.get(employee.id);
          return <form action={recordAttendance} className="attendance-row" key={employee.id}>
            <input type="hidden" name="employeeId" value={employee.id} /><input type="hidden" name="workDate" value={date} />
            <div className="person-cell"><span className="avatar">{initials(employee.full_name)}</span><p><strong>{employee.full_name}</strong><small>{employee.job_title || "Employee"}</small></p></div>
            <div className="attendance-fields"><select name="status" defaultValue={mark?.status ?? "present"}><option value="present">Present</option><option value="absent">Absent</option><option value="sick">Sick</option><option value="leave">On leave</option><option value="pending_review">Review later</option></select><input aria-label="Clock in" name="clockIn" type="time" defaultValue={attendanceTime(mark?.clock_in_at)} /><input aria-label="Clock out" name="clockOut" type="time" defaultValue={attendanceTime(mark?.clock_out_at)} /><input aria-label="Break minutes" name="breakMinutes" type="number" min="0" defaultValue={mark?.break_minutes ?? 0} /></div>
            <SubmitButton className="button button-small" pendingLabel="…">{mark ? "Update" : "Mark"}</SubmitButton>
          </form>;
        }) : <div className="empty"><span>✓</span><strong>No employees to mark</strong><p>Add active employees first.</p></div>}
      </section>
    </main>
  );
}
