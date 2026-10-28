import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "attendant";

export type Profile = {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
};

/** Current signed-in, active profile, or a redirect to /login. Cached per request. */
export const getProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, active, deleted_at")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.active || profile.deleted_at) redirect("/login?inactive=1");
  return profile as Profile;
});

/** Server-side page guard. The UI hides links too, but RLS is what actually protects the data. */
export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!roles.includes(profile.role)) redirect(profile.role === "attendant" ? "/sales" : "/");
  return profile;
}
