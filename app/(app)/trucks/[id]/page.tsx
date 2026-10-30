import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getTruckPerformance } from "@/lib/fleet-performance";
import { createClient } from "@/lib/supabase/server";
import { addDays, cn, formatDate, litres, nairobiToday, num, startOfMonth } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import {
  CARGO_LABEL,
  DOC_TYPES,
  TRIP_STATUS_LABEL,
  TRIP_STATUS_VARIANT,
  TRUCK_EXPENSE_CATEGORIES,
  TRUCK_STATUS_BADGE,
  TRUCK_STATUS_TEXT,
  reminderState,
  type DocType,
  type FleetTruck,
  type Reminder,
  type TripStatus,
  type TruckExpenseCategory,
} from "@/lib/fleet";
import { ProfitBars } from "@/components/profit-bars";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ExpiryBadge } from "../../documents/documents-client";

export default async function TruckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireRole("owner", "manager", "fleet_manager");
  const isOwner = profile.role === "owner";
  const canTrips = isOwner || profile.role === "fleet_manager";
  const money = (v: number | string | null | undefined) => formatMoney(v, profile.base_currency);
  const supabase = await createClient();

  const { data: truckRow } = await supabase.from("trucks").select("*").eq("id", id).maybeSingle();
  if (!truckRow) notFound();
  const truck = truckRow as FleetTruck;
  const today = nairobiToday();
  const sixMonthsAgo = startOfMonth(addDays(startOfMonth(today), -150));

  const [{ data: driver }, tripsRes, costsRes, { data: docs }, { data: reminders }, { data: deliveries }, { data: customers }, { data: suppliers }, perf] =
    await Promise.all([
      truck.driver_id ? supabase.from("drivers").select("name, phone").eq("id", truck.driver_id).maybeSingle() : Promise.resolve({ data: null }),
      canTrips
        ? supabase
            .from("trips")
            .select("id, trip_no, date, status, route_from, route_to, cargo_type, customer_id, for_own_depot, fee_original, currency, litres_loaded, litres_delivered, shortage_litres, shortage_pct, haulage_status")
            .eq("truck_id", id)
            .is("deleted_at", null)
            .order("date", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
      canTrips
        ? supabase.from("truck_expenses").select("id, date, category, description, currency, original_amount, amount, workshop").eq("truck_id", id).is("deleted_at", null).order("date", { ascending: false }).limit(40)
        : Promise.resolve({ data: [] }),
      supabase.from("truck_documents").select("doc_type, reference, expires_on").eq("truck_id", id).is("deleted_at", null).order("expires_on", { ascending: false }),
      supabase.from("service_reminders").select("id, truck_id, name, every_km, every_days, last_done_km, last_done_on").eq("truck_id", id).is("deleted_at", null),
      supabase.from("purchases").select("id, date, litres, supplier_id, trip_id, fuel_cost, trip_cost").eq("truck_id", id).is("deleted_at", null).order("date", { ascending: false }).limit(20),
      supabase.from("customers").select("id, name"),
      supabase.from("suppliers").select("id, name"),
      isOwner ? getTruckPerformance(sixMonthsAgo, today, id) : Promise.resolve(null),
    ]);

  const trips = (tripsRes.data ?? []) as {
    id: string; trip_no: number; date: string; status: TripStatus; route_from: string; route_to: string; cargo_type: "fuel" | "goods" | "other";
    customer_id: string | null; for_own_depot: boolean; fee_original: number; currency: string; litres_loaded: number | null;
    litres_delivered: number | null; shortage_litres: number | null; shortage_pct: number | null; haulage_status: string | null;
  }[];
  const fuelTrips = trips.filter((t) => t.cargo_type === "fuel");
  const latestDocs = new Map<string, { reference: string | null; expires_on: string }>();
  for (const d of docs ?? []) if (!latestDocs.has(d.doc_type)) latestDocs.set(d.doc_type, d);
  const clientName = (cid: string | null, own: boolean) => (own ? "Our depot" : customers?.find((c) => c.id === cid)?.name ?? "—");

  // Monthly net profit for the chart (owner only)
  const months: { label: string; net: number }[] = [];
  if (perf) {
    for (let m = sixMonthsAgo; m <= today; m = startOfMonth(addDays(m, 32))) {
      const key = m.slice(0, 7);
      const net =
        perf.trips.filter((r) => r.report_date.startsWith(key)).reduce((s, r) => s + Number(r.profit), 0) -
        perf.costs.filter((c) => c.date.startsWith(key)).reduce((s, c) => s + Number(c.amount), 0);
      months.push({ label: new Date(`${m}T00:00:00`).toLocaleDateString("en-GB", { month: "short" }), net });
    }
  }
  const p = perf?.perTruck[0];

  return (
    <>
      <Link href="/trucks" className="mb-3 inline-flex items-center gap-1 text-sm text-muted">
        <ArrowLeft className="size-4" /> Trucks
      </Link>
      <PageHeader
        title={truck.plate_number}
        description={[
          [truck.make_model, truck.year].filter(Boolean).join(" · "),
          driver ? `${driver.name}${driver.phone ? ` (${driver.phone})` : ""}` : "No driver",
          `${num(truck.capacity_litres)} ${truck.capacity_unit === "tonnes" ? "t" : "L"} ${truck.truck_type}`,
          `${num(truck.odometer_km, 0)} km`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={<Badge variant={TRUCK_STATUS_BADGE[truck.status]}>{TRUCK_STATUS_TEXT[truck.status]}</Badge>}
      />
      {truck.ownership === "third_party" ? (
        <p className="-mt-3 mb-5 text-[15px] text-muted">
          Owned by {truck.third_party_owner}: they get{" "}
          {truck.payout_type === "percent_of_fee" ? `${num(truck.payout_value)}% of each trip's income` : `${money(truck.payout_value)} per trip`}.
        </p>
      ) : null}

      {isOwner && p ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Trips (6 months)" value={p.trips} sub={`${p.idleDays} idle days`} />
            <Stat label="Income" value={money(p.income)} />
            <Stat label="All costs" value={money(p.tripExpenses + p.payouts + p.truckExpenses)} />
            <Stat
              label="Net profit"
              value={money(p.net)}
              tone={p.net < 0 ? "negative" : "positive"}
              sub={p.perKm !== null ? `${money(p.perKm)} per km` : undefined}
              tip={<InfoTip>Trip income − trip expenses − the owner&apos;s share (third-party trucks) − truck costs, over the last 6 months.</InfoTip>}
            />
          </div>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Net profit by month</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfitBars data={months} />
            </CardContent>
          </Card>
        </>
      ) : null}

      <div className="grid gap-6 [&>*]:min-w-0">
        {canTrips ? (
          <section>
            <h2 className="card-title mb-3">Trips</h2>
            {trips.length === 0 ? (
              <EmptyState title="No trips yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Trip</TH>
                    <TH>Route</TH>
                    <TH>Client</TH>
                    <TH>Cargo</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Fee</TH>
                  </tr>
                </THead>
                <TBody>
                  {trips.map((t) => (
                    <TR key={t.id}>
                      <TD>
                        <Link href={`/trips/${t.id}`} className="underline-offset-2 hover:underline">
                          #{t.trip_no}
                        </Link>
                        <span className="block text-[13px] text-muted">{formatDate(t.date)}</span>
                      </TD>
                      <TD>
                        {t.route_from} → {t.route_to}
                      </TD>
                      <TD>{clientName(t.customer_id, t.for_own_depot)}</TD>
                      <TD>{CARGO_LABEL[t.cargo_type]}</TD>
                      <TD>
                        <Badge variant={TRIP_STATUS_VARIANT[t.status]}>{TRIP_STATUS_LABEL[t.status]}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{formatMoney(t.fee_original, t.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        ) : null}

        {canTrips && fuelTrips.length > 0 ? (
          <section>
            <h2 className="card-title mb-3">Fuel movements</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>For</TH>
                  <TH className="text-right">Loaded</TH>
                  <TH className="text-right">Delivered</TH>
                  <TH className="text-right">Shortage</TH>
                </tr>
              </THead>
              <TBody>
                {fuelTrips.map((t) => (
                  <TR key={t.id}>
                    <TD>{formatDate(t.date)}</TD>
                    <TD>{clientName(t.customer_id, t.for_own_depot)}</TD>
                    <TD className="text-right tabular-nums">{litres(t.litres_loaded)}</TD>
                    <TD className="text-right tabular-nums">{t.litres_delivered != null ? litres(t.litres_delivered) : "—"}</TD>
                    <TD className={cn("text-right tabular-nums", t.haulage_status === "disputed" && "font-semibold text-orange")}>
                      {t.shortage_litres != null ? `${num(t.shortage_litres)} L · ${num(t.shortage_pct, 2)}%` : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader className="flex-row items-center">
              <CardTitle>Documents and services</CardTitle>
              <Link href="/documents" className="ml-auto text-sm underline underline-offset-2">
                Manage
              </Link>
            </CardHeader>
            <CardContent className="grid gap-2">
              {(Object.keys(DOC_TYPES) as DocType[]).map((type) => {
                const d = latestDocs.get(type);
                if (!d && type === "other") return null;
                return (
                  <div key={type} className="flex items-center justify-between gap-2 text-[15px]">
                    <span>{DOC_TYPES[type]}</span>
                    <ExpiryBadge date={d?.expires_on ?? null} />
                  </div>
                );
              })}
              {((reminders ?? []) as Reminder[]).map((r) => {
                const s = reminderState(r, Number(truck.odometer_km));
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 border-t border-line pt-2 text-[15px]">
                    <span>{r.name}</span>
                    {s.overdue ? <Badge variant="destructive">Due now</Badge> : s.soon ? <Badge variant="warning">Due soon</Badge> : <Badge>OK</Badge>}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {canTrips ? (
            <Card>
              <CardHeader className="flex-row items-center">
                <CardTitle>Truck costs</CardTitle>
                <Link href={`/truck-expenses?truck=${id}`} className="ml-auto text-sm underline underline-offset-2">
                  All
                </Link>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(costsRes.data ?? []).length === 0 ? <p className="text-[15px] text-muted">No costs recorded.</p> : null}
                {(costsRes.data ?? []).slice(0, 8).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-[15px]">
                    <span className="min-w-0 truncate">
                      {TRUCK_EXPENSE_CATEGORIES[c.category as TruckExpenseCategory]}
                      <span className="text-muted"> · {formatDate(c.date)}{c.workshop ? ` · ${c.workshop}` : ""}</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(c.original_amount, c.currency)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {(deliveries ?? []).length > 0 ? (
          <section>
            <h2 className="card-title mb-3">Fuel brought to our depot</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Supplier</TH>
                  <TH className="text-right">Litres</TH>
                  <TH className="text-right">What it cost</TH>
                </tr>
              </THead>
              <TBody>
                {deliveries!.map((d) => (
                  <TR key={d.id}>
                    <TD>{formatDate(d.date)}</TD>
                    <TD>{suppliers?.find((s) => s.id === d.supplier_id)?.name ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{num(d.litres)}</TD>
                    <TD className="text-right tabular-nums">{money(Number(d.fuel_cost) + Number(d.trip_cost))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        ) : null}
      </div>
    </>
  );
}
