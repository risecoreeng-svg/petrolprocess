"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { z } from "zod";
import { errorMessage } from "@/lib/utils";

type Result = { error: unknown } | { error: null } | void;

/**
 * Validates `values` with a zod schema, runs `action`, toasts the outcome and refreshes
 * server data. Database trigger errors (e.g. "Insufficient stock") surface as the toast.
 */
export function useSubmit() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit<S extends z.ZodType>(
    schema: S,
    values: unknown,
    action: (data: z.output<S>) => PromiseLike<Result>,
    successMessage: string,
  ): Promise<boolean> {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Please fix the highlighted fields");
      return false;
    }
    setErrors({});
    setPending(true);
    try {
      const res = await action(parsed.data);
      if (res && res.error) {
        toast.error(errorMessage(res.error));
        return false;
      }
      toast.success(successMessage);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { submit, pending, errors, setErrors };
}

/** Coerces a form string to a number; empty string stays undefined so zod reports "required". */
export function toNum(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
