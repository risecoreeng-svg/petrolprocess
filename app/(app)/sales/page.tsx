import { getProfile } from "@/lib/auth";
import { getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";
import { addDays, nairobiToday } from "@/lib/utils";
import type { Customer, FuelType, Supplier, Tank, Truck } from "@/lib/types";
import { SalesClient, type SaleRow } from "./sales-client";

const SALE_COLUMNS =
  "id, date, created_at, tank_id, fuel_type_id, litres, total, currency, original_total, original_price_per_litre, payment_type, customer_id, payment_ref, attendant_id, delivery_date, delivery_status, created_by";

export default async function SalesPage() {
  const profile = await getProfile();
  const canStock = profile.role !== "attendant";
  const supabase = await createClient();
  const today = nairobiToday();

  const [
    money,
    { data: fuelTypes },
    { data: tanks },
    { data: customers },
    { data: sales },
    { data: due },
    { data: recent },
    { data: shift },
    { data: staff },
    suppliersRes,
    trucksRes,
  ] = await Promise.all([
    getMoneyContext(),
    supabase.from("fuel_types").select("*").is("deleted_at", null).order("name"),
    supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
    supabase.from("customers").select("*").is("deleted_at", null).order("name"),
    // sales_safe already limits attendants to their own sales
    supabase.from("sales_safe").select(SALE_COLUMNS).eq("date", today).order("created_at", { ascending: false }),
    supabase.from("sales_safe").select(SALE_COLUMNS).eq("delivery_status", "scheduled").order("delivery_date").limit(100),
    supabase.from("sales_safe").select("currency").gte("date", addDays(today, -30)).limit(1000),
    supabase
      .from("shifts")
      .select("id, started_at")
      .eq("attendant_id", profile.id)
      .is("ended_at", null)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("profiles").select("id, full_name"),
    canStock ? supabase.from("suppliers").select("*").is("deleted_at", null).order("name") : Promise.resolve({ data: [] }),
    canStock ? supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number") : Promise.resolve({ data: [] }),
  ]);

  // Default currency for a new sale: the one this business used most in the last 30 days.
  const counts: Record<string, number> = {};
  for (const r of recent ?? []) counts[r.currency] = (counts[r.currency] ?? 0) + 1;
  const mostUsed =
    Object.entries(counts)
      .filter(([c]) => money.enabled.includes(c))
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? money.base;

  return (
    <SalesClient
      role={profile.role}
      userId={profile.id}
      defaultCurrency={mostUsed}
      fuelTypes={(fuelTypes ?? []) as FuelType[]}
      tanks={(tanks ?? []) as Tank[]}
      customers={(customers ?? []) as Customer[]}
      sales={(sales ?? []) as SaleRow[]}
      due={(due ?? []) as SaleRow[]}
      openShift={shift}
      staff={staff ?? []}
      suppliers={(suppliersRes.data ?? []) as Supplier[]}
      trucks={(trucksRes.data ?? []) as Truck[]}
    />
  );
}
