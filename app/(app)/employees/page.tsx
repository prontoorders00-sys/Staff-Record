import type { Metadata } from "next";
import { addEmployee } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { money, initials, today } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const { data: employees } = await supabase.from("employees").select("*").eq("business_id", workspace.businessId).order("active", { ascending: false }).order("full_name");
  return (
    <main className="page-content">
      <PageHeader eyebrow="Your team" title="Employees" description="One reliable record for every person who works in the business." />
      <section className="two-column">
        <div className="panel">
          <div className="panel-heading"><div><h2>{employees?.length ?? 0} people</h2><p>Active and former employees</p></div></div>
          {employees?.length ? <div className="employee-list">{employees.map((employee) => <article className="employee-row" key={employee.id}><span className="avatar">{initials(employee.full_name)}</span><div className="employee-main"><strong>{employee.full_name}</strong><small>{employee.job_title || "Role not set"} · {employee.phone || "No phone"}</small></div><div className="employee-wage"><strong>{money(employee.wage_rate)}</strong><small>{employee.pay_frequency}</small></div><span className={`pill ${employee.active ? "success" : "neutral"}`}>{employee.active ? "Active" : "Former"}</span></article>)}</div> : <div className="empty"><span>◉</span><strong>Your staff record is empty</strong><p>Add your first employee using the form.</p></div>}
        </div>
        <aside className="panel form-panel">
          <div className="panel-heading"><div><span className="eyebrow">New record</span><h2>Add employee</h2></div></div>
          <form action={addEmployee} className="stack-form">
            <label>Full name<input name="fullName" minLength={2} maxLength={120} required placeholder="Employee’s full name" /></label>
            <div className="form-grid"><label>Phone<input name="phone" type="tel" placeholder="e.g. 071 234 5678" /></label><label>Job title<input name="jobTitle" placeholder="e.g. Cashier" /></label></div>
            <label>Responsibilities<textarea name="responsibilities" rows={3} placeholder="What is this person responsible for?" /></label>
            <div className="form-grid"><label>Wage type<select name="wageType" defaultValue="monthly_salary"><option value="monthly_salary">Monthly salary</option><option value="weekly_salary">Weekly salary</option><option value="daily_rate">Daily rate</option><option value="hourly_rate">Hourly rate</option></select></label><label>Pay frequency<select name="payFrequency" defaultValue="monthly"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Every 2 weeks</option></select></label></div>
            <div className="form-grid"><label>Wage amount<input name="wageRate" type="number" min="0" step="0.01" required placeholder="0.00" /></label><label>Start date<input name="startDate" type="date" defaultValue={today()} required /></label></div>
            <SubmitButton className="button button-primary button-full" pendingLabel="Adding employee…">Add employee</SubmitButton>
          </form>
        </aside>
      </section>
    </main>
  );
}
