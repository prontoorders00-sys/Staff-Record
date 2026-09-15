"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    setStep("code");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
    setBusy(false);
    if (error) return setMessage("That code is invalid or has expired. Please try again.");
    router.push("/dashboard");
    router.refresh();
  }

  async function resendCode() {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    setMessage(error ? error.message : "A new code has been sent.");
  }

  return (
    <div className="auth-card">
      {step === "email" ? (
        <form onSubmit={sendCode}>
          <span className="step-label">Welcome to Staff Record</span>
          <h2>Sign in or create an account</h2>
          <p className="muted">We’ll email you a secure six-digit code. No password needed.</p>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@business.co.za" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {message && <p className="form-error" role="alert">{message}</p>}
          <button className="button button-primary button-full" disabled={busy}>{busy ? "Sending code…" : "Continue with email"}</button>
          <p className="fine-print">By continuing, you agree to use Staff Record for lawful employment records.</p>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <button className="back-link" type="button" onClick={() => { setStep("email"); setMessage(""); }}>← Change email</button>
          <span className="step-label">Check your inbox</span>
          <h2>Enter the six-digit code</h2>
          <p className="muted">We sent it to <strong>{email}</strong>.</p>
          <label htmlFor="code">Verification code</label>
          <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
          {message && <p className="form-error" role="alert">{message}</p>}
          <button className="button button-primary button-full" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Open Staff Record"}</button>
          <button className="text-button" type="button" onClick={resendCode} disabled={busy}>Send a new code</button>
        </form>
      )}
    </div>
  );
}
