import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/range";
import { formatDate } from "@/lib/utils";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/ui/misc";
import type { FleetDriver, FleetTruck } from "@/lib/fleet";
import { TruckExpensesClient, type Recurring, type TruckExpense } from "./truck-expenses-client";

export default async function TruckExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; truck?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const profile = await requireRole("owner", "fleet_manager");
  const { range, from, to } = resolveRange(sp);
  const supabase = await createClient();

  // Post any repeating costs that have come due (safe to run on every visit).
  await supabase.rpc("post_recurring_expenses");

  let q = supabase
    .from("truck_expenses")
    .select("id, truck_id, date, category, description, litres, odometer_km, workshop, driver_id, currency, original_amount, amount, receipt_path, recurring_id")
    .is("deleted_at", null)
    .gte("date", from)
    .lte("date", to);
  if (sp.truck) q = q.eq("truck_id", sp.truck);
  if (sp.category) q = q.eq("category", sp.category);

  const [{ data: rows }, { data: recurring }, { data: trucks }, { data: drivers }] = await Promise.all([
    q.order("date", { ascending: false }).order("created_at", { ascending: false }),
    supabase
      .from("truck_recurring_expenses")
      .select("id, truck_id, category, description, driver_id, currency, original_amount, next_due, active")
      .is("deleted_at", null)
      .order("next_due"),
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("drivers").select("id, name, phone, licence_no, licence_expiry, profile_id").is("deleted_at", null).order("name"),
  ]);

  return (
    <>
      <PageHeader
        title="Truck costs"
        description={`Costs not tied to one trip: truck fuel, tyres, insurance, repairs… · ${from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`}`}
      />
      <div className="mb-4">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
        </Suspense>
      </div>
      <TruckExpensesClient
        rows={(rows ?? []) as TruckExpense[]}
        recurring={(recurring ?? []) as Recurring[]}
        trucks={(trucks ?? []) as FleetTruck[]}
        drivers={(drivers ?? []) as FleetDriver[]}
        isOwner={profile.role === "owner"}
        orgId={profile.org_id}
        filter={{ truck: sp.truck ?? "", category: sp.category ?? "" }}
      />
    </>
  );
}
