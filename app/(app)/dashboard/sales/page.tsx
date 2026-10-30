import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { formatMoney } from "@/lib/currency";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { resolveRange } from "@/lib/range";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDateTime, litres } from "@/lib/utils";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader, Stat } from "@/components/ui/misc";
import { BackToDashboard, keepQuery, NeedsUpdate, periodLabel, type DrillParams } from "../shared";
import { SalesLedger, TripIncomeTable, type LedgerRow, type TripIncomeRow } from "./sales-ledger";

export default async function SalesDrillPage({ searchParams }: { searchParams: Promise<DrillParams & { tab?: string }> }) {
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const sp = await searchParams;
  const { range, from, to } = resolveRange(sp);
  const ctx = await getMoneyContext();
  const disp = displayCurrency(ctx, sp.cur);
  const money = (v: number) => formatMoney(v * disp.rate, disp.code);
  // Trip income is owner-only, and hidden when the dashboard is on Depot.
  const showTrips = isOwner && sp.view !== "depot";
  const tab = showTrips && (sp.tab === "trips" || sp.view === "trucks") ? "trips" : "fuel";
  const supabase = await createClient();

  const [ledgerRes, { data: fuelTypes }, { data: customers }, { data: staff }, tripsRes] = await Promise.all([
    supabase
      .from("sales_ledger")
      .select(
        "id, date, created_at, fuel_type_id, litres, price_per_litre, total, currency, original_price_per_litre, original_total, payment_type, customer_id, payment_ref, attendant_id, shift_id, delivery_date, delivery_status, delivered_at, deleted_at, void_reason",
      )
      .gte("date", from)
      .lte("date", to)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase.from("fuel_types").select("id, name"),
    supabase.from("customers").select("id, name"),
    supabase.from("profiles").select("id, full_name"),
    showTrips
      ? supabase
          .from("trip_financials")
          .select("trip_id, trip_no, report_date, status, truck_id, customer_id, for_own_depot, cargo_type, currency, fee_original, earned_income")
          .eq("status", "delivered")
          .gte("report_date", from)
          .lte("report_date", to)
          .order("report_date", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);

  const shiftIds = [...new Set((ledgerRes.data ?? []).map((s) => s.shift_id).filter(Boolean))] as string[];
  const [{ data: shifts }, { data: trucks }] = await Promise.all([
    shiftIds.length ? supabase.from("shifts").select("id, started_at").in("id", shiftIds) : Promise.resolve({ data: [] as { id: string; started_at: string }[] }),
    showTrips ? supabase.from("trucks").select("id, plate_number") : Promise.resolve({ data: [] as { id: string; plate_number: string }[] }),
  ]);

  const nameOf = <T extends { id: string }>(list: T[] | null, key: keyof T) => {
    const m = new Map((list ?? []).map((x) => [x.id, String(x[key])]));
    return (id: string | null) => (id ? m.get(id) ?? "" : "");
  };
  const fuel = nameOf(fuelTypes, "name");
  const customer = nameOf(customers, "name");
  const person = nameOf(staff, "full_name");
  const truck = nameOf(trucks, "plate_number");
  const shiftStart = new Map((shifts ?? []).map((s) => [s.id, s.started_at]));

  const rows: LedgerRow[] = (ledgerRes.data ?? []).map((s) => ({
    id: s.id,
    date: s.date,
    created_at: s.created_at,
    fuel: fuel(s.fuel_type_id),
    litres: Number(s.litres),
    price: Number(s.price_per_litre),
    original_price: Number(s.original_price_per_litre ?? s.price_per_litre),
    total: Number(s.total),
    original_total: Number(s.original_total ?? s.total),
    currency: s.currency ?? ctx.base,
    payment_type: s.payment_type,
    payment_ref: s.payment_ref,
    customer: customer(s.customer_id) || "Walk-in",
    attendant: person(s.attendant_id),
    shift: s.shift_id && shiftStart.get(s.shift_id) ? `From ${formatDateTime(shiftStart.get(s.shift_id))}` : "",
    delivery_status: s.delivery_status,
    delivery_date: s.delivery_date,
    delivered_at: s.delivered_at,
    voided: !!s.deleted_at,
    void_reason: s.void_reason,
  }));
  const trips: TripIncomeRow[] = (tripsRes.data ?? []).map((t) => ({
    id: t.trip_id,
    trip_no: t.trip_no,
    date: t.report_date,
    truck: truck(t.truck_id),
    client: t.for_own_depot ? "Own depot" : customer(t.customer_id) || "—",
    cargo: t.cargo_type,
    currency: t.currency,
    fee_original: Number(t.fee_original),
    income: Number(t.earned_income),
  }));

  const active = rows.filter((r) => !r.voided);
  const fuelTotal = active.reduce((x, r) => x + r.total, 0);
  const litresSold = active.reduce((x, r) => x + r.litres, 0);
  const byPay = (p: string) => active.filter((r) => r.payment_type === p).reduce((x, r) => x + r.total, 0);
  const tripTotal = trips.reduce((x, t) => x + t.income, 0);
  const headline = sp.view === "trucks" ? tripTotal : fuelTotal + (showTrips ? tripTotal : 0);
  const tabHref = (t: string) => `/dashboard/sales${keepQuery(sp, { tab: t === "trips" ? "trips" : undefined })}`;

  return (
    <>
      <BackToDashboard sp={sp} />
      <PageHeader
        title={
          <>
            {sp.view === "trucks" ? "Trip income" : "Sales"}
            {ledgerRes.error ? null : (
              <span className="ml-[0.25em] tabular-nums [overflow-wrap:anywhere]" title={money(headline)}>
                {money(headline)}
              </span>
            )}
          </>
        }
        description={
          showTrips && sp.view !== "trucks"
            ? `${periodLabel(from, to)} · fuel sales ${money(fuelTotal)} plus truck trips ${money(tripTotal)}`
            : `${periodLabel(from, to)} · deleted sales are listed but not counted`
        }
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
          <CurrencySwitcher current={disp.code} />
        </Suspense>
      </div>

      {ledgerRes.error ? (
        <NeedsUpdate />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Stat label="Sales" value={String(active.length)} sub={rows.length > active.length ? `${rows.length - active.length} deleted` : "none deleted"} />
            <Stat label="Litres sold" value={litres(litresSold)} />
            <Stat label="Average price per litre" value={litresSold ? money(fuelTotal / litresSold) : "—"} />
            <Stat
              label="Cash · mobile · credit"
              value={money(byPay("cash"))}
              sub={`${money(byPay("mobile"))} mobile · ${money(byPay("credit"))} credit`}
            />
          </div>

          {showTrips ? (
            <div className="seg mb-5 w-fit" role="tablist" aria-label="Show">
              {(["fuel", "trips"] as const).map((t) => (
                <Link key={t} href={tabHref(t)} scroll={false} role="tab" aria-selected={tab === t} className={cn(tab === t && "on")}>
                  {t === "fuel" ? `Fuel sales (${active.length})` : `Truck trips (${trips.length})`}
                </Link>
              ))}
            </div>
          ) : null}

          {tab === "trips" ? (
            <TripIncomeTable rows={trips} base={ctx.base} display={{ code: disp.code, rate: disp.rate }} />
          ) : (
            <SalesLedger rows={rows} base={ctx.base} display={{ code: disp.code, rate: disp.rate }} detailQuery={keepQuery(sp)} fileSuffix={`${from}_${to}`} />
          )}
        </>
      )}
    </>
  );
}
