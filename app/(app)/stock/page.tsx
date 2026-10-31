import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FuelType, Tank } from "@/lib/types";
import { getPriceRefs } from "@/lib/price-refs-server";
import { StockClient, type AdjustmentRow } from "./stock-client";

export default async function StockPage() {
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  const [{ data: tanks }, { data: fuelTypes }, { data: adjustments }, { data: values }, { data: staff }, priceRefs] = await Promise.all([
    supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
    supabase.from("fuel_types").select("*").is("deleted_at", null).order("name"),
    supabase.from("stock_adjustments").select("id, tank_id, date, created_at, system_litres, dip_litres, difference, reason, created_by").order("created_at", { ascending: false }).limit(100),
    isOwner ? supabase.from("stock_value").select("tank_id, avg_cost_per_litre, value") : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name"),
    getPriceRefs(),
  ]);

  const valueByTank: Record<string, { avg: number; value: number }> = {};
  for (const v of values ?? []) valueByTank[v.tank_id] = { avg: Number(v.avg_cost_per_litre), value: Number(v.value) };

  return (
    <StockClient
      tanks={(tanks ?? []) as Tank[]}
      fuelTypes={(fuelTypes ?? []) as FuelType[]}
      adjustments={(adjustments ?? []) as AdjustmentRow[]}
      valueByTank={isOwner ? valueByTank : null}
      staff={staff ?? []}
      refs={priceRefs}
    />
  );
}
