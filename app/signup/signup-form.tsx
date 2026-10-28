"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";

const schema = z
  .object({
    business_name: z.string().trim().min(2, "Enter your business name").max(120),
    full_name: z.string().trim().min(2, "Enter your name").max(120),
    email: z.email("Enter a valid email"),
    password: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ business_name: "", full_name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    // The database creates the organization, your owner profile and default fuel types
    // in the same transaction as the account (see handle_new_user).
    const { data, error } = await createClient().auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { business_name: parsed.data.business_name, full_name: parsed.data.full_name },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(/already registered/i.test(error.message) ? "That email already has an account. Sign in instead." : error.message);
      return;
    }
    if (data.session) {
      toast.success(`Welcome! ${parsed.data.business_name} is ready.`);
      router.replace("/stock");
      router.refresh();
      return;
    }
    // Email confirmation is on: the account exists but needs the link first.
    setSentTo(parsed.data.email);
  }

  if (sentTo) {
    return (
      <div className="grid gap-3 text-center">
        <MailCheck className="mx-auto size-10 text-green" />
        <p className="font-semibold">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>. Open it on this
          device to finish setting up your business.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field label="Business name" htmlFor="business" error={errors.business_name}>
        <Input id="business" autoComplete="organization" placeholder="e.g. Mwangi Fuel Depot" value={form.business_name} onChange={set("business_name")} />
      </Field>
      <Field label="Your name" htmlFor="fullname" error={errors.full_name}>
        <Input id="fullname" autoComplete="name" value={form.full_name} onChange={set("full_name")} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email}>
        <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password}>
        <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
      </Field>
      <Button type="submit" size="lg" disabled={loading}>
        {loading ? <Loader2 className="animate-spin" /> : null}
        Create business account
      </Button>
    </form>
  );
}
