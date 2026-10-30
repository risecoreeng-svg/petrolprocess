import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { resolveRange } from "@/lib/range";
import { createClient } from "@/lib/supabase/server";
import { cn, num } from "@/lib/utils";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { DateRangeFilter } from "@/components/date-range-filter";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { BackToDashboard, keepQuery, NeedsUpdate, periodLabel, type DrillParams } from "./shared";

const sum = <T,>(rows: T[] | null, k: keyof T) => (rows ?? []).reduce((x, r) => x + Number(r[k] ?? 0), 0);

/** Depot and truck profit-and-loss totals for the period (owner only; the views return nothing to anyone else). */
async function loadPnl(from: string, to: string) {
  const supabase = await createClient();
  const [depot, trucks] = await Promise.all([
    supabase.from("daily_summary").select("sales, litres, cost_of_fuel, expenses, stock_adjustments, net_profit").gte("date", from).lte("date", to),
    supabase.from("truck_daily_summary").select("income, trip_expenses, payouts, truck_expenses, net_profit").gte("date", from).lte("date", to),
  ]);
  return {
    error: depot.error ?? trucks.error,
    sales: sum(depot.data, "sales"),
    litres: sum(depot.data, "litres"),
    cogs: sum(depot.data, "cost_of_fuel"),
    expenses: sum(depot.data, "expenses"),
    dip: sum(depot.data, "stock_adjustments"),
    depotNet: sum(depot.data, "net_profit"),
    tripIncome: sum(trucks.data, "income"),
    tripCosts: sum(trucks.data, "trip_expenses"),
    payouts: sum(trucks.data, "payouts"),
    truckCosts: sum(trucks.data, "truck_expenses"),
    trucksNet: sum(trucks.data, "net_profit"),
  };
}

type Step = { label: string; explain: string; amount: number; sign: "+" | "−" | "±"; href?: string };
type Group = { title: string; steps: Step[]; result: { label: string; amount: number } };

/**
 * "How this number is calculated": profit or net profit as plain-English steps, each linking to
 * the page that lists what's behind it. Follows the dashboard's Combined / Depot / Trucks view.
 */
