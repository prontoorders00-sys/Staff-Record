"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type TaskNotice = { id: string; title: string; due_at: string | null; assigned_by_name: string | null; assigned_by_role: string | null; seen_at: string | null; updated_at: string };
export function TaskNotifications({ businessId, employee }: { businessId: string; employee: boolean }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [notices, setNotices] = useState<TaskNotice[]>([]);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const shown = useRef(new Set<string>());
  const signature = useRef("");
  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    if (employee && "serviceWorker" in navigator && "PushManager" in window) {
      void navigator.serviceWorker.getRegistration("/").then(async registration => {
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const { data } = await supabase.from("task_push_subscriptions").select("id").eq("endpoint", subscription.endpoint).maybeSingle();
          setPushEnabled(Boolean(data));
        }
      }).catch(() => {});
    }
    let active = true;
    let inFlight = false;
    async function poll() {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const { data, error: failure } = await supabase.from("tasks")
          .select("id,title,due_at,assigned_by_name,assigned_by_role,seen_at,updated_at")
          .eq("business_id", businessId).is("completed_at", null).order("created_at", { ascending: false });
        if (!active) return;
        if (failure) { setError("Cannot check for new tasks. Check your connection; we will retry automatically."); return; }
        setError("");
        const items = (data ?? []) as TaskNotice[];
        const next = JSON.stringify(items);
        // Refresh also updates overdue labels as the clock advances.
        if (signature.current !== next || items.length > 0) router.refresh();
        signature.current = next;
        if (!employee) return;
        const unread = items.filter(t => !t.seen_at);
        setNotices(unread);
        for (const task of unread) {
          if (shown.current.has(task.id)) continue;
          shown.current.add(task.id);
          if ("Notification" in window && Notification.permission === "granted" && !("PushManager" in window)) {
            try {
              const notification = new Notification(`Task from ${task.assigned_by_name ?? "Manager"}`, {
                body: `${task.title}${task.due_at ? ` — due ${new Date(task.due_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : ""}`,
                tag: task.id,
              });
              notification.onclick = () => { window.focus(); document.getElementById(`task-${task.id}`)?.scrollIntoView({behavior:"smooth"}); notification.close(); };
            } catch { /* The visible in-app notice remains available on browsers without desktop notifications. */ }
          }
        }
      } catch {
        if (active) setError("Cannot check for new tasks. Check your connection; we will retry automatically.");
      } finally { inFlight = false; }
    }
    void poll();
    const interval = window.setInterval(() => void poll(), 10000);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [businessId, employee, router, supabase]);

  async function acknowledge() {
    setBusy(true);
    try {
      const results = await Promise.all(notices.map(t => supabase.rpc("respond_to_task", { target_task: t.id, response: "seen" })));
      if (results.some(r => r.error)) { setError("Could not acknowledge every task. Please try again."); return; }
      setNotices([]); router.refresh();
    } catch { setError("Could not acknowledge tasks. Please try again."); }
    finally { setBusy(false); }
  }
  async function enablePush() {
    setBusy(true); setPushMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("On iPhone or iPad, add Staff Record to your Home Screen, open it there, then enable notifications.");
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== "granted") throw new Error("Allow notifications in your browser settings to receive phone alerts.");
      const { data: publicKey, error: keyError } = await supabase.rpc("task_push_public_key");
      if (keyError || !publicKey) throw new Error("Phone notifications are not configured yet.");
      const registration = await navigator.serviceWorker.register("/task-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const raw = atob(publicKey.replace(/-/g,"+").replace(/_/g,"/"));
      const key = Uint8Array.from(raw, c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const { data: { user } } = await supabase.auth.getUser();
      const { data: employees, error: employeeError } = await supabase.from("employees").select("id").eq("business_id",businessId).eq("active",true);
      if (!user || employeeError || employees?.length !== 1) throw new Error("Unable to find your employee inbox.");
      const json = subscription.toJSON();
      const { error: saveError } = await supabase.from("task_push_subscriptions").upsert({user_id:user.id,employee_id:employees[0].id,endpoint:subscription.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth},{onConflict:"endpoint"});
      if (saveError) throw new Error("Could not connect phone alerts. If this is a shared device, sign out of the previous account first.");
      setPushEnabled(true); setPushMessage("Phone notifications enabled. New tasks can alert you even when the app is closed.");
    } catch (failure) { setPushMessage(failure instanceof Error ? failure.message : "Could not enable phone alerts."); }
    finally { setBusy(false); }
  }
  async function disablePush() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const {error} = await supabase.from("task_push_subscriptions").delete().eq("endpoint",subscription.endpoint);
        if (error) throw error;
        await subscription.unsubscribe();
      }
      setPushEnabled(false); setPushMessage("Phone alerts disabled on this device.");
    } catch { setPushMessage("Could not disable phone alerts. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="task-notifications">
    {employee && <div className="info-box"><strong>Task notifications</strong><p>{pushEnabled ? "Phone alerts are enabled on this device." : "Enable phone alerts for new tasks, including when the app is closed. On iPhone or iPad, first add Staff Record to your Home Screen."}</p>
      <button className="button" disabled={busy} onClick={pushEnabled ? disablePush : enablePush}>{busy ? "Please wait…" : pushEnabled ? "Disable phone alerts" : "Enable phone alerts"}</button>
      {permission === "denied" && <p>Notifications are blocked in your browser settings.</p>}
      <p>The inbox also checks for updates every 10 seconds while open.</p>
      {pushMessage && <p role="status">{pushMessage}</p>}
    </div>}
    {notices.length > 0 && <section className="task-alert" role="status" aria-live="polite"><strong>{notices.length} new {notices.length === 1 ? "task" : "tasks"} from your manager</strong>{notices.map(t => <p key={t.id}><a href={`#task-${t.id}`}>{t.title}</a> · {t.assigned_by_name ?? "Manager"}{t.assigned_by_role ? ` (${t.assigned_by_role})` : ""}{t.due_at ? ` · Due ${new Date(t.due_at).toLocaleString("en-ZA", { timeZone:"Africa/Johannesburg" })}` : ""}</p>)}<button className="button" disabled={busy} onClick={acknowledge}>{busy ? "Saving…" : "I have seen these tasks"}</button></section>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
