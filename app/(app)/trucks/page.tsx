import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FleetDriver, FleetTruck } from "@/lib/fleet";
import { TrucksClient, type TruckPerf } from "./trucks-client";

export default async function TrucksPage() {
  const profile = await requireRole("owner", "manager", "fleet_manager");
  const isOwner = profile.role === "owner";
  const canTrips = profile.role === "owner" || profile.role === "fleet_manager";
  const supabase = await createClient();

  const [{ data: trucks }, { data: drivers }, tripsRes, profitRes, costsRes] = await Promise.all([
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("drivers").select("id, name, phone, licence_no, licence_expiry, profile_id").is("deleted_at", null).order("name"),
    canTrips
      ? supabase.from("trips").select("truck_id, status, litres_delivered").is("deleted_at", null)
      : Promise.resolve({ data: [] as { truck_id: string; status: string; litres_delivered: number | null }[] }),
    // Profit is owner-only (RLS returns nothing to anyone else anyway).
    isOwner ? supabase.from("trip_profit").select("truck_id, profit") : Promise.resolve({ data: null }),
    isOwner ? supabase.from("truck_expenses").select("truck_id, amount").is("deleted_at", null) : Promise.resolve({ data: null }),
  ]);

  const perf: Record<string, TruckPerf> = {};
  for (const t of trucks ?? []) perf[t.id] = { trips: 0, litres: 0, profit: isOwner ? 0 : null };
  for (const t of tripsRes.data ?? []) {
    if (!perf[t.truck_id] || t.status !== "delivered") continue;
    perf[t.truck_id].trips += 1;
    perf[t.truck_id].litres += Number(t.litres_delivered ?? 0);
  }
  if (isOwner) {
    for (const p of profitRes.data ?? []) if (perf[p.truck_id]) perf[p.truck_id].profit! += Number(p.profit);
    for (const x of costsRes.data ?? []) if (perf[x.truck_id]) perf[x.truck_id].profit! -= Number(x.amount);
  }

  return (
    <TrucksClient
      trucks={(trucks ?? []) as FleetTruck[]}
      drivers={(drivers ?? []) as FleetDriver[]}
      perf={perf}
      isOwner={isOwner}
      canTrips={canTrips}
    />
  );
}
