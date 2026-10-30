import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MyTripsClient, type DriverTrip, type MyLine } from "./my-trips-client";

// The driver's phone view: own trips only (no fees), add expenses, report delivered litres.
export default async function MyTripsPage() {
  const profile = await requireRole("driver");
  const supabase = await createClient();
  const { data: trips } = await supabase
    .from("driver_trips")
    .select("*")
    .in("status", ["planned", "on_road", "delivered"])
    .order("date", { ascending: false })
    .limit(30);
  const ids = (trips ?? []).map((t) => t.id);
  const [{ data: lines }, { data: fuelTypes }] = await Promise.all([
    ids.length
      ? supabase.from("trip_lines").select("id, trip_id, category, currency, original_amount, description, receipt_path, created_at").in("trip_id", ids).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    supabase.from("fuel_types").select("id, name"),
  ]);
  return (
    <MyTripsClient
      trips={(trips ?? []) as DriverTrip[]}
      lines={(lines ?? []) as MyLine[]}
      fuelTypes={fuelTypes ?? []}
      orgId={profile.org_id}
      name={profile.full_name}
    />
  );
}
