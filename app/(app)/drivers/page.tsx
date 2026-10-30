import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { startOfMonth, nairobiToday } from "@/lib/utils";
import type { FleetDriver, FleetTruck } from "@/lib/fleet";
import { DriversClient, type DriverStats } from "./drivers-client";

export default async function DriversPage() {
  const profile = await requireRole("owner", "fleet_manager");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();
  const monthStart = startOfMonth(nairobiToday());

  const [{ data: drivers }, { data: trucks }, { data: trips }, payLines, salaries] = await Promise.all([
    supabase.from("drivers").select("id, name, phone, licence_no, licence_expiry, profile_id").is("deleted_at", null).order("name"),
    supabase.from("trucks").select("*").is("deleted_at", null),
    supabase.from("trips").select("driver_id, status").is("deleted_at", null),
    // Pay is owner-only: RLS returns nothing to a fleet manager, and we don't even ask.
    isOwner
      ? supabase.from("trip_lines").select("driver_id, amount, created_at").eq("category", "driver_pay").is("deleted_at", null)
      : Promise.resolve({ data: null }),
    isOwner
      ? supabase.from("truck_expenses").select("driver_id, amount, date").eq("category", "driver_salary").is("deleted_at", null)
      : Promise.resolve({ data: null }),
  ]);

  const stats: Record<string, DriverStats> = {};
  for (const d of drivers ?? []) stats[d.id] = { trips: 0, onRoad: 0, paidMonth: isOwner ? 0 : null, paidTotal: isOwner ? 0 : null };
  for (const t of trips ?? []) {
    const s = t.driver_id ? stats[t.driver_id] : null;
    if (!s) continue;
    if (t.status === "delivered") s.trips += 1;
    if (t.status === "on_road") s.onRoad += 1;
  }
  for (const l of payLines.data ?? []) {
    const s = l.driver_id ? stats[l.driver_id] : null;
    if (!s) continue;
    s.paidTotal! += Number(l.amount);
    if (l.created_at.slice(0, 10) >= monthStart) s.paidMonth! += Number(l.amount);
  }
  for (const x of salaries.data ?? []) {
    const s = x.driver_id ? stats[x.driver_id] : null;
    if (!s) continue;
    s.paidTotal! += Number(x.amount);
    if (x.date >= monthStart) s.paidMonth! += Number(x.amount);
  }

  return <DriversClient drivers={(drivers ?? []) as FleetDriver[]} trucks={(trucks ?? []) as FleetTruck[]} stats={stats} isOwner={isOwner} />;
}
