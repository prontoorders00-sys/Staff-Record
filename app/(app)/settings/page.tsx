import type { Metadata } from "next";
import { signOut } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const workspace = await getWorkspace();
  return <main className="page-content"><PageHeader eyebrow="Workspace" title="Settings" description="Business access and account controls." /><section className="panel settings-card"><div><small>BUSINESS</small><strong>{workspace.businessName}</strong></div><div><small>YOUR ACCESS</small><strong className="capitalize">{workspace.role}</strong></div><div><small>TIMEZONE</small><strong>Africa/Johannesburg</strong></div><form action={signOut}><button className="button button-secondary" type="submit">Sign out securely</button></form></section></main>;
}
