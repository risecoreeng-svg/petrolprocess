"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export function LoginForm({
  inactive,
  linkError,
  passwordReset,
}: {
  inactive: boolean;
  linkError: boolean;
  passwordReset: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (inactive) {
      // Account deactivated or not linked to an organization: end the session.
      createClient().auth.signOut();
      toast.error("Your account is inactive. Contact your business owner.");
    }
    if (linkError) toast.error("That link is invalid or has expired. Please try again.");
    if (passwordReset) toast.success("Password updated. Sign in with your new password.");
  }, [inactive, linkError, passwordReset]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await createClient().auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      if (error.message === "Invalid login credentials") toast.error("Wrong email or password");
      else if (/not confirmed/i.test(error.message)) toast.error("Confirm your email first. Check your inbox for the link.");
      else toast.error(error.message);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field label="Email" htmlFor="email" error={errors.email}>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <div className="-mt-2 text-right">
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" size="lg" disabled={loading}>
        {loading ? <Loader2 className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}
