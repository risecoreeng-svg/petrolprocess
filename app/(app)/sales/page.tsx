import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { nairobiToday } from "@/lib/utils";
import type { Customer, FuelType, Tank } from "@/lib/types";
import { SalesClient, type SaleRow } from "./sales-client";

export default async function SalesPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const today = nairobiToday();

  const [{ data: fuelTypes }, { data: tanks }, { data: customers }, { data: sales }, { data: shift }, { data: staff }] =
    await Promise.all([
      supabase.from("fuel_types").select("*").is("deleted_at", null).order("name"),
      supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
      supabase.from("customers").select("*").is("deleted_at", null).order("name"),
      // sales_safe already limits attendants to their own sales
      supabase.from("sales_safe").select("*").eq("date", today).order("created_at", { ascending: false }),
      supabase
        .from("shifts")
        .select("id, started_at")
        .eq("attendant_id", profile.id)
        .is("ended_at", null)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase.from("profiles").select("id, full_name"),
    ]);

  return (
    <SalesClient
      role={profile.role}
      fuelTypes={(fuelTypes ?? []) as FuelType[]}
      tanks={(tanks ?? []) as Tank[]}
      customers={(customers ?? []) as Customer[]}
      sales={(sales ?? []) as SaleRow[]}
      openShift={shift}
      staff={staff ?? []}
    />
  );
}
