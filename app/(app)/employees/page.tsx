import type { Metadata } from "next";
import { saveNewEmployee, saveEmployee, saveEmployeeStatus } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { WageFields } from "@/components/wage-fields";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { money, initials, today } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Employees" };
export default async function EmployeesPage() {
  const workspace = await getManagerWorkspace();
  const supabase = await createClient();
  const { data: employees, error } = await supabase.from("employees").select("*").eq("business_id", workspace.businessId).order("active", { ascending: false }).order("full_name");
  if (error) throw new Error("Unable to load employees. Please try again.");
  const canManage = workspace.role !== "employee";
  return <main className="page-content">
    <PageHeader eyebrow="Your team" title="Employees" description="One reliable record for every person who works in the business." />
    <section className="two-column">
      <div className="panel">
        <div className="panel-heading"><div><h2>{employees?.length ?? 0} people</h2><p>Active and former employees</p></div></div>
        {employees?.length ? employees.map((employee) => <section key={employee.id} className="employee-record">
          <div className="employee-row"><span className="avatar">{initials(employee.full_name)}</span><div className="employee-main"><strong>{employee.full_name}</strong><small>{employee.job_title || "Role not set"} · {employee.phone || "No phone"}</small></div><div className="employee-wage"><strong>{money(employee.wage_rate)}</strong><small>{employee.pay_frequency}</small></div><span className={`pill ${employee.active ? "success" : "neutral"}`}>{employee.active ? "Active" : "Former"}</span></div>
          {canManage && <details className="employee-edit"><summary>Edit employee</summary>
            <ActionForm action={saveEmployee} className="stack-form">
              <input type="hidden" name="employeeId" value={employee.id} />
              <label>Full name<input name="fullName" minLength={2} maxLength={120} required defaultValue={employee.full_name} /></label>
              <div className="form-grid"><label>Phone<input name="phone" type="tel" defaultValue={employee.phone ?? ""} /></label><label>Job title<input name="jobTitle" defaultValue={employee.job_title ?? ""} /></label></div>
              <label>Responsibilities<textarea name="responsibilities" rows={2} defaultValue={employee.responsibilities ?? ""} /></label>
              <WageFields key={`${employee.wage_type}-${employee.pay_frequency}-${employee.wage_rate}`} wageType={employee.wage_type} payFrequency={employee.pay_frequency} wageRate={employee.wage_rate} />
              <label>Start date<input name="startDate" type="date" defaultValue={employee.start_date} required /></label>
              <p className="muted">Cancel outstanding drafts before changing wages. Existing pay records keep their original details.</p>
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </ActionForm>
            <ActionForm action={saveEmployeeStatus} className="stack-form">
              <input type="hidden" name="employeeId" value={employee.id} /><input type="hidden" name="active" value={employee.active ? "false" : "true"} />
              {employee.active && <label>Last working day<input type="date" name="endDate" min={employee.start_date} max={today()} defaultValue={today()} required /></label>}
              <ConfirmSubmitButton confirmation={employee.active ? "Mark this employee as former? Attendance and payment history will be kept." : "Reactivate this employee? Previous records will be kept."}>{employee.active ? "Mark as former employee" : "Reactivate employee"}</ConfirmSubmitButton>
            </ActionForm>
          </details>}
        </section>) : <div className="empty"><strong>Your staff record is empty</strong><p>Add your first employee using the form.</p></div>}
      </div>
      {canManage && <aside className="panel form-panel"><div className="panel-heading"><h2>Add employee</h2></div>
        <ActionForm action={saveNewEmployee} className="stack-form">
          <label>Full name<input name="fullName" minLength={2} maxLength={120} required placeholder="Employee’s full name" /></label>
          <div className="form-grid"><label>Phone<input name="phone" type="tel" placeholder="e.g. 071 234 5678" /></label><label>Job title<input name="jobTitle" placeholder="e.g. Cashier" /></label></div>
          <label>Responsibilities<textarea name="responsibilities" rows={3} /></label>
          <WageFields />
          <label>Start date<input name="startDate" type="date" defaultValue={today()} required /></label>
          <SubmitButton className="button button-primary button-full" pendingLabel="Adding employee…">Add employee</SubmitButton>
        </ActionForm>
      </aside>}
    </section>
  </main>;
}
