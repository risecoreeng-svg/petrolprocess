"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/form-controls";

export type RangeKey = "today" | "week" | "month" | "custom";

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
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
    router.push(`${pathname}?${next}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-muted p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => go(o.key === "custom" ? { range: "custom", from, to } : { range: o.key })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              range === o.key ? "bg-card font-medium shadow-xs" : "text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {range === "custom" ? (
        <div className="flex gap-2">
          <Input type="date" aria-label="From" className="h-9 w-40" value={from} onChange={(e) => go({ from: e.target.value })} />
          <Input type="date" aria-label="To" className="h-9 w-40" value={to} onChange={(e) => go({ to: e.target.value })} />
        </div>
      ) : null}
    </div>
  );
}
