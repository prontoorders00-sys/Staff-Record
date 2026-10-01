import type { Metadata } from "next";
import { saveTask, saveTaskResponse, saveTaskAccess } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { TaskNotifications } from "@/components/task-notifications";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { taskStatus } from "@/lib/task-rules";

export const metadata: Metadata = { title: "Tasks" };
const dateTime = (value: string) => new Date(value).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
export default async function TasksPage() {
  const workspace = await getWorkspace();
  const canManage = workspace.role !== "employee";
  const supabase = await createClient();
  const [employeesResult, tasksResult, accessResult] = await Promise.all([
    supabase.from("employees").select("id,full_name,user_id").eq("business_id", workspace.businessId).eq("active", true).order("full_name"),
    supabase.from("tasks").select("id,employee_id,title,description,due_at,created_at,completed_at,started_at,seen_at,problem_note,duration_minutes,assigned_by_name,assigned_by_role,employees!tasks_employee_business_fk(full_name)").eq("business_id", workspace.businessId).order("created_at", { ascending: false }),
    canManage ? supabase.from("task_employee_access").select("employee_id,email").eq("business_id", workspace.businessId) : Promise.resolve({data: [], error: null}),
  ]);
  if (employeesResult.error || tasksResult.error || accessResult.error) throw new Error("Unable to load tasks. Please try again.");
  const employees = employeesResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  const access = accessResult.data ?? [];
  return <main className="page-content">
    <PageHeader eyebrow="Responsibilities" title={canManage ? "Team tasks" : "My tasks"} description={canManage ? "Choose the person, set the time allowed, and follow the work through to completion." : "Your instructions, deadlines and completed work in one place."} />
    <TaskNotifications businessId={workspace.businessId} employee={!canManage} />
    <section className={canManage ? "two-column" : "task-inbox"}>
      <div className="panel">
        <div className="panel-heading"><div><h2>{canManage ? "Team action list" : "Your action list"}</h2><p>{tasks.filter(task => !task.completed_at).length} open · Times shown in South African time</p></div></div>
        {tasks.length ? <div className="task-list">{tasks.map(task => {
          const person = Array.isArray(task.employees) ? task.employees[0] : task.employees;
          const status = taskStatus(task);
          const reachable = access.some(a => a.employee_id === task.employee_id) || employees.some(e => e.id === task.employee_id && e.user_id);
          return <article className={`task-row task-card ${task.completed_at ? "done" : ""}`} key={task.id} id={`task-${task.id}`}>
            <div className="task-card-main"><div className="task-card-heading"><strong>{task.title}</strong><span className={`pill ${task.completed_at ? "success" : status === "Overdue" ? "task-overdue" : "neutral"}`}>{status}</span></div>
              <small>{person?.full_name ?? "Whole team"} · From {task.assigned_by_name ?? "Manager"}{task.assigned_by_role ? ` (${task.assigned_by_role})` : ""}</small>
              {task.description && <p>{task.description}</p>}
              <p><strong>{task.due_at ? `Due ${dateTime(task.due_at)}` : "No deadline (older task)"}</strong>{task.duration_minutes ? ` · ${task.duration_minutes} minutes allowed` : ""}</p>
              <small>Sent {dateTime(task.created_at)}{task.seen_at ? ` · Seen ${dateTime(task.seen_at)}` : ""}</small>
              {task.started_at && <small>Started {dateTime(task.started_at)}</small>}
              {task.completed_at && <small>Completed {dateTime(task.completed_at)} · {Math.max(0, Math.ceil((Date.parse(task.completed_at) - Date.parse(task.created_at)) / 60000))} minutes after sending</small>}
              {task.problem_note && <p className="form-error">Problem reported: {task.problem_note}</p>}
              {canManage && task.employee_id && !reachable && <p className="form-error">Employee inbox is not connected. Add their email below so they can receive this task.</p>}
              {!task.completed_at && <div className="task-actions">
                {!task.started_at && !canManage && <ActionForm action={saveTaskResponse}><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="response" value="start"/><SubmitButton pendingLabel="Starting…">Start task</SubmitButton></ActionForm>}
                <ActionForm action={saveTaskResponse}><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="response" value="done"/><SubmitButton className="button button-primary" pendingLabel="Saving…">{canManage ? "Mark done" : "Done"}</SubmitButton></ActionForm>
                {!canManage && <details><summary>Report a problem</summary><ActionForm action={saveTaskResponse} className="stack-form"><input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="response" value="problem"/><label>What is stopping you?<textarea name="note" minLength={2} maxLength={1000} required /></label><SubmitButton pendingLabel="Sending…">Send to manager</SubmitButton></ActionForm></details>}
              </div>}
            </div>
          </article>;
        })}</div> : <div className="empty"><strong>No tasks yet</strong><p>{canManage ? "Assign the first responsibility using the form." : "New tasks from your manager will appear here automatically."}</p></div>}
      </div>
      {canManage && <aside className="stack-form">
        <section className="panel form-panel"><div className="panel-heading"><h2>Give a task</h2></div>
          <ActionForm action={saveTask} className="stack-form">
            <label>What must be done?<input name="title" minLength={2} maxLength={160} required placeholder="e.g. Pack the sugar shelves" /></label>
            <label>Employee<select name="employeeId" defaultValue="" required><option value="" disabled>Choose an employee</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
            <div className="form-grid"><label>Time allowed<input name="duration" type="number" min="1" step="1" required placeholder="Enter an amount" /></label><label>Unit<select name="unit" defaultValue="minutes"><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label></div>
            <p className="muted">You choose the time for each task. The deadline is calculated when you send it.</p>
            <label>Instructions<textarea name="description" maxLength={2000} rows={3} /></label>
            <SubmitButton className="button button-primary button-full" pendingLabel="Sending…">Send task</SubmitButton>
          </ActionForm>
        </section>
        <section className="panel form-panel"><div className="panel-heading"><h2>Employee inbox access</h2></div><p className="muted">Add the employee’s email, then ask them to sign in at staffrecords.net. They can see and update only their own tasks. No invitation email is sent automatically.</p>
          {employees.map(e => <details key={e.id} className="employee-edit"><summary>{e.full_name} · {access.some(a => a.employee_id === e.id) || e.user_id ? "Connected" : "Set up inbox"}</summary><ActionForm action={saveTaskAccess} className="stack-form"><input type="hidden" name="employeeId" value={e.id}/><label>Employee email<input type="email" name="email" defaultValue={access.find(a => a.employee_id === e.id)?.email ?? ""}/></label><p className="muted">Clear the email and save to remove this email’s access.</p><SubmitButton pendingLabel="Saving…">Save access</SubmitButton></ActionForm></details>)}
        </section>
      </aside>}
    </section>
  </main>;
}
