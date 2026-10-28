"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { kes } from "@/lib/utils";

// Validated categorical pair (CVD-safe): sales = blue, expenses = orange.
const SALES = "#2f6fd6";
const EXPENSES = "#e0662b";

export type ChartPoint = { date: string; sales: number; expenses: number };

const short = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;

export function SalesExpensesChart({ data }: { data: ChartPoint[] }) {
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No sales or expenses in this period.</p>;
  }
  const points = data.map((d) => ({
    ...d,
    label: new Date(`${d.date}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" }),
  }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} barGap={2} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={12} />
          <YAxis tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={44} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            formatter={(value, name) => [kes(Number(value)), name === "sales" ? "Sales" : "Expenses"]}
            contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            formatter={(v) => <span className="text-xs text-foreground">{v === "sales" ? "Sales" : "Expenses"}</span>}
          />
          <Bar dataKey="sales" fill={SALES} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenses" fill={EXPENSES} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
