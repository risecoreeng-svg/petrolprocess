import { requireRole } from "@/lib/auth";
import { getFleetLookups } from "@/lib/fleet-server";
import { createClient } from "@/lib/supabase/server";
import { TRIP_COLUMNS, type Trip } from "@/lib/fleet";
import { TripsClient } from "./trips-client";

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; truck?: string; client?: string }>;
}) {
  const sp = await searchParams;
  const profile = await requireRole("owner", "fleet_manager");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  let q = supabase.from("trips").select(TRIP_COLUMNS).is("deleted_at", null);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.truck) q = q.eq("truck_id", sp.truck);
  if (sp.client) q = q.eq("customer_id", sp.client);

  const [lookups, { data: trips }, profitRes] = await Promise.all([
    getFleetLookups(),
    q.order("date", { ascending: false }).order("trip_no", { ascending: false }).limit(300),
    isOwner ? supabase.from("trip_profit").select("trip_id, profit") : Promise.resolve({ data: null }),
  ]);
  const profit: Record<string, number> = {};
  for (const p of profitRes.data ?? []) profit[p.trip_id] = Number(p.profit);

  return (
    <TripsClient
      trips={(trips ?? []) as Trip[]}
      profit={isOwner ? profit : null}
      filter={{ status: sp.status ?? "", truck: sp.truck ?? "", client: sp.client ?? "" }}
      {...lookups}
    />
  );
}
