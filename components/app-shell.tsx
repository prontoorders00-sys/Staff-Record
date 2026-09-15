import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Workspace } from "@/lib/workspace";

const nav = [
  ["/dashboard", "Overview", "▦"],
  ["/employees", "Employees", "◉"],
  ["/attendance", "Attendance", "✓"],
  ["/payroll", "Payroll", "R"],
  ["/advances", "Advances", "R"],
  ["/tasks", "Tasks", "□"],
] as const;

export function AppShell({ workspace, children }: { workspace: Workspace; children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="logo logo-light" href="/dashboard"><span>SR</span><strong>Staff Record</strong></Link>
        <div className="business-switcher"><small>WORKSPACE</small><strong>{workspace.businessName}</strong><span>{workspace.role}</span></div>
        <nav className="side-nav">
          {nav.map(([href, label, icon]) => <Link key={href} href={href}><span>{icon}</span>{label}</Link>)}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/settings"><span>⚙</span>Settings</Link>
          <form action={signOut}><button type="submit"><span>↗</span>Sign out</button></form>
        </div>
      </aside>
      <div className="app-main">
        <header className="mobile-header"><Link className="logo" href="/dashboard"><span>SR</span><strong>Staff Record</strong></Link><span>{workspace.businessName}</span></header>
        {children}
        <nav className="mobile-nav">{nav.map(([href, label, icon]) => <Link key={href} href={href}><b>{icon}</b><span>{label}</span></Link>)}</nav>
      </div>
    </div>
  );
}
