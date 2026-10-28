"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { kes } from "@/lib/utils";

// Validated colour-blind-safe pair on the cream surface: sales = blue, expenses = orange.
const SALES = "var(--color-chart-sales)";
const EXPENSES = "var(--color-chart-expenses)";

export type ChartPoint = { date: string; sales: number; expenses: number };

const short = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;

export function SalesExpensesChart({ data }: { data: ChartPoint[] }) {
  if (data.every((d) => !d.sales && !d.expenses)) {
    return <p className="py-16 text-center text-[15px] text-muted">No sales or expenses in this period yet.</p>;
  }
  const points = data.map((d) => ({
    ...d,
    label: new Date(`${d.date}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" }),
  }));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <span className="flex items-center gap-2">
          <i className="inline-block size-2.5 rounded-[3px]" style={{ background: SALES }} /> Money in (sales)
        </span>
        <span className="flex items-center gap-2">
          <i className="inline-block size-2.5 rounded-[3px]" style={{ background: EXPENSES }} /> Money out (expenses)
        </span>
      </div>
      <div className="h-64 w-full nav:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} barGap={2} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(28,28,26,0.07)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#6f6b63" minTickGap={14} />
            <YAxis tickFormatter={short} tickLine={false} axisLine={false} fontSize={12} stroke="#6f6b63" width={44} />
            <Tooltip
              cursor={{ fill: "rgba(28,28,26,0.04)" }}
              formatter={(value, name) => [kes(Number(value)), name === "sales" ? "Money in" : "Money out"]}
              contentStyle={{ borderRadius: 14, border: "none", boxShadow: "var(--shadow-lift)", fontSize: 13, background: "#fff" }}
            />
            <Bar dataKey="sales" fill={SALES} radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Bar dataKey="expenses" fill={EXPENSES} radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
