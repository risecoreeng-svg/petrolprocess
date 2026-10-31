import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PriceRefs } from "@/lib/price-check";

/**
 * What prices usually look like in this business, for the price warnings on the entry forms.
 * Each query is limited by RLS: a sales manager gets no tank averages, an attendant no
 * delivery prices, and those references are simply left out.
 */
export async function getPriceRefs({ expenses = false }: { expenses?: boolean } = {}): Promise<PriceRefs> {
  const supabase = await createClient();
  const [{ data: fuels }, { data: buys }, { data: sold }, { data: avgs }, exp] = await Promise.all([
    supabase.from("fuel_types").select("id, current_selling_price"),
    supabase.from("purchases").select("fuel_type_id, cost_per_litre").is("deleted_at", null).order("created_at", { ascending: false }).limit(300),
    supabase.from("sales_safe").select("fuel_type_id, price_per_litre").order("created_at", { ascending: false }).limit(300),
    supabase.from("tank_costing").select("tank_id, avg_cost_per_litre"),
    expenses
      ? supabase.from("expenses").select("category, amount").is("deleted_at", null).order("created_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: null }),
  ]);

  const refs: PriceRefs = { fuel: {}, tankAvg: {}, expense: {} };
  for (const f of fuels ?? []) refs.fuel[f.id] = { lastCost: null, lastSale: null, pump: Number(f.current_selling_price) || null };
  // Rows come newest first, so the first one seen per fuel is the latest.
  for (const p of buys ?? []) {
    const r = refs.fuel[p.fuel_type_id];
    if (r && r.lastCost === null) r.lastCost = Number(p.cost_per_litre);
  }
  for (const s of sold ?? []) {
    const r = refs.fuel[s.fuel_type_id];
    if (r && r.lastSale === null) r.lastSale = Number(s.price_per_litre);
  }
  for (const a of avgs ?? []) if (Number(a.avg_cost_per_litre) > 0) refs.tankAvg[a.tank_id] = Number(a.avg_cost_per_litre);
  for (const e of exp.data ?? []) if (!(e.category in refs.expense)) refs.expense[e.category] = Number(e.amount);
  return refs;
}
