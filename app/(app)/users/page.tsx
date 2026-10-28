import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { UsersClient, type UserRow } from "./users-client";

export default async function UsersPage() {
  const me = await requireRole("owner");
  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role, active, created_at")
    .is("deleted_at", null)
    .order("created_at");

  // Emails live in auth.users, which only the service role can list.
  let emails: Record<string, string> = {};
  let adminError: string | null = null;
  try {
    const { data, error } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    emails = Object.fromEntries(data.users.map((u) => [u.id, u.email ?? ""]));
  } catch (e) {
    adminError = (e as Error).message;
  }

  return (
    <UsersClient
      meId={me.id}
      users={((profiles ?? []) as Omit<UserRow, "email">[]).map((p) => ({ ...p, email: emails[p.id] ?? "" }))}
      adminError={adminError}
    />
  );
}
