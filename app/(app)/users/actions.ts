"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile, type Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Owners can only create staff; a business has exactly the owner who signed it up.
const STAFF_ROLES = ["manager", "attendant"] as const;

const createSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(STAFF_ROLES),
});

export type ActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function assertOwner(): Promise<Profile> {
  const me = await getProfile();
  if (me.role !== "owner") throw new Error("Only the owner can manage users");
  return me;
}

/**
 * The admin client bypasses RLS, so before touching another account confirm through the
 * owner's own session that the target is a staff member of the owner's organization.
 */
async function assertStaffInMyOrg(me: Profile, userId: string) {
  if (userId === me.id) throw new Error("You cannot change your own account here");
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, org_id, role")
    .eq("id", userId)
    .eq("org_id", me.org_id)
    .maybeSingle();
  if (!data) throw new Error("User not found in your business");
  if (data.role === "owner") throw new Error("The owner account cannot be changed here");
}

export async function createUser(input: z.input<typeof createSchema>): Promise<ActionResult> {
  let me: Profile;
  try {
    me = await assertOwner();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields",
      fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
    };
  }
  const { email, password, full_name, role } = parsed.data;
  // app_metadata is server-only. handle_new_user reads org_id + role from it and attaches
  // the new account to this owner's organization (and refuses role = owner).
  const { error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { org_id: me.org_id, role },
  });
  if (error) {
    return { ok: false, error: /already been registered|already exists/i.test(error.message) ? "That email already has an account" : error.message };
  }
  revalidatePath("/users");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  try {
    const me = await assertOwner();
    await assertStaffInMyOrg(me, userId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Update through the owner's own session so RLS applies and the audit log records who did it.
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) return { ok: false, error: error.message };

  // Also block sign-in at the auth level (RLS already denies an inactive profile all data).
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) return { ok: false, error: banError.message };
  revalidatePath("/users");
  return { ok: true };
}

export async function resetPassword(userId: string, password: string): Promise<ActionResult> {
  try {
    const me = await assertOwner();
    await assertStaffInMyOrg(me, userId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
