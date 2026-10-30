import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/range";
import { formatDate } from "@/lib/utils";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/ui/misc";
import { FuelMovementsClient, type Movement } from "./fuel-movements-client";

export default async function FuelMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; truck?: string; client?: string; fuel?: string }>;
}) {
  const sp = await searchParams;
  await requireRole("owner", "fleet_manager");
  const { range, from, to } = resolveRange(sp);
  const supabase = await createClient();

  let q = supabase
    .from("trips")
    .select(
      "id, trip_no, date, truck_id, driver_id, customer_id, for_own_depot, route_from, route_to, fuel_type_id, litres_loaded, litres_delivered, shortage_litres, shortage_pct, haulage_status, loading_ticket, loaded_from, status",
    )
    .eq("cargo_type", "fuel")
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .gte("date", from)
    .lte("date", to);
  if (sp.truck) q = q.eq("truck_id", sp.truck);
  if (sp.fuel) q = q.eq("fuel_type_id", sp.fuel);
  if (sp.client === "own") q = q.eq("for_own_depot", true);
  else if (sp.client) q = q.eq("customer_id", sp.client);

  const [{ data: rows }, { data: trucks }, { data: drivers }, { data: customers }, { data: fuelTypes }] = await Promise.all([
    q.order("date", { ascending: false }).order("trip_no", { ascending: false }),
    supabase.from("trucks").select("id, plate_number").is("deleted_at", null).order("plate_number"),
    supabase.from("drivers").select("id, name"),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("fuel_types").select("id, name").order("name"),
  ]);

  return (
    <>
      <PageHeader
        title="Fuel movements"
        description={`Fuel your trucks carried, loaded vs delivered · ${from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`}`}
      />
      <div className="mb-4">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
        </Suspense>
      </div>
      <FuelMovementsClient
        rows={(rows ?? []) as Movement[]}
        trucks={trucks ?? []}
        drivers={drivers ?? []}
        customers={customers ?? []}
        fuelTypes={fuelTypes ?? []}
        filter={{ truck: sp.truck ?? "", client: sp.client ?? "", fuel: sp.fuel ?? "" }}
        fileSuffix={`${from}_${to}`}
      />
    </>
  );
}