export async function PnlBreakdown({ sp, kind }: { sp: DrillParams; kind: "profit" | "net" }) {
  const { range, from, to } = resolveRange(sp);
  const disp = displayCurrency(await getMoneyContext(), sp.cur);
  const money = (v: number) => formatMoney(v * disp.rate, disp.code);
  const p = await loadPnl(from, to);
  const depot = sp.view !== "trucks";
  const trucks = sp.view !== "depot";
  const link = (path: string, extra: Record<string, string | undefined> = {}) => `${path}${keepQuery(sp, extra)}`;
  const net = kind === "net";

  const groups: Group[] = [];
  if (depot) {
    const steps: Step[] = [
      { label: "Fuel sales", explain: `Money from ${num(p.litres)} L sold at the pumps (voided sales left out).`, amount: p.sales, sign: "+", href: link("/dashboard/sales", { view: "depot" }) },
      {
        label: "Cost of fuel sold",
        explain: "Each litre sold × what that litre cost you to buy and bring to the depot (the tank's average cost at the time of sale).",
        amount: -p.cogs,
        sign: "−",
        href: link("/dashboard/stock-value"),
      },
    ];
    if (net) {
      steps.push(
        { label: "Depot running costs", explain: "Rent, salaries, electricity and other depot expenses.", amount: -p.expenses, sign: "−", href: link("/dashboard/expenses", { kind: "depot" }) },
        {
          label: "Dip readings",
          explain: "Fuel found missing (or extra) when the tanks were measured, valued at average cost. Missing fuel lowers profit.",
          amount: p.dip,
          sign: "±",
          href: "/stock",
        },
      );
    }
    groups.push({ title: "Fuel depot", steps, result: { label: net ? "Depot net profit" : "Profit on fuel", amount: net ? p.depotNet : p.sales - p.cogs } });
  }
  if (trucks) {
    const steps: Step[] = [
      { label: "Trip income", explain: "Fees and extras for trips delivered in this period.", amount: p.tripIncome, sign: "+", href: link("/dashboard/sales", { tab: "trips" }) },
      { label: "Trip costs", explain: "Fuel, tolls, food and other costs logged on those trips.", amount: -p.tripCosts, sign: "−", href: "/trips?status=delivered" },
      { label: "Payouts to truck owners", explain: "What hired trucks' owners get for each delivered trip.", amount: -p.payouts, sign: "−", href: "/trucks" },
    ];
    if (net) steps.push({ label: "Truck running costs", explain: "Costs not tied to one trip: salaries, insurance, repairs, tyres, licences.", amount: -p.truckCosts, sign: "−", href: link("/dashboard/expenses", { kind: "truck" }) });
    groups.push({
      title: "Trucks",
      steps,
      result: { label: net ? "Trucks net profit" : "Profit on trips", amount: net ? p.trucksNet : p.tripIncome - p.tripCosts - p.payouts },
    });
  }
  const total = groups.reduce((x, g) => x + g.result.amount, 0);

  // Flag numbers that look like a typing mistake rather than a real loss.
  const costPerLitre = p.litres ? p.cogs / p.litres : 0;
  const pricePerLitre = p.litres ? p.sales / p.litres : 0;
  const suspicious = depot && p.litres > 0 && costPerLitre > pricePerLitre * 3;

  return (
    <>
      <BackToDashboard sp={sp} />
      <PageHeader
        title={
          <>
            {net ? "Net profit" : "Profit"}{" "}
            <span className={cn("tabular-nums [overflow-wrap:anywhere]", total < 0 && "text-orange")} title={money(total)}>
              {money(total)}
            </span>
          </>
        }
        description={`${periodLabel(from, to)} · how this number is worked out, step by step`}
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
          <CurrencySwitcher current={disp.code} />
        </Suspense>
      </div>

      {p.error ? (
        <NeedsUpdate />
      ) : (
        <div className="space-y-5">
          {suspicious ? (
            <div className="flex gap-3 rounded-[var(--radius-tile)] bg-yellow/40 p-4 text-[15px]">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" />
              <p>
                Fuel cost you {money(costPerLitre)} per litre on average but sold for {money(pricePerLitre)}. That usually means a purchase price
                was typed per load instead of per litre, or in the wrong currency.{" "}
                <Link href="/purchases" className="font-medium underline underline-offset-2">
                  Check your purchases
                </Link>
                .
              </p>
            </div>
          ) : null}
          {groups.map((g) => (
            <Card key={g.title}>
              <CardContent className="pt-5 sm:pt-6">
                {groups.length > 1 ? <h2 className="mb-2 text-[17px] font-semibold">{g.title}</h2> : null}
                <ol className="divide-y divide-line">
                  {g.steps.map((s, i) => (
                    <li key={s.label} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">{i + 1}</span>
                      <div className="min-w-0 flex-1 basis-56">
                        {s.href ? (
                          <Link href={s.href} className="group inline-flex items-center gap-1 font-medium hover:underline">
                            {s.label}
                            <ArrowUpRight className="size-3.5 text-muted group-hover:text-fg" />
                          </Link>
                        ) : (
                          <p className="font-medium">{s.label}</p>
                        )}
                        <p className="text-[14px] text-muted">{s.explain}</p>
                      </div>
                      <span className={cn("ml-11 shrink-0 font-medium tabular-nums [overflow-wrap:anywhere] sm:ml-0", s.amount < 0 && "text-orange")}>
                        {s.amount < 0 ? "− " : s.sign === "±" && s.amount > 0 ? "+ " : ""}
                        {money(Math.abs(s.amount))}
                      </span>
                    </li>
                  ))}
                  <li className="flex flex-wrap items-baseline justify-between gap-x-4 pt-3.5">
                    <span className="font-semibold">= {g.result.label}</span>
                    <span className={cn("font-semibold tabular-nums [overflow-wrap:anywhere]", g.result.amount < 0 ? "text-orange" : "text-green")}>
                      {money(g.result.amount)}
                    </span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          ))}
          {groups.length > 1 ? (
            <Card>
              <CardContent className="flex flex-wrap items-baseline justify-between gap-x-4 pt-5 sm:pt-6">
                <span className="text-[17px] font-semibold">
                  {groups.map((g) => g.result.label).join(" + ")} = {net ? "net profit" : "profit"}
                </span>
                <span className={cn("text-[20px] font-semibold tabular-nums [overflow-wrap:anywhere]", total < 0 ? "text-orange" : "text-green")}>{money(total)}</span>
              </CardContent>
            </Card>
          ) : null}
          {!net ? (
            <p className="text-[14px] text-muted">
              Running costs aren&apos;t taken off yet.{" "}
              <Link href={link("/dashboard/net-profit")} className="underline underline-offset-2">
                See net profit
              </Link>
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
