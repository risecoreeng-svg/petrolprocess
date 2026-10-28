import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { addDays, nairobiToday } from "@/lib/utils";
import type { MoneyContextValue, RateInfo } from "@/lib/currency";

/**
 * The org's base currency, enabled currencies and the latest rate for each. A rate is "stale"
 * when it's a placeholder or older than a day: the app then asks the owner to update it.
 */
export const getMoneyContext = cache(async (): Promise<MoneyContextValue> => {
  const supabase = await createClient();
  const [{ data: org }, { data: rates }] = await Promise.all([
    supabase.from("organizations").select("base_currency, enabled_currencies").single(),
    supabase
      .from("exchange_rates")
      .select("currency, per_base, effective_date, is_placeholder, created_at")
      .is("deleted_at", null)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const base = org?.base_currency ?? "USD";
  const enabled: string[] = org?.enabled_currencies ?? [base];
  const yesterday = addDays(nairobiToday(), -1);
  const latest: Record<string, RateInfo> = {};
  for (const r of rates ?? []) {
    if (latest[r.currency] || r.currency === base || !enabled.includes(r.currency)) continue;
    latest[r.currency] = {
      perBase: Number(r.per_base),
      date: r.effective_date,
      placeholder: r.is_placeholder,
      stale: r.is_placeholder || r.effective_date < yesterday,
    };
  }
  return { base, enabled, rates: latest };
});

/** Resolve a ?cur= display currency: must be enabled and have a rate; falls back to base. */
export function displayCurrency(ctx: MoneyContextValue, requested?: string) {
  const code = requested && ctx.enabled.includes(requested) && (requested === ctx.base || ctx.rates[requested]) ? requested : ctx.base;
  const rate = code === ctx.base ? 1 : ctx.rates[code].perBase;
  return { code, rate, converted: code !== ctx.base };
}
