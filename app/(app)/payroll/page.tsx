import type { Metadata } from "next";
import Link from "next/link";
import { createPayRun, markPayRunPaid } from "@/app/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { hoursAndMinutes, money, prettyDate, today, wageTypeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const [employeesResult, advancesResult, payRunsResult] = await Promise.all([
    supabase
      .from("employees")
      .select("id,full_name,wage_type,wage_rate,pay_frequency")
      .eq("business_id", workspace.businessId)
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("advances")
      .select("employee_id,amount,repaid_amount")
      .eq("business_id", workspace.businessId)
      .in("status", ["open", "partially_repaid"]),
    supabase
      .from("pay_runs")
      .select("id,period_start,period_end,pay_date,gross_pay,extra_pay,deduction_amount,advance_repayment,net_pay,status,paid_at,worked_days,worked_minutes,employees(full_name)")
      .eq("business_id", workspace.businessId)
      .order("pay_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const employees = employeesResult.data ?? [];
  const payRuns = payRunsResult.data ?? [];
  const advanceByEmployee = new Map<string, number>();
  for (const advance of advancesResult.data ?? []) {
    advanceByEmployee.set(
      advance.employee_id,
      (advanceByEmployee.get(advance.employee_id) ?? 0) + Number(advance.amount) - Number(advance.repaid_amount),
    );
  }
  const draftRuns = payRuns.filter((run) => run.status === "draft");
  const paidRuns = payRuns.filter((run) => run.status === "paid");
  const draftTotal = draftRuns.reduce((total, run) => total + Number(run.net_pay), 0);
  const paidTotal = paidRuns.reduce((total, run) => total + Number(run.net_pay), 0);
  const date = today();
  const monthStart = `${date.slice(0, 8)}01`;
  const currentMonth = new Date(`${monthStart}T12:00:00Z`);
  const monthEnd = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  return (
    <main className="page-content">
      <PageHeader
        eyebrow="Wages and deductions"
        title="Payroll"
        description="Calculate each employee’s pay, recover advances clearly, and keep a printable payment record."
      />

      <section className="payroll-stats">
        <article><span>Draft payroll</span><strong>{money(draftTotal)}</strong><small>{draftRuns.length} waiting to be paid</small></article>
        <article><span>Paid records</span><strong>{money(paidTotal)}</strong><small>{paidRuns.length} payments recorded</small></article>
        <article><span>Employees ready</span><strong>{employees.length}</strong><small>Active staff with wage details</small></article>
      </section>

      <section className="two-column payroll-layout">
        <div className="panel">
          <div className="panel-heading">
            <div><h2>Pay history</h2><p>Latest 50 records</p></div>
          </div>
          {payRuns.length ? (
            <div className="pay-run-list">
              {payRuns.map((run) => {
                const employee = Array.isArray(run.employees) ? run.employees[0] : run.employees;
                return (
                  <article className="pay-run-row" key={run.id}>
                    <div className="pay-run-main">
                      <div className="pay-run-title">
                        <strong>{employee?.full_name ?? "Employee"}</strong>
                        <span className={`pill ${run.status === "paid" ? "success" : run.status === "cancelled" ? "neutral" : "warning"}`}>{run.status}</span>
                      </div>
                      <small>{prettyDate(run.period_start)} – {prettyDate(run.period_end)} · Pay date {prettyDate(run.pay_date)}</small>
                      <div className="pay-breakdown">
                        <span>Gross {money(run.gross_pay)}</span>
                        {Number(run.extra_pay) > 0 && <span>Extra +{money(run.extra_pay)}</span>}
                        {Number(run.deduction_amount) > 0 && <span>Deduction −{money(run.deduction_amount)}</span>}
                        {Number(run.advance_repayment) > 0 && <span>Advance −{money(run.advance_repayment)}</span>}
                      </div>
                    </div>
                    <div className="pay-run-total"><small>Net pay</small><strong>{money(run.net_pay)}</strong></div>
                    <div className="pay-run-actions">
                      <Link className="button button-secondary button-small" href={`/payroll/${run.id}`}>View record</Link>
                      {run.status === "draft" && (
                        <form action={markPayRunPaid}>
                          <input type="hidden" name="payRunId" value={run.id} />
                          <ConfirmSubmitButton
                            className="button button-small"
                            confirmation="Confirm that this employee has been paid. Any advance recovery will be applied immediately."
                            pendingLabel="Saving…"
                          >
                            Mark paid
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty"><span>R</span><strong>No pay records yet</strong><p>Prepare the first employee payment using the form.</p></div>
          )}
        </div>

        <aside className="panel form-panel payroll-form-panel">
          <div className="panel-heading"><div><span className="eyebrow">New calculation</span><h2>Prepare employee pay</h2></div></div>
          <form action={createPayRun} className="stack-form">
            <label>
              Employee
              <select name="employeeId" required defaultValue="">
                <option value="" disabled>Select employee</option>
                {employees.map((employee) => {
                  const advance = advanceByEmployee.get(employee.id) ?? 0;
                  return <option key={employee.id} value={employee.id}>{employee.full_name} · {money(employee.wage_rate)} {wageTypeLabel(employee.wage_type).toLowerCase()}{advance ? ` · ${money(advance)} advance` : ""}</option>;
                })}
              </select>
            </label>
            <div className="form-grid">
              <label>Period starts<input name="periodStart" type="date" defaultValue={monthStart} required /></label>
              <label>Period ends<input name="periodEnd" type="date" defaultValue={monthEnd} required /></label>
            </div>
            <label>Pay date<input name="payDate" type="date" defaultValue={date} required /></label>
            <div className="calculation-box">
              <strong>Automatic wage calculation</strong>
              <span>Use an exact 7-day, 14-day, or complete calendar-month period based on the employee’s pay frequency. Daily and hourly workers use attendance inside that period.</span>
            </div>
            <label>Gross pay override (optional)<input name="grossOverride" type="number" min="0" max="99999999.99" step="0.01" placeholder="Leave blank to calculate automatically" /></label>
            <div className="form-grid">
              <label>Extra pay (R)<input name="extraPay" type="number" min="0" max="99999999.99" step="0.01" defaultValue="0" /></label>
              <label>Advance recovery (R)<input name="advanceRepayment" type="number" min="0" max="99999999.99" step="0.01" defaultValue="0" /></label>
            </div>
            <label>Other deduction (R)<input name="deductionAmount" type="number" min="0" max="99999999.99" step="0.01" defaultValue="0" /></label>
            <label>Deduction reason<textarea name="deductionReason" rows={2} maxLength={240} placeholder="Required when recording a deduction or damage" /></label>
            <label>Payment method<select name="paymentMethod" defaultValue="cash"><option value="cash">Cash</option><option value="bank transfer">Bank transfer</option><option value="mobile wallet">Mobile wallet</option><option value="other">Other</option></select></label>
            <label>Pay note<textarea name="note" rows={3} maxLength={1000} placeholder="Optional agreement or payment reference" /></label>
            <div className="info-box"><strong>Draft first, confirm second.</strong><span>Advance balances change only when you mark the pay record as paid.</span></div>
            <SubmitButton className="button button-primary button-full" pendingLabel="Calculating…">Prepare pay record</SubmitButton>
          </form>
        </aside>
      </section>
    </main>
  );
}
