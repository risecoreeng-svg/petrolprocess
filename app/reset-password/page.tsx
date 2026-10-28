"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";

const schema = z
  .object({ password: z.string().min(8, "At least 8 characters"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

// Reached from the emailed link via /auth/callback, which signs the user in first.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    await supabase.auth.signOut();
    router.replace("/login?reset=1");
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="New password" htmlFor="password" error={errors.password}>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
