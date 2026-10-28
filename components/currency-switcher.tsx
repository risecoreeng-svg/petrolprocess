"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { describeRate } from "@/lib/currency";
import { useMoney } from "@/components/money-provider";

/** Segmented USD / SDG / SSP… control that sets ?cur=. Currencies without a rate are left out. */
export function CurrencySwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { base, enabled, rates } = useMoney();
  const options = enabled.filter((c) => c === base || rates[c]);
  if (options.length < 2) return null;

  function pick(code: string) {
    const next = new URLSearchParams(params.toString());
    if (code === base) next.delete("cur");
    else next.set("cur", code);
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="seg" role="tablist" aria-label="Show amounts in">
        {options.map((c) => (
          <button key={c} role="tab" aria-selected={current === c} onClick={() => pick(c)} className={cn(current === c && "on")}>
            {c}
          </button>
        ))}
      </div>
      {current !== base && rates[current] ? (
        <span className="text-[13px] text-muted">
          Converted at today&apos;s rate · {describeRate(base, current, rates[current].perBase)}
        </span>
      ) : null}
    </div>
  );
}
