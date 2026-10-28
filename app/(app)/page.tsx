import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { eachDay, resolveRange } from "@/lib/range";
import { formatDate, kes, litres } from "@/lib/utils";
import type { Tank } from "@/lib/types";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SalesExpensesChart } from "@/components/sales-expenses-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const profile = await getProfile();
  if (profile.role === "attendant") redirect("/sales");
  const isOwner = profile.role === "owner";
  const { range, from, to } = resolveRange(await searchParams);
  const supabase = await createClient();

  const [summaryRes, expensesRes, { data: trucks }, { data: tanks }, { data: balances }, stockRes] = await Promise.all([
    // Owner: full P&L per day. Manager: sales only (no cost or profit columns).
    isOwner
      ? supabase.from("daily_summary").select("date, sales, cost_of_fuel, gross_profit, expenses, net_profit").gte("date", from).lte("date", to)
      : supabase.from("daily_sales_summary").select("date, sales").gte("date", from).lte("date", to),
    isOwner
      ? Promise.resolve({ data: null })
      : supabase.from("expenses").select("date, amount").is("deleted_at", null).gte("date", from).lte("date", to),
    supabase.from("trucks").select("id, status").is("deleted_at", null),
    supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
    supabase.from("customer_balances").select("balance, overdue"),
    isOwner ? supabase.from("stock_value").select("value") : Promise.resolve({ data: null }),
  ]);

  type Day = { date: string; sales: number; cost_of_fuel?: number; gross_profit?: number; expenses?: number; net_profit?: number };
  const days = (summaryRes.data ?? []) as Day[];
  const expByDay: Record<string, number> = {};
  if (isOwner) for (const d of days) expByDay[d.date] = Number(d.expenses ?? 0);
  else for (const e of expensesRes.data ?? []) expByDay[e.date] = (expByDay[e.date] ?? 0) + Number(e.amount);

  const sum = (k: keyof Day) => days.reduce((s, d) => s + Number(d[k] ?? 0), 0);
  const sales = sum("sales");
  const expenses = Object.values(expByDay).reduce((s, v) => s + v, 0);
  const salesByDay = Object.fromEntries(days.map((d) => [d.date, Number(d.sales)]));
  const chart = eachDay(from, to).map((date) => ({ date, sales: salesByDay[date] ?? 0, expenses: expByDay[date] ?? 0 }));

  const truckCount = trucks?.length ?? 0;
  const activeTrucks = trucks?.filter((t) => t.status === "active").length ?? 0;
  const owed = (balances ?? []).reduce((s, b) => s + Math.max(0, Number(b.balance)), 0);
  const overdue = (balances ?? []).reduce((s, b) => s + Number(b.overdue), 0);
  const stockValue = (stockRes.data ?? []).reduce((s, v) => s + Number(v.value), 0);
  const lowTanks = ((tanks ?? []) as Tank[]).filter((t) => Number(t.current_litres) <= Number(t.low_stock_level));

  const periodLabel = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  return (
    <>
      <PageHeader title="Dashboard" description={periodLabel} />
      <div className="mb-4">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
        </Suspense>
      </div>

      {lowTanks.length > 0 ? (
        <Link
          href="/stock"
          className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-red-50 p-4 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Low stock</p>
            <p>
              {lowTanks.map((t) => `${t.name}: ${litres(t.current_litres)} (alert at ${litres(t.low_stock_level)})`).join(" · ")}
            </p>
          </div>
        </Link>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={kes(sales)} />
        {isOwner ? (
          <>
            <Stat label="Cost of fuel" value={kes(sum("cost_of_fuel"))} sub="Weighted avg landed cost" />
            <Stat label="Gross profit" value={kes(sum("gross_profit"))} tone={sum("gross_profit") >= 0 ? "positive" : "negative"} />
          </>
        ) : null}
        <Stat label="Expenses" value={kes(expenses)} />
        {isOwner ? (
          <Stat label="Net profit" value={kes(sum("net_profit"))} tone={sum("net_profit") >= 0 ? "positive" : "negative"} />
        ) : null}
        <Stat label="Trucks" value={truckCount} sub={`${activeTrucks} active`} />
        {isOwner ? <Stat label="Stock value" value={kes(stockValue)} sub="Litres × landed cost" /> : null}
        <Stat label="Money owed" value={kes(owed)} sub={overdue > 0 ? `${kes(overdue)} overdue` : "Nothing overdue"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales vs expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesExpensesChart data={chart} />
        </CardContent>
      </Card>
    </>
  );
}
