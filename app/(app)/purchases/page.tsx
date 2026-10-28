import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FuelType, Supplier, Tank, Truck } from "@/lib/types";
import { PurchasesClient, type DeliveryRow } from "./purchases-client";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ truck?: string; supplier?: string }>;
}) {
  const { truck, supplier } = await searchParams;
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  let history = isOwner
    ? supabase
        .from("purchases")
        .select("id, date, supplier_id, truck_id, tank_id, litres, cost_per_litre, fuel_cost, trip_cost, landed_cost_per_litre")
        .is("deleted_at", null)
    : supabase.from("purchases_safe").select("id, date, supplier_id, truck_id, tank_id, litres");
  if (truck) history = history.eq("truck_id", truck);
  if (supplier) history = history.eq("supplier_id", supplier);

  const [{ data: rows }, { data: trucks }, { data: suppliers }, { data: tanks }, { data: fuelTypes }] = await Promise.all([
    history.order("date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("suppliers").select("*").is("deleted_at", null).order("name"),
    supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
    supabase.from("fuel_types").select("*").is("deleted_at", null),
  ]);

  return (
    <PurchasesClient
      rows={(rows ?? []) as DeliveryRow[]}
      trucks={(trucks ?? []) as Truck[]}
      suppliers={(suppliers ?? []) as Supplier[]}
      tanks={(tanks ?? []) as Tank[]}
      fuelTypes={(fuelTypes ?? []) as FuelType[]}
      isOwner={isOwner}
      filter={{ truck: truck ?? "", supplier: supplier ?? "" }}
    />
  );
}
