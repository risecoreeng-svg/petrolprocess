import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TripClientsClient, type ClientBalance, type OpenTrip, type PaymentRow } from "./trip-clients-client";

export default async function TripClientsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  await requireRole("owner", "fleet_manager");
  const supabase = await createClient();
  const [{ data: balances }, { data: payments }, { data: trips }, { data: incomeLines }, { data: customers }] = await Promise.all([
    supabase.from("trip_client_balances").select("*").order("owed", { ascending: false }),
    supabase
      .from("trip_payments")
      .select("id, customer_id, trip_id, date, method, reference, currency, original_amount, amount")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(60),
    supabase
      .from("trips")
      .select("id, trip_no, customer_id, route_from, route_to, delivered_at, fee, currency, fx_rate")
      .eq("status", "delivered")
      .eq("for_own_depot", false)
      .is("deleted_at", null)
      .order("delivered_at", { ascending: false }),
    supabase.from("trip_lines").select("trip_id, amount").eq("kind", "income").is("deleted_at", null),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
  ]);

  // Per-trip outstanding, so a payment can be put against a specific trip.
  const extras: Record<string, number> = {};
  for (const l of incomeLines ?? []) extras[l.trip_id] = (extras[l.trip_id] ?? 0) + Number(l.amount);
  const paidByTrip: Record<string, number> = {};
  for (const p of payments ?? []) if (p.trip_id) paidByTrip[p.trip_id] = (paidByTrip[p.trip_id] ?? 0) + Number(p.amount);
  const openTrips: OpenTrip[] = (trips ?? []).map((t) => ({
    id: t.id,
    trip_no: t.trip_no,
    customer_id: t.customer_id,
    label: `#${t.trip_no} ${t.route_from} → ${t.route_to}`,
    delivered_at: t.delivered_at,
    total: Number(t.fee) + (extras[t.id] ?? 0),
    paid: paidByTrip[t.id] ?? 0,
  }));

  return (
    <TripClientsClient
      balances={(balances ?? []) as ClientBalance[]}
      payments={(payments ?? []) as PaymentRow[]}
      openTrips={openTrips}
      customers={customers ?? []}
      preselect={client ?? ""}
    />
  );
}
