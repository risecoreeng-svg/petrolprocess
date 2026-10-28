"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/form-controls";

export type RangeKey = "today" | "week" | "month" | "custom";

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

export function DateRangeFilter({ range, from, to }: { range: RangeKey; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="seg no-scrollbar max-w-full overflow-x-auto" role="tablist" aria-label="Date range">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            role="tab"
            aria-selected={range === o.key}
            onClick={() => go(o.key === "custom" ? { range: "custom", from, to } : { range: o.key })}
            className={cn(range === o.key && "on")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {range === "custom" ? (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From" className="h-11 w-40" value={from} max={to} onChange={(e) => go({ from: e.target.value })} />
          <span className="text-muted">to</span>
          <Input type="date" aria-label="To" className="h-11 w-40" value={to} min={from} onChange={(e) => go({ to: e.target.value })} />
        </div>
      ) : null}
    </div>
  );
}
