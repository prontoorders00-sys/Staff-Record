import type { Metadata } from "next";
import { addAdvance } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { money, prettyDate, today } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Advances" };

export default async function AdvancesPage() {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const [employeesResult, advancesResult] = await Promise.all([
    supabase.from("employees").select("id,full_name").eq("business_id", workspace.businessId).eq("active", true).order("full_name"),
    supabase.from("advances").select("id,amount,repaid_amount,status,issued_on,recovery_note,employees(full_name)").eq("business_id", workspace.businessId).order("issued_on", { ascending: false }),
  ]);
  const employees = employeesResult.data ?? [];
  const advances = advancesResult.data ?? [];
  return (
    <main className="page-content">
      <PageHeader eyebrow="Money records" title="Employee advances" description="Record every amount clearly so neither side has to rely on memory." />
      <section className="two-column">
        <div className="panel">
          <div className="panel-heading"><div><h2>Advance history</h2><p>{advances.length} records</p></div></div>
          {advances.length ? <div className="list">{advances.map((advance) => { const person = Array.isArray(advance.employees) ? advance.employees[0] : advance.employees; return <article className="money-row" key={advance.id}><div><strong>{person?.full_name ?? "Employee"}</strong><small>{prettyDate(advance.issued_on)}{advance.recovery_note ? ` · ${advance.recovery_note}` : ""}</small></div><div><strong>{money(advance.amount)}</strong><small>{money(Number(advance.amount) - Number(advance.repaid_amount))} outstanding</small></div><span className={`pill ${advance.status === "repaid" ? "success" : "warning"}`}>{advance.status.replace("_", " ")}</span></article>; })}</div> : <div className="empty"><span>R</span><strong>No advances recorded</strong><p>New records will create a clear history here.</p></div>}
        </div>
        <aside className="panel form-panel">
          <div className="panel-heading"><div><span className="eyebrow">New record</span><h2>Record advance</h2></div></div>
          <form action={addAdvance} className="stack-form">
            <label>Employee<select name="employeeId" required defaultValue=""><option value="" disabled>Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
            <div className="form-grid"><label>Amount (R)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" /></label><label>Date given<input name="issuedOn" type="date" defaultValue={today()} required /></label></div>
            <label>Recovery note<textarea name="recoveryNote" rows={3} placeholder="e.g. Deduct R500 from the next two pay runs" /></label>
            <div className="info-box"><strong>This creates a permanent record.</strong><span>You can add acknowledgement and repayment tools next.</span></div>
            <SubmitButton className="button button-primary button-full" pendingLabel="Recording…">Record advance</SubmitButton>
          </form>
        </aside>
      </section>
    </main>
  );
}
