import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { money, today } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const date = today();
  const [employeesResult, attendanceResult, advancesResult, tasksResult] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact" }).eq("business_id", workspace.businessId).eq("active", true),
    supabase.from("attendance_entries").select("status").eq("business_id", workspace.businessId).eq("work_date", date),
    supabase.from("advances").select("amount,repaid_amount").eq("business_id", workspace.businessId).in("status", ["open", "partially_repaid"]),
    supabase.from("tasks").select("id,title,due_at,employees(full_name)").eq("business_id", workspace.businessId).is("completed_at", null).order("due_at", { ascending: true }).limit(5),
  ]);
  const staffCount = employeesResult.count ?? 0;
  const attendance = attendanceResult.data ?? [];
  const present = attendance.filter((row) => row.status === "present").length;
  const absent = attendance.filter((row) => row.status === "absent").length;
  const advanceBalance = (advancesResult.data ?? []).reduce((sum, row) => sum + Number(row.amount) - Number(row.repaid_amount), 0);
  const tasks = tasksResult.data ?? [];

  return (
    <main className="page-content">
      <PageHeader eyebrow="Business overview" title={`Good day, ${workspace.businessName}`} description="Here’s what needs your attention today." action={<Link className="button button-primary" href="/attendance">Take attendance</Link>} />
      <section className="stats-grid">
        <Stat label="Active employees" value={String(staffCount)} note="People on your staff record" tone="dark" />
        <Stat label="Present today" value={String(present)} note={staffCount ? `${Math.round((present / staffCount) * 100)}% of the team` : "No staff added yet"} tone="green" />
        <Stat label="Absent today" value={String(absent)} note={`${Math.max(staffCount - attendance.length, 0)} not marked yet`} tone="orange" />
        <Stat label="Advances owed" value={money(advanceBalance)} note="Outstanding employee balance" tone="sand" />
      </section>
      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Action list</span><h2>Open tasks</h2></div><Link href="/tasks">View all →</Link></div>
          {tasks.length ? <div className="list">{tasks.map((task) => {
            const person = Array.isArray(task.employees) ? task.employees[0] : task.employees;
            return <div className="list-row" key={task.id}><span className="check-circle" /><div><strong>{task.title}</strong><small>{person?.full_name ?? "Whole team"}{task.due_at ? ` · Due ${new Date(task.due_at).toLocaleDateString("en-ZA")}` : ""}</small></div></div>;
          })}</div> : <Empty title="No open tasks" text="Assign responsibilities and they’ll appear here." href="/tasks" link="Create a task" />}
        </div>
        <div className="panel quick-panel">
          <div className="panel-heading"><div><span className="eyebrow">Shortcuts</span><h2>Quick actions</h2></div></div>
          <Link href="/employees"><span className="quick-icon">+</span><div><strong>Add an employee</strong><small>Record their role and wage</small></div><b>→</b></Link>
          <Link href="/advances"><span className="quick-icon">R</span><div><strong>Record an advance</strong><small>Keep a clear money trail</small></div><b>→</b></Link>
          <Link href="/attendance"><span className="quick-icon">✓</span><div><strong>Mark today’s register</strong><small>Present, absent, sick or leave</small></div><b>→</b></Link>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Empty({ title, text, href, link }: { title: string; text: string; href: string; link: string }) {
  return <div className="empty"><span>✓</span><strong>{title}</strong><p>{text}</p><Link href={href}>{link} →</Link></div>;
}
