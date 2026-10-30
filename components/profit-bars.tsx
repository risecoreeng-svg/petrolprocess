"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMoney } from "@/components/money-provider";

const short = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`;

/** Net profit per month: green above zero, orange below (the label and value also say it). */
export function ProfitBars({ data }: { data: { label: string; net: number }[] }) {
  const { money } = useMoney();
  if (data.every((d) => !d.net)) return <p className="py-10 text-center text-[15px] text-muted">No trips or costs in the last 6 months.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(28,28,26,0.07)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#6f6b63" />
          <YAxis tickFormatter={short} tickLine={false} axisLine={false} fontSize={12} stroke="#6f6b63" width={44} />
          <Tooltip
            cursor={{ fill: "rgba(28,28,26,0.04)" }}
            formatter={(v) => [money(Number(v)), "Net profit"]}
            contentStyle={{ borderRadius: 14, border: "none", boxShadow: "var(--shadow-lift)", fontSize: 13, background: "#fff" }}
          />
          <Bar dataKey="net" radius={[4, 4, 4, 4]} maxBarSize={36}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.net < 0 ? "var(--color-orange)" : "var(--color-green)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
