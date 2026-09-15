import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="logo" href="/"><span>SR</span><strong>Staff Record</strong></Link>
        <div className="auth-copy">
          <span className="eyebrow">Simple. Secure. Yours.</span>
          <h1>Your business records, without the paperwork.</h1>
          <p>Use one email address to open Staff Record on your office computer or phone.</p>
        </div>
        <div className="auth-points">
          <span>✓ No password to forget</span>
          <span>✓ Your records stay private</span>
          <span>✓ Works on computer and mobile</span>
        </div>
      </section>
      <section className="auth-form-wrap">
        <LoginForm />
      </section>
    </main>
  );
}
