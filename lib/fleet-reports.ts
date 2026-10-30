import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, nairobiToday } from "@/lib/utils";
import { DOC_TYPES, TRIP_EXPENSE_CATEGORIES, TRUCK_EXPENSE_CATEGORIES, expiryState, type DocType } from "@/lib/fleet";
import { getTruckPerformance } from "@/lib/fleet-performance";
import type { Report } from "@/app/(app)/reports/reports-client";

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Truck Business reports for a date range. Money is base currency (the reports screen converts).
 * Truck profit is only built for the owner; RLS hides staff pay from anyone else.
 */
export async function buildFleetReports(from: string, to: string, isOwner: boolean): Promise<Report[]> {
  const supabase = await createClient();
  const [{ data: trips }, { data: lines }, { data: payments }, { data: costs }, { data: trucks }, { data: drivers }, { data: customers }, { data: fuelTypes }, { data: docs }] =
    await Promise.all([
      supabase
        .from("trips")
        .select("id, trip_no, date, delivered_at, status, truck_id, driver_id, customer_id, for_own_depot, route_from, route_to, cargo_type, fee, fuel_type_id, litres_loaded, litres_delivered, shortage_litres, shortage_pct, haulage_status")
        .is("deleted_at", null)
        .neq("status", "cancelled")
        .lte("date", to)
        .order("date"),
      supabase.from("trip_lines").select("trip_id, kind, category, amount").is("deleted_at", null),
      supabase.from("trip_payments").select("customer_id, trip_id, date, amount").is("deleted_at", null),
      supabase.from("truck_expenses").select("truck_id, date, category, amount").is("deleted_at", null).gte("date", from).lte("date", to),
      supabase.from("trucks").select("id, plate_number"),
      supabase.from("drivers").select("id, name, licence_expiry").is("deleted_at", null),
      supabase.from("customers").select("id, name"),
      supabase.from("fuel_types").select("id, name"),
      supabase.from("truck_documents").select("truck_id, doc_type, reference, expires_on").is("deleted_at", null).order("expires_on", { ascending: false }),
    ]);

  const plate = (id: string) => trucks?.find((t) => t.id === id)?.plate_number ?? "";
  const driverName = (id: string | null) => drivers?.find((d) => d.id === id)?.name ?? "";
  const clientName = (id: string | null, own: boolean) => (own ? "Our depot" : customers?.find((c) => c.id === id)?.name ?? "");
  const fuelName = (id: string | null) => fuelTypes?.find((f) => f.id === id)?.name ?? "";
  const extras: Record<string, number> = {};
  for (const l of lines ?? []) if (l.kind === "income") extras[l.trip_id] = (extras[l.trip_id] ?? 0) + Number(l.amount);
  const deliveredDate = (t: { delivered_at: string | null; date: string }) => (t.delivered_at ? t.delivered_at.slice(0, 10) : t.date);
  const inRange = (d: string) => d >= from && d <= to;

  // ---- Trip statement per client (delivered trips in the period) ----
  const paidByTrip: Record<string, number> = {};
  for (const p of payments ?? []) if (p.trip_id) paidByTrip[p.trip_id] = (paidByTrip[p.trip_id] ?? 0) + Number(p.amount);
  const statementRows = (trips ?? [])
    .filter((t) => t.status === "delivered" && !t.for_own_depot && inRange(deliveredDate(t)))
    .sort((a, b) => clientName(a.customer_id, false).localeCompare(clientName(b.customer_id, false)) || a.trip_no - b.trip_no)
    .map((t) => {
      const income = Number(t.fee) + (extras[t.id] ?? 0);
      const paid = paidByTrip[t.id] ?? 0;
      return {
        client: clientName(t.customer_id, false),
        trip: `#${t.trip_no}`,
        delivered: deliveredDate(t),
        route: `${t.route_from} → ${t.route_to}`,
        litres: t.cargo_type === "fuel" ? Number(t.litres_delivered ?? 0) : 0,
        income: r2(income),
        paid: r2(paid),
        balance: r2(income - paid),
      };
    });
  const unallocated = (payments ?? []).filter((p) => !p.trip_id && inRange(p.date));
  for (const p of unallocated) {
    statementRows.push({ client: clientName(p.customer_id, false), trip: "Payment on account", delivered: p.date, route: "", litres: 0, income: 0, paid: r2(Number(p.amount)), balance: r2(-Number(p.amount)) });
  }
  const statement: Report = {
    key: "trip_statement",
    title: "Trip statement per client",
    note: "Delivered trips in the period with what each client paid against them. Payments on account reduce the balance.",
    columns: [
      { key: "client", label: "Client", type: "text" },
      { key: "trip", label: "Trip", type: "text" },
      { key: "delivered", label: "Delivered", type: "date" },
      { key: "route", label: "Route", type: "text" },
      { key: "litres", label: "Fuel delivered (L)", type: "number" },
      { key: "income", label: "Billed", type: "money" },
      { key: "paid", label: "Paid", type: "money" },
      { key: "balance", label: "Balance", type: "money" },
    ],
    rows: statementRows,
  };

  // ---- Fuel movement report ----
  const fuelRows = (trips ?? [])
    .filter((t) => t.cargo_type === "fuel" && inRange(t.date))
    .map((t) => ({
      date: t.date,
      trip: `#${t.trip_no}`,
      truck: plate(t.truck_id),
      driver: driverName(t.driver_id),
      client: clientName(t.customer_id, t.for_own_depot),
      fuel: fuelName(t.fuel_type_id),
      from: t.route_from,
      to: t.route_to,
      loaded: Number(t.litres_loaded ?? 0),
      delivered: Number(t.litres_delivered ?? 0),
      shortage: Number(t.shortage_litres ?? 0),
      shortage_pct: t.shortage_pct != null ? `${Number(t.shortage_pct).toFixed(2)}%` : "",
      status: t.haulage_status === "disputed" ? "Disputed" : t.haulage_status === "resolved" ? "Resolved" : t.litres_delivered != null ? "OK" : "On the way",
    }));
  const fuelReport: Report = {
    key: "fuel_movements",
    title: "Fuel movements",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "trip", label: "Trip", type: "text" },
      { key: "truck", label: "Truck", type: "text" },
      { key: "driver", label: "Driver", type: "text" },
      { key: "client", label: "Client", type: "text" },
      { key: "fuel", label: "Fuel", type: "text" },
      { key: "from", label: "From", type: "text" },
      { key: "to", label: "To", type: "text" },
      { key: "loaded", label: "Loaded (L)", type: "number" },
      { key: "delivered", label: "Delivered (L)", type: "number" },
      { key: "shortage", label: "Shortage (L)", type: "number" },
      { key: "shortage_pct", label: "Shortage %", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    rows: fuelRows,
  };

  // ---- Expenses by truck and category (trip expenses + truck costs) ----
  const tripTruck: Record<string, { truck: string; date: string }> = {};
  for (const t of trips ?? []) tripTruck[t.id] = { truck: t.truck_id, date: deliveredDate(t) };
  const agg: Record<string, { truck: string; category: string; source: string; amount: number }> = {};
  const add = (truck: string, category: string, source: string, amount: number) => {
    const k = `${truck}|${source}|${category}`;
    agg[k] ??= { truck: plate(truck), category, source, amount: 0 };
    agg[k].amount += amount;
  };
  for (const l of lines ?? []) {
    const tt = tripTruck[l.trip_id];
    if (l.kind !== "expense" || !tt || !inRange(tt.date)) continue;
    add(tt.truck, TRIP_EXPENSE_CATEGORIES[l.category as keyof typeof TRIP_EXPENSE_CATEGORIES] ?? l.category, "Trip", Number(l.amount));
  }
  for (const c of costs ?? []) add(c.truck_id, TRUCK_EXPENSE_CATEGORIES[c.category as keyof typeof TRUCK_EXPENSE_CATEGORIES] ?? c.category, "Truck", Number(c.amount));
  const expensesReport: Report = {
    key: "truck_expenses",
    title: "Expenses by truck",
    note: isOwner ? undefined : "Staff pay is not included.",
    columns: [
      { key: "truck", label: "Truck", type: "text" },
      { key: "source", label: "Type", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "amount", label: "Amount", type: "money" },
    ],
    rows: Object.values(agg)
      .sort((a, b) => a.truck.localeCompare(b.truck) || b.amount - a.amount)
      .map((r) => ({ ...r, amount: r2(r.amount) })),
  };

  // ---- Expiring documents (next 60 days or expired; not tied to the period) ----
  const horizon = addDays(nairobiToday(), 60);
  const seen = new Set<string>();
  const docRows: Record<string, string | number>[] = [];
  for (const d of docs ?? []) {
    const k = `${d.truck_id}:${d.doc_type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (d.expires_on > horizon) continue;
    docRows.push({ who: plate(d.truck_id), document: DOC_TYPES[d.doc_type as DocType], reference: d.reference ?? "", expires: d.expires_on, status: expiryState(d.expires_on) === "expired" ? "Expired" : "Expiring" });
  }
  for (const d of drivers ?? []) {
    if (!d.licence_expiry || d.licence_expiry > horizon) continue;
    docRows.push({ who: d.name, document: "Driving licence", reference: "", expires: d.licence_expiry, status: expiryState(d.licence_expiry) === "expired" ? "Expired" : "Expiring" });
  }
  docRows.sort((a, b) => String(a.expires).localeCompare(String(b.expires)));
  const docsReport: Report = {
    key: "expiring_documents",
    title: "Expiring documents",
    note: "Expired, or expiring in the next 60 days.",
    columns: [
      { key: "who", label: "Truck / driver", type: "text" },
      { key: "document", label: "Document", type: "text" },
      { key: "reference", label: "Reference", type: "text" },
      { key: "expires", label: "Expires", type: "date" },
      { key: "status", label: "Status", type: "text" },
    ],
    rows: docRows,
  };

  const reports = [statement, fuelReport, expensesReport, docsReport];
  if (isOwner) {
    const { perTruck } = await getTruckPerformance(from, to);
    reports.splice(2, 0, {
      key: "truck_profit",
      title: "Truck profit",
      columns: [
        { key: "truck", label: "Truck", type: "text" },
        { key: "trips", label: "Trips", type: "number" },
        { key: "income", label: "Income", type: "money" },
        { key: "trip_costs", label: "Trip costs", type: "money" },
        { key: "payouts", label: "Owner share", type: "money" },
        { key: "truck_costs", label: "Truck costs", type: "money" },
        { key: "net", label: "Net profit", type: "money" },
        { key: "km", label: "km", type: "number" },
        { key: "idle", label: "Idle days", type: "number" },
        { key: "litres", label: "Fuel hauled (L)", type: "number" },
        { key: "shortage", label: "Shortage (L)", type: "number" },
      ],
      rows: perTruck.map((t) => ({
        truck: t.plate,
        trips: t.trips,
        income: r2(t.income),
        trip_costs: r2(t.tripExpenses),
        payouts: r2(t.payouts),
        truck_costs: r2(t.truckExpenses),
        net: r2(t.net),
        km: t.km,
        idle: t.idleDays,
        litres: t.litres,
        shortage: t.shortage,
      })),
    });
  }
  return reports;
}
