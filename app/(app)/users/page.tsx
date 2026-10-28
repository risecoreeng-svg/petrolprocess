import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { UsersClient, type UserRow } from "./users-client";

export default async function UsersPage() {
  const me = await requireRole("owner");
  const supabase = await createClient();
  // RLS returns only profiles in the owner's organization.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role, active, created_at")
    .eq("org_id", me.org_id)
    .is("deleted_at", null)
    .order("created_at");

  // Emails live in auth.users. Look up only this org's members, never the whole user list.
  let emails: Record<string, string> = {};
  let adminError: string | null = null;
  try {
    const admin = createAdminClient();
    const found = await Promise.all(
      (profiles ?? []).map(async (p) => {
        const { data, error } = await admin.auth.admin.getUserById(p.id);
        if (error) throw error;
        return [p.id, data.user?.email ?? ""] as const;
      }),
    );
    emails = Object.fromEntries(found);
  } catch (e) {
    adminError = (e as Error).message;
  }

  return (
    <UsersClient
      meId={me.id}
      orgName={me.org_name}
      users={((profiles ?? []) as Omit<UserRow, "email">[]).map((p) => ({ ...p, email: emails[p.id] ?? "" }))}
      adminError={adminError}
    />
  );
}
