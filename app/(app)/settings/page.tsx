import { requireRole } from "@/lib/auth";
import { getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/misc";
import { SettingsClient, type RateRow } from "./settings-client";

export default async function SettingsPage() {
  const me = await requireRole("owner");
  const supabase = await createClient();
  const [money, { data: currencies }, { data: history }, moneyRecorded, { data: org }] = await Promise.all([
    getMoneyContext(),
    supabase.from("currencies").select("code, name, decimals").order("code"),
    supabase
      .from("exchange_rates")
      .select("id, currency, per_base, effective_date, is_placeholder, created_at")
      .is("deleted_at", null)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("sales_safe").select("id", { count: "exact", head: true }),
    supabase.from("organizations").select("haulage_tolerance_pct").single(),
  ]);

  return (
    <>
      <PageHeader title="Settings" description={`Money settings for ${me.org_name}`} />
      <SettingsClient
        base={money.base}
        enabled={money.enabled}
        rates={money.rates}
        currencies={currencies ?? []}
        history={(history ?? []) as RateRow[]}
        baseLocked={(moneyRecorded.count ?? 0) > 0}
        tolerance={Number(org?.haulage_tolerance_pct ?? 0.5)}
      />
    </>
  );
}
