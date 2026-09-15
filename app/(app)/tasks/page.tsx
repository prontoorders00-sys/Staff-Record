import type { Metadata } from "next";
import { addTask, completeTask } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const [employeesResult, tasksResult] = await Promise.all([
    supabase.from("employees").select("id,full_name").eq("business_id", workspace.businessId).eq("active", true).order("full_name"),
    supabase.from("tasks").select("id,title,description,due_at,completed_at,employees(full_name)").eq("business_id", workspace.businessId).order("created_at", { ascending: false }),
  ]);
  const employees = employeesResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  return (
    <main className="page-content">
      <PageHeader eyebrow="Responsibilities" title="Tasks" description="Turn verbal instructions into a simple, visible action list." />
      <section className="two-column">
        <div className="panel">
          <div className="panel-heading"><div><h2>Team action list</h2><p>{tasks.filter((task) => !task.completed_at).length} still open</p></div></div>
          {tasks.length ? <div className="task-list">{tasks.map((task) => { const person = Array.isArray(task.employees) ? task.employees[0] : task.employees; return <article className={`task-row ${task.completed_at ? "done" : ""}`} key={task.id}><div><strong>{task.title}</strong><small>{person?.full_name ?? "Whole team"}{task.due_at ? ` · ${new Date(task.due_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small>{task.description && <p>{task.description}</p>}</div>{task.completed_at ? <span className="pill success">Done</span> : <form action={completeTask}><input type="hidden" name="taskId" value={task.id} /><SubmitButton className="button button-small" pendingLabel="…">Mark done</SubmitButton></form>}</article>; })}</div> : <div className="empty"><span>□</span><strong>No tasks yet</strong><p>Add the first clear responsibility using the form.</p></div>}
        </div>
        <aside className="panel form-panel">
          <div className="panel-heading"><div><span className="eyebrow">New responsibility</span><h2>Assign task</h2></div></div>
          <form action={addTask} className="stack-form">
            <label>Task title<input name="title" minLength={2} maxLength={160} required placeholder="e.g. Count cold-drink stock" /></label>
            <label>Assign to<select name="employeeId" defaultValue=""><option value="">Whole team</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
            <label>Due date and time<input name="dueAt" type="datetime-local" /></label>
            <label>Details<textarea name="description" rows={3} placeholder="Add any important instructions" /></label>
            <SubmitButton className="button button-primary button-full" pendingLabel="Assigning…">Assign task</SubmitButton>
          </form>
        </aside>
      </section>
    </main>
  );
}
