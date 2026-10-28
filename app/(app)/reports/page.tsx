import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/range";
import { formatDate } from "@/lib/utils";
import { EXPENSE_CATEGORIES, labelize } from "@/lib/types";
import { DateRangeFilter } from "@/components/date-range-filter";
import { PageHeader } from "@/components/ui/misc";
import { ReportsClient, type Report } from "./reports-client";

type Num = number | string | null;
const n = (v: Num | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const { range, from, to } = resolveRange(sp);
  const supabase = await createClient();

  const [daily, salesRows, purchases, expenses, { data: fuelTypes }, { data: trucks }] = await Promise.all([
    isOwner
      ? supabase.from("daily_summary").select("*").gte("date", from).lte("date", to).order("date")
      : supabase.from("daily_sales_summary").select("*").gte("date", from).lte("date", to).order("date"),
    isOwner
      ? supabase.from("sales").select("fuel_type_id, litres, total, cost_total").is("deleted_at", null).gte("date", from).lte("date", to)
      : supabase.from("sales_safe").select("fuel_type_id, litres, total").gte("date", from).lte("date", to),
    isOwner
      ? supabase
          .from("purchases")
          .select("truck_id, fuel_type_id, litres, fuel_cost, trip_cost, landed_cost_per_litre")
          .is("deleted_at", null)
          .gte("date", from)
          .lte("date", to)
      : supabase.from("purchases_safe").select("truck_id, fuel_type_id, litres").gte("date", from).lte("date", to),
    supabase.from("expenses").select("date, category, amount, truck_id").is("deleted_at", null).gte("date", from).lte("date", to),
    supabase.from("fuel_types").select("id, name, current_selling_price"),
    supabase.from("trucks").select("id, plate_number").is("deleted_at", null).order("plate_number"),
  ]);

  type DailyRow = Record<string, Num> & { date: string };
  const dailyRows = (daily.data ?? []) as DailyRow[];
  const expRows = (expenses.data ?? []) as { date: string; category: string; amount: Num; truck_id: string | null }[];
  const expByDay: Record<string, number> = {};
  for (const e of expRows) expByDay[e.date] = (expByDay[e.date] ?? 0) + n(e.amount);

  // ---- Daily ----
  const dailyReport: Report = isOwner
    ? {
        key: "daily",
        title: "Daily summary",
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "litres", label: "Litres", type: "number" },
          { key: "sales", label: "Sales", type: "kes" },
          { key: "cost_of_fuel", label: "Cost of fuel", type: "kes" },
          { key: "gross_profit", label: "Gross profit", type: "kes" },
          { key: "expenses", label: "Expenses", type: "kes" },
          { key: "net_profit", label: "Net profit", type: "kes" },
        ],
        rows: dailyRows.map((d) => ({
          date: d.date,
          litres: n(d.litres),
          sales: n(d.sales),
          cost_of_fuel: n(d.cost_of_fuel),
          gross_profit: n(d.gross_profit),
          expenses: n(d.expenses),
          net_profit: n(d.net_profit),
        })),
      }
    : {
        key: "daily",
        title: "Daily sales",
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "litres", label: "Litres", type: "number" },
          { key: "cash_sales", label: "Cash", type: "kes" },
          { key: "mpesa_sales", label: "M-Pesa", type: "kes" },
          { key: "credit_sales", label: "Credit", type: "kes" },
          { key: "sales", label: "Total sales", type: "kes" },
          { key: "expenses", label: "Expenses", type: "kes" },
        ],
        rows: [...new Set([...dailyRows.map((d) => d.date), ...Object.keys(expByDay)])].sort().map((date) => {
          const d = dailyRows.find((x) => x.date === date);
          return {
            date,
            litres: n(d?.litres),
            cash_sales: n(d?.cash_sales),
            mpesa_sales: n(d?.mpesa_sales),
            credit_sales: n(d?.credit_sales),
            sales: n(d?.sales),
            expenses: expByDay[date] ?? 0,
          };
        }),
      };

  // ---- Monthly (rolled up from the daily rows in range) ----
  const monthly: Record<string, Record<string, number>> = {};
  for (const row of dailyReport.rows) {
    const m = String(row.date).slice(0, 7);
    monthly[m] ??= {};
    for (const c of dailyReport.columns) {
      if (c.type !== "date") monthly[m][c.key] = r2((monthly[m][c.key] ?? 0) + n(row[c.key] as Num));
    }
  }
  const monthlyReport: Report = {
    key: "monthly",
    title: "Monthly summary",
    columns: [{ key: "month", label: "Month", type: "text" }, ...dailyReport.columns.filter((c) => c.type !== "date")],
    rows: Object.entries(monthly).map(([m, v]) => ({
      month: new Date(`${m}-01T00:00:00`).toLocaleDateString("en-KE", { month: "long", year: "numeric" }),
      ...v,
    })),
  };

  // ---- P&L ----
  const totalSales = dailyRows.reduce((s, d) => s + n(d.sales), 0);
  const cogs = isOwner ? dailyRows.reduce((s, d) => s + n(d.cost_of_fuel), 0) : 0;
  const expByCat: Record<string, number> = {};
  for (const e of expRows) expByCat[e.category] = (expByCat[e.category] ?? 0) + n(e.amount);
  const totalExp = Object.values(expByCat).reduce((s, v) => s + v, 0);
  const plRows: Record<string, string | number>[] = [{ line: "Sales", amount: r2(totalSales) }];
  if (isOwner) {
    plRows.push({ line: "Less: cost of fuel sold", amount: r2(-cogs) }, { line: "Gross profit", amount: r2(totalSales - cogs) });
  }
  for (const c of EXPENSE_CATEGORIES) if (expByCat[c]) plRows.push({ line: `Less: ${labelize(c)}`, amount: r2(-expByCat[c]) });
  plRows.push({ line: "Total expenses", amount: r2(-totalExp) });
  if (isOwner) plRows.push({ line: "Net profit", amount: r2(totalSales - cogs - totalExp) });
  const plReport: Report = {
    key: "pl",
    title: isOwner ? "Profit & loss" : "Sales & expenses statement",
    columns: [
      { key: "line", label: "", type: "text" },
      { key: "amount", label: "KES", type: "kes" },
    ],
    rows: plRows,
    emphasise: ["Gross profit", "Net profit", "Sales"],
  };

  // ---- Per truck (deliveries and expenses within the period) ----
  const price = Object.fromEntries((fuelTypes ?? []).map((f) => [f.id, n(f.current_selling_price)]));
  type P = { truck_id: string; fuel_type_id: string; litres: Num; fuel_cost?: Num; trip_cost?: Num; landed_cost_per_litre?: Num };
  const truckRows = (trucks ?? []).map((t) => {
    const ps = ((purchases.data ?? []) as P[]).filter((p) => p.truck_id === t.id);
    const te = expRows.filter((e) => e.truck_id === t.id);
    const repairs = te.filter((e) => ["truck_repairs", "maintenance"].includes(e.category)).reduce((s, e) => s + n(e.amount), 0);
    const other = te.reduce((s, e) => s + n(e.amount), 0) - repairs;
    const base = {
      truck: t.plate_number,
      deliveries: ps.length,
      litres: r2(ps.reduce((s, p) => s + n(p.litres), 0)),
    };
    if (!isOwner) return { ...base, truck_expenses: r2(repairs + other) };
    const margin = ps.reduce((s, p) => s + n(p.litres) * (price[p.fuel_type_id] - n(p.landed_cost_per_litre)), 0);
    return {
      ...base,
      fuel_cost: r2(ps.reduce((s, p) => s + n(p.fuel_cost), 0)),
      trip_cost: r2(ps.reduce((s, p) => s + n(p.trip_cost), 0)),
      margin: r2(margin),
      repairs: r2(repairs),
      other_costs: r2(other),
      profit: r2(margin - repairs - other),
    };
  });
  const truckReport: Report = {
    key: "truck",
    title: "Per truck",
    note: isOwner ? "Margin = litres delivered × (current pump price − landed cost). Trip cost is inside landed cost." : undefined,
    columns: isOwner
      ? [
          { key: "truck", label: "Truck", type: "text" },
          { key: "deliveries", label: "Trips", type: "number" },
          { key: "litres", label: "Litres", type: "number" },
          { key: "fuel_cost", label: "Fuel cost", type: "kes" },
          { key: "trip_cost", label: "Trip cost", type: "kes" },
          { key: "margin", label: "Margin", type: "kes" },
          { key: "repairs", label: "Repairs", type: "kes" },
          { key: "other_costs", label: "Other", type: "kes" },
          { key: "profit", label: "Profit", type: "kes" },
        ]
      : [
          { key: "truck", label: "Truck", type: "text" },
          { key: "deliveries", label: "Trips", type: "number" },
          { key: "litres", label: "Litres", type: "number" },
          { key: "truck_expenses", label: "Truck expenses", type: "kes" },
        ],
    rows: truckRows,
  };

  // ---- Per fuel type ----
  type S = { fuel_type_id: string; litres: Num; total: Num; cost_total?: Num };
  const fuelRows = (fuelTypes ?? []).map((f) => {
    const ss = ((salesRows.data ?? []) as S[]).filter((s) => s.fuel_type_id === f.id);
    const l = ss.reduce((s, x) => s + n(x.litres), 0);
    const total = ss.reduce((s, x) => s + n(x.total), 0);
    const base = { fuel: f.name, litres: r2(l), sales: r2(total), avg_price: l ? r2(total / l) : 0 };
    if (!isOwner) return base;
    const cost = ss.reduce((s, x) => s + n(x.cost_total), 0);
    return { ...base, cost: r2(cost), gross_profit: r2(total - cost), margin_per_litre: l ? r2((total - cost) / l) : 0 };
  });
  const fuelReport: Report = {
    key: "fuel",
    title: "Per fuel type",
    columns: [
      { key: "fuel", label: "Fuel", type: "text" },
      { key: "litres", label: "Litres sold", type: "number" },
      { key: "sales", label: "Sales", type: "kes" },
      { key: "avg_price", label: "Avg price / L", type: "kes" },
      ...(isOwner
        ? ([
            { key: "cost", label: "Cost of fuel", type: "kes" },
            { key: "gross_profit", label: "Gross profit", type: "kes" },
            { key: "margin_per_litre", label: "Margin / L", type: "kes" },
          ] as const)
        : []),
    ],
    rows: fuelRows,
  };

  const period = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  return (
    <>
      <PageHeader title="Reports" description={period} />
      <div className="mb-4">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
        </Suspense>
      </div>
      <ReportsClient
        reports={[dailyReport, monthlyReport, plReport, truckReport, fuelReport]}
        period={period}
        fileSuffix={`${from}_${to}`}
      />
    </>
  );
}
