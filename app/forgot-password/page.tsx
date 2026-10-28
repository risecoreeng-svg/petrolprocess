"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";

const schema = z.object({ email: z.email("Enter a valid email") });

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setError(undefined);
    setLoading(true);
    const { error: err } = await createClient().auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    // Rate-limit errors are worth showing; otherwise never reveal whether the email exists.
    if (err && /rate limit|too many/i.test(err.message)) return toast.error(err.message);
    setSent(true);
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="grid gap-3 text-center">
          <MailCheck className="mx-auto size-10 text-green" />
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is on its
            way. Open it on this device.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Email" htmlFor="email" error={error}>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
