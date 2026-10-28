import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Driver, Truck } from "@/lib/types";
import { TrucksClient, type TruckPerf } from "./trucks-client";

export default async function TrucksPage() {
  const profile = await requireRole("owner", "manager");
  const supabase = await createClient();

  const [{ data: trucks }, { data: drivers }, perf] = await Promise.all([
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("drivers").select("*").is("deleted_at", null).order("name"),
    profile.role === "owner"
      ? supabase.from("truck_performance").select("truck_id, deliveries, litres_brought, profit")
      : supabase.from("purchases_safe").select("truck_id, litres"),
  ]);

  // Managers get delivery counts and litres only; owners also get profit.
  const perfByTruck: Record<string, TruckPerf> = {};
  if (profile.role === "owner") {
    for (const p of (perf.data ?? []) as { truck_id: string; deliveries: number; litres_brought: number; profit: number }[]) {
      perfByTruck[p.truck_id] = { deliveries: Number(p.deliveries), litres: Number(p.litres_brought), profit: Number(p.profit) };
    }
  } else {
    for (const p of (perf.data ?? []) as { truck_id: string; litres: number }[]) {
      const cur = (perfByTruck[p.truck_id] ??= { deliveries: 0, litres: 0, profit: null });
      cur.deliveries += 1;
      cur.litres += Number(p.litres);
    }
  }

  return (
    <TrucksClient
      trucks={(trucks ?? []) as Truck[]}
      drivers={(drivers ?? []) as Driver[]}
      perf={perfByTruck}
      isOwner={profile.role === "owner"}
    />
  );
}
