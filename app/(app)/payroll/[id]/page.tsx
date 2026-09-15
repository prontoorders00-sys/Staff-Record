import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { hoursAndMinutes, money, prettyDate, wageTypeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Pay record" };

export default async function PayRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const { data: payRun } = await supabase
    .from("pay_runs")
    .select("*,employees(full_name,job_title)")
    .eq("id", id)
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  if (!payRun) notFound();
  const employee = Array.isArray(payRun.employees) ? payRun.employees[0] : payRun.employees;

  return (
    <main className="page-content pay-record-page">
      <div className="pay-record-toolbar print-hide">
        <Link href="/payroll">← Back to payroll</Link>
        <PrintButton />
      </div>
      <article className="pay-record">
        <header>
          <div className="logo"><span>SR</span><strong>Staff Record</strong></div>
          <div><small>PAY RECORD</small><strong>{payRun.status === "paid" ? "Paid" : payRun.status === "cancelled" ? "Cancelled" : "Draft"}</strong></div>
        </header>

        <section className="pay-record-heading">
          <div><small>BUSINESS</small><h1>{workspace.businessName}</h1></div>
          <div><small>PAY DATE</small><strong>{prettyDate(payRun.pay_date)}</strong></div>
        </section>

        <section className="pay-record-person">
          <div><small>EMPLOYEE</small><strong>{employee?.full_name ?? "Employee"}</strong><span>{employee?.job_title || "Employee"}</span></div>
          <div><small>PAY PERIOD</small><strong>{prettyDate(payRun.period_start)} – {prettyDate(payRun.period_end)}</strong></div>
          <div><small>WAGE BASIS</small><strong>{wageTypeLabel(payRun.wage_type)} · {money(payRun.wage_rate)}</strong></div>
        </section>

        <section className="pay-record-lines">
          <div><span>Gross pay</span><strong>{money(payRun.gross_pay)}</strong></div>
          <div><span>Extra pay</span><strong>{money(payRun.extra_pay)}</strong></div>
          <div><span>Other deduction{payRun.deduction_reason ? ` · ${payRun.deduction_reason}` : ""}</span><strong className="negative">−{money(payRun.deduction_amount)}</strong></div>
          <div><span>Advance recovery</span><strong className="negative">−{money(payRun.advance_repayment)}</strong></div>
          <div className="pay-record-net"><span>Net pay</span><strong>{money(payRun.net_pay)}</strong></div>
        </section>

        <section className="pay-record-meta">
          <div><small>ATTENDANCE USED</small><strong>{payRun.worked_days} present day{payRun.worked_days === 1 ? "" : "s"} · {hoursAndMinutes(payRun.worked_minutes)}</strong></div>
          <div><small>PAYMENT METHOD</small><strong>{payRun.payment_method || "Not recorded"}</strong></div>
          <div><small>PAYMENT STATUS</small><strong>{payRun.paid_at ? `Paid ${new Date(payRun.paid_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" })}` : "Awaiting payment"}</strong></div>
        </section>

        {payRun.note && <section className="pay-record-note"><small>NOTE</small><p>{payRun.note}</p></section>}
        <footer>This record reflects the information captured in Staff Record at the time shown above.</footer>
      </article>
    </main>
  );
}
