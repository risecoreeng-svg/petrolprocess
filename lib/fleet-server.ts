import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Customer, FuelType, Supplier, Tank } from "@/lib/types";
import type { FleetDriver, FleetTruck } from "@/lib/fleet";

/** Everything the trip forms need to pick from, in one round trip. */
export async function getFleetLookups() {
  const supabase = await createClient();
  const [trucks, drivers, customers, fuelTypes, suppliers, tanks] = await Promise.all([
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("drivers").select("id, name, phone, licence_no, licence_expiry, profile_id").is("deleted_at", null).order("name"),
    supabase.from("customers").select("*").is("deleted_at", null).order("name"),
    supabase.from("fuel_types").select("*").is("deleted_at", null).order("name"),
    supabase.from("suppliers").select("*").is("deleted_at", null).order("name"),
    supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
  ]);
  return {
    trucks: (trucks.data ?? []) as FleetTruck[],
    drivers: (drivers.data ?? []) as FleetDriver[],
    customers: (customers.data ?? []) as Customer[],
    fuelTypes: (fuelTypes.data ?? []) as FuelType[],
    suppliers: (suppliers.data ?? []) as Supplier[],
    tanks: (tanks.data ?? []) as Tank[],
  };
}
