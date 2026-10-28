"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the full name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(["owner", "manager", "attendant"]),
});

export type ActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function assertOwner() {
  const me = await getProfile();
  if (me.role !== "owner") throw new Error("Only the owner can manage users");
  return me;
}

export async function createUser(input: z.input<typeof createSchema>): Promise<ActionResult> {
  try {
    await assertOwner();
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
  // app_metadata.role is read by the handle_new_user trigger; users cannot edit app_metadata themselves.
  const { error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { role },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/users");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  let me;
  try {
    me = await assertOwner();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (userId === me.id) return { ok: false, error: "You cannot deactivate your own account" };

  // Update through the owner's own session so the audit log records who did it.
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
    await assertOwner();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
