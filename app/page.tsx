import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/dashboard");

  return (
    <main className="landing">
      <nav className="landing-nav container">
        <Logo />
        <Link className="button button-secondary" href="/login">Sign in</Link>
      </nav>
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">The staff book, made digital</span>
          <h1>Know what happened at work. Every day.</h1>
          <p>
            Keep attendance, wages, advances, responsibilities and employee records in one clear place—without complicated HR software.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary button-large" href="/login">Set up my business</Link>
            <span className="hero-note">Built for shops, wholesalers and growing teams.</span>
          </div>
        </div>
        <div className="hero-board" aria-label="Staff Record product preview">
          <div className="preview-top"><span>Today</span><strong>Monday, 15 Sep</strong></div>
          <div className="preview-stat"><span>Staff expected</span><strong>18</strong></div>
          <div className="preview-grid">
            <div><small>Present</small><b>14</b><em className="dot green" /></div>
            <div><small>Late</small><b>2</b><em className="dot amber" /></div>
            <div><small>Absent</small><b>2</b><em className="dot red" /></div>
          </div>
          <div className="preview-row"><span className="avatar">AM</span><p><strong>Ahmed Mohamed</strong><small>Cashier · Clocked in 07:52</small></p><b className="pill success">Present</b></div>
          <div className="preview-row"><span className="avatar sand">NK</span><p><strong>Naledi Khumalo</strong><small>Floor assistant · Not in</small></p><b className="pill warning">Follow up</b></div>
        </div>
      </section>
      <section className="trust-strip">
        <div className="container trust-grid">
          <div><strong>Attendance</strong><span>See who came in, when, and for how long.</span></div>
          <div><strong>Money records</strong><span>Track wages and every advance without loose paper.</span></div>
          <div><strong>Clear responsibility</strong><span>Know each person’s job and daily tasks.</span></div>
        </div>
      </section>
    </main>
  );
}

function Logo() {
  return <Link className="logo" href="/"><span>SR</span><strong>Staff Record</strong></Link>;
}
