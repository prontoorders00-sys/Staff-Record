import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBusiness } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: existing } = await supabase.from("business_memberships").select("id").eq("user_id", user.id).limit(1).maybeSingle();
  if (existing) redirect("/dashboard");

  return (
    <main className="onboarding-page">
      <div className="onboarding-card">
        <div className="logo"><span>SR</span><strong>Staff Record</strong></div>
        <span className="step-label">Step 1 of 1</span>
        <h1>Tell us about your business</h1>
        <p className="muted">This becomes the private workspace for you and your staff records.</p>
        <form action={createBusiness} className="stack-form">
          <label htmlFor="businessName">Business name</label>
          <input id="businessName" name="businessName" minLength={2} maxLength={120} placeholder="e.g. Yusuf Cash & Carry" required autoFocus />
          <label htmlFor="ownerName">Your full name</label>
          <input id="ownerName" name="ownerName" minLength={2} maxLength={120} placeholder="e.g. Muhammad Yusuf" required />
          <div className="info-box"><strong>You’ll be the owner.</strong><span>You can add managers and employee access later.</span></div>
          <SubmitButton className="button button-primary button-full">Create my Staff Record</SubmitButton>
        </form>
      </div>
    </main>
  );
}
