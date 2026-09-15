import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Workspace = {
  businessId: string;
  businessName: string;
  role: "owner" | "manager" | "employee";
  userId: string;
};

export async function getWorkspace(): Promise<Workspace> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("business_memberships")
    .select("business_id, role, businesses(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  const business = Array.isArray(membership.businesses)
    ? membership.businesses[0]
    : membership.businesses;

  return {
    businessId: membership.business_id,
    businessName: business?.name ?? "My business",
    role: membership.role,
    userId: user.id,
  };
}

export async function getOptionalWorkspace(): Promise<Workspace | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("business_memberships")
    .select("business_id, role, businesses(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;
  const business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;
  return {
    businessId: membership.business_id,
    businessName: business?.name ?? "My business",
    role: membership.role,
    userId: user.id,
  };
}
