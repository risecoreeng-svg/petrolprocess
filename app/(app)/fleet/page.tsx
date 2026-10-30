import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { getTruckPerformance } from "@/lib/fleet-performance";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/range";
import { cn, formatDate, litres, num } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { DateRangeFilter } from "@/components/date-range-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function FleetPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; cur?: string }>;
}) {
  await requireRole("owner");
  const sp = await searchParams;
  const { range, from, to } = resolveRange(sp);
  const disp = displayCurrency(await getMoneyContext(), sp.cur);
  const money = (v: number | null | undefined) => formatMoney(Number(v ?? 0) * disp.rate, disp.code);
  const supabase = await createClient();
  const [{ perTruck, trips }, { data: customers }, { data: trucks }] = await Promise.all([
    getTruckPerformance(from, to),
    supabase.from("customers").select("id, name"),
    supabase.from("trucks").select("id, plate_number"),
  ]);
  const totals = perTruck.reduce(
    (a, t) => ({ trips: a.trips + t.trips, income: a.income + t.income, costs: a.costs + t.tripExpenses + t.payouts + t.truckExpenses, net: a.net + t.net, litres: a.litres + t.litres, shortage: a.shortage + t.shortage }),
    { trips: 0, income: 0, costs: 0, net: 0, litres: 0, shortage: 0 },
  );
  const maxAbs = Math.max(1, ...perTruck.map((t) => Math.abs(t.net)));
  const plate = (id: string) => trucks?.find((t) => t.id === id)?.plate_number ?? "";
  const client = (id: string | null, own: boolean) => (own ? "Our depot" : customers?.find((c) => c.id === id)?.name ?? "—");

  return (
    <>
      <PageHeader title="Truck performance" description={`What each truck earned and cost · ${from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`}`} />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
          <CurrencySwitcher current={disp.code} />
        </Suspense>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Trips delivered" value={totals.trips} />
        <Stat label="Income" value={money(totals.income)} />
        <Stat
          label="Costs"
          value={money(totals.costs)}
          tip={<InfoTip>Trip expenses, what third-party truck owners get, and truck costs (fuel for the truck, repairs, insurance, salaries…).</InfoTip>}
        />
        <Stat label="Net profit" value={money(totals.net)} tone={totals.net < 0 ? "negative" : "positive"} />
      </div>

      {perTruck.length === 0 ? (
        <EmptyState title="No trucks yet" />
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Ranking by net profit</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {perTruck.map((t, i) => (
                <Link key={t.truck_id} href={`/trucks/${t.truck_id}`} className="grid grid-cols-[2rem_6.5rem_1fr_auto] items-center gap-3 text-[15px]">
                  <span className="text-muted">{i + 1}</span>
                  <span className="truncate font-medium">{t.plate}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={cn("block h-full rounded-full", t.net < 0 ? "bg-orange" : "bg-green")}
                      style={{ width: `${(Math.abs(t.net) / maxAbs) * 100}%` }}
                    />
                  </span>
                  <span className={cn("text-right font-semibold tabular-nums", t.net < 0 && "text-orange")}>{money(t.net)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Table>
            <THead>
              <tr>
                <TH>Truck</TH>
                <TH className="text-right">Trips</TH>
                <TH className="text-right">Income</TH>
                <TH className="text-right">Trip costs</TH>
                <TH className="text-right">Owner share</TH>
                <TH className="text-right">Truck costs</TH>
                <TH className="text-right">Net profit</TH>
                <TH className="text-right">Per trip</TH>
                <TH className="text-right">Per km</TH>
                <TH className="text-right">
                  <span className="inline-flex items-center gap-1.5">
                    Idle days
                    <InfoTip>Days in this period with no trip on the road.</InfoTip>
                  </span>
                </TH>
                <TH className="text-right">Fuel hauled</TH>
                <TH className="text-right">Shortage</TH>
              </tr>
            </THead>
            <TBody>
              {perTruck.map((t) => (
                <TR key={t.truck_id}>
                  <TD className="font-medium">
                    <Link href={`/trucks/${t.truck_id}`} className="underline-offset-2 hover:underline">
                      {t.plate}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{t.trips}</TD>
                  <TD className="text-right tabular-nums">{money(t.income)}</TD>
                  <TD className="text-right tabular-nums">{money(t.tripExpenses)}</TD>
                  <TD className="text-right tabular-nums">{t.payouts ? money(t.payouts) : "—"}</TD>
                  <TD className="text-right tabular-nums">{money(t.truckExpenses)}</TD>
                  <TD className={cn("text-right font-semibold tabular-nums", t.net < 0 && "text-orange")}>{money(t.net)}</TD>
                  <TD className="text-right tabular-nums">{t.perTrip !== null ? money(t.perTrip) : "—"}</TD>
                  <TD className="text-right tabular-nums">{t.perKm !== null ? money(t.perKm) : "—"}</TD>
                  <TD className="text-right tabular-nums">{t.idleDays}</TD>
                  <TD className="text-right tabular-nums">{litres(t.litres)}</TD>
                  <TD className="text-right tabular-nums">{t.shortage ? litres(t.shortage) : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <section>
            <h2 className="card-title mb-3">Per trip</h2>
            {trips.length === 0 ? (
              <EmptyState title="No trips in this period" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Trip</TH>
                    <TH>Truck</TH>
                    <TH>Client</TH>
                    <TH className="text-right">Income</TH>
                    <TH className="text-right">Costs</TH>
                    <TH className="text-right">Profit</TH>
                    <TH className="text-right">km</TH>
                    <TH className="text-right">Per km</TH>
                  </tr>
                </THead>
                <TBody>
                  {trips.map((r) => (
                    <TR key={r.trip_id}>
                      <TD>
                        <Link href={`/trips/${r.trip_id}`} className="underline-offset-2 hover:underline">
                          #{r.trip_no}
                        </Link>
                        <span className="block text-[13px] text-muted">
                          {formatDate(r.report_date)}
                          {r.status !== "delivered" ? ` · ${r.status === "on_road" ? "on the road" : r.status}` : ""}
                        </span>
                      </TD>
                      <TD>{plate(r.truck_id)}</TD>
                      <TD>{client(r.customer_id, r.for_own_depot)}</TD>
                      <TD className="text-right tabular-nums">{money(r.earned_income)}</TD>
                      <TD className="text-right tabular-nums">{money(Number(r.trip_expenses) + Number(r.owner_payout))}</TD>
                      <TD className={cn("text-right font-semibold tabular-nums", Number(r.profit) < 0 && "text-orange")}>{money(r.profit)}</TD>
                      <TD className="text-right tabular-nums">{r.km ? num(r.km, 0) : "—"}</TD>
                      <TD className="text-right tabular-nums">{r.profit_per_km !== null ? money(r.profit_per_km) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </>
  );
}
