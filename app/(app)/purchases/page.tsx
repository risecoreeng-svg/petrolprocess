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
  // Owner and sales manager both see what stock cost; RLS enforces it.
  const profile = await requireRole("owner", "manager");
  const supabase = await createClient();

  let history = supabase
    .from("purchases")
    .select(
      "id, date, supplier_id, truck_id, tank_id, fuel_type_id, litres, currency, original_total, fuel_cost, trip_cost, landed_cost_per_litre",
    )
    .is("deleted_at", null);
  if (truck) history = history.eq("truck_id", truck);
  if (supplier) history = history.eq("supplier_id", supplier);

  const [{ data: rows }, { data: trucks }, { data: suppliers }, { data: tanks }, { data: fuelTypes }] = await Promise.all([
    history.order("date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("suppliers").select("*").is("deleted_at", null).order("name"),
    supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
    supabase.from("fuel_types").select("*").is("deleted_at", null).order("name"),
  ]);

  return (
    <PurchasesClient
      rows={(rows ?? []) as DeliveryRow[]}
      trucks={(trucks ?? []) as Truck[]}
      suppliers={(suppliers ?? []) as Supplier[]}
      tanks={(tanks ?? []) as Tank[]}
      fuelTypes={(fuelTypes ?? []) as FuelType[]}
      isOwner={profile.role === "owner"}
      filter={{ truck: truck ?? "", supplier: supplier ?? "" }}
    />
  );
}
