import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, nairobiToday } from "@/lib/utils";
import { eachDay } from "@/lib/range";

export type TripProfitRow = {
  trip_id: string;
  trip_no: number;
  date: string;
  report_date: string;
  delivered_at: string | null;
  status: string;
  truck_id: string;
  customer_id: string | null;
  for_own_depot: boolean;
  cargo_type: string;
  currency: string;
  earned_income: number;
  trip_expenses: number;
  owner_payout: number;
  profit: number;
  km: number | null;
  profit_per_km: number | null;
  litres_delivered: number | null;
  shortage_litres: number | null;
};

export type TruckPerformance = {
  truck_id: string;
  plate: string;
  trips: number;
  income: number;
  tripExpenses: number;
  payouts: number;
  truckExpenses: number;
  net: number;
  perTrip: number | null;
  km: number;
  perKm: number | null;
  idleDays: number;
  litres: number;
  shortage: number;
};

/** Owner-only numbers (RLS returns nothing to anyone else) for a date range. */
export async function getTruckPerformance(from: string, to: string, truckId?: string) {
  const supabase = await createClient();
  let tp = supabase.from("trip_profit").select("*").gte("report_date", from).lte("report_date", to).neq("status", "planned");
  let tx = supabase.from("truck_expenses").select("truck_id, date, category, amount").is("deleted_at", null).gte("date", from).lte("date", to);
  let busy = supabase.from("trips").select("truck_id, date, delivered_at, status").is("deleted_at", null).neq("status", "planned").lte("date", to);
  if (truckId) {
    tp = tp.eq("truck_id", truckId);
    tx = tx.eq("truck_id", truckId);
    busy = busy.eq("truck_id", truckId);
  }
  const [{ data: trucks }, { data: tripRows }, { data: costs }, { data: busyTrips }] = await Promise.all([
    supabase.from("trucks").select("id, plate_number").is("deleted_at", null).order("plate_number"),
    tp.order("report_date", { ascending: false }),
    tx,
    busy,
  ]);

  const trips = (tripRows ?? []) as TripProfitRow[];
  const today = nairobiToday();
  const days = eachDay(from, to > today ? today : to);
  const perTruck: TruckPerformance[] = (trucks ?? [])
    .filter((t) => !truckId || t.id === truckId)
    .map((t) => {
      const mine = trips.filter((r) => r.truck_id === t.id);
      const delivered = mine.filter((r) => r.status === "delivered");
      const income = mine.reduce((s, r) => s + Number(r.earned_income), 0);
      const tripExpenses = mine.reduce((s, r) => s + Number(r.trip_expenses), 0);
      const payouts = mine.reduce((s, r) => s + Number(r.owner_payout), 0);
      const truckExpenses = (costs ?? []).filter((c) => c.truck_id === t.id).reduce((s, c) => s + Number(c.amount), 0);
      const net = income - tripExpenses - payouts - truckExpenses;
      const km = delivered.reduce((s, r) => s + Number(r.km ?? 0), 0);
      // A day is busy if a trip for this truck was on the road (start date to delivery, or today if still going).
      const busyDays = new Set<string>();
      for (const b of (busyTrips ?? []).filter((x) => x.truck_id === t.id)) {
        const end = b.delivered_at ? b.delivered_at.slice(0, 10) : b.status === "on_road" ? today : b.date;
        for (let d = b.date; d <= end; d = addDays(d, 1)) busyDays.add(d);
      }
      return {
        truck_id: t.id,
        plate: t.plate_number,
        trips: delivered.length,
        income,
        tripExpenses,
        payouts,
        truckExpenses,
        net,
        perTrip: delivered.length ? net / delivered.length : null,
        km,
        perKm: km > 0 ? net / km : null,
        idleDays: days.filter((d) => !busyDays.has(d)).length,
        litres: delivered.filter((r) => r.cargo_type === "fuel").reduce((s, r) => s + Number(r.litres_delivered ?? 0), 0),
        shortage: delivered.reduce((s, r) => s + Math.max(0, Number(r.shortage_litres ?? 0)), 0),
      };
    })
    .sort((a, b) => b.net - a.net);

  return { perTruck, trips, costs: costs ?? [] };
}
