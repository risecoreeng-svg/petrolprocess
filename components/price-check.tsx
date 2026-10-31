"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { checkPrice, type PriceRef } from "@/lib/price-check";
import { useMoney } from "@/components/money-provider";

/**
 * Warning for an unusual price plus the confirm tick it needs. `ok` is false while a warning
 * shows and the tick isn't ticked. The tick belongs to one message, so a new warning needs a new tick.
 */
export function usePriceCheck(valueBase: number, refs: PriceRef[], perLitre: boolean) {
  const { money } = useMoney();
  const warning = checkPrice(valueBase, refs, { perLitre, fmt: money });
  const message = warning?.message ?? null;
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const ok = !message || confirmed === message;
  const node = message ? (
    <div className="grid gap-2 rounded-[var(--radius-inner)] border border-orange/40 bg-orange/10 p-3 text-[14px]" role="alert">
      <p className="flex gap-2 font-medium text-orange">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      <label className="flex items-center gap-2.5 font-medium">
        <input
          type="checkbox"
          className="size-5 accent-black"
          checked={confirmed === message}
          onChange={(e) => setConfirmed(e.target.checked ? message : null)}
        />
        Yes, this is correct
      </label>
    </div>
  ) : null;
  return { ok, node, warning };
}

/** Error shown when someone saves without ticking the confirm box. */
export const CONFIRM_FIRST = "Check the unusual price above and tick to confirm it";

/**
 * Per-litre price and total side by side, in the chosen currency and in the base currency.
 * Pass `total` null for a price with no quantity (a pump price), `perLitre` null for an amount.
 */
export function PriceSummary({ perLitre, total, currency, label = "Total" }: { perLitre: number | null; total: number | null; currency: string; label?: string }) {
  const { base, perBase, money, fmt } = useMoney();
  const rate = perBase(currency);
  const both = (v: number) => (
    <span className="tabular-nums">
      <span className="font-semibold">{fmt(v, currency)}</span>
      {currency !== base && rate ? <span className="block text-[13px] text-muted">{money(v / rate)}</span> : null}
    </span>
  );
  return (
    <div className="inner-box grid grid-cols-2 gap-3 text-[15px]">
      {perLitre !== null ? (
        <div>
          <p className="text-[13px] text-muted">Per litre</p>
          {both(perLitre)}
        </div>
      ) : null}
      {total !== null ? (
        <div className={perLitre === null ? "col-span-2" : ""}>
          <p className="text-[13px] text-muted">{label}</p>
          {both(total)}
        </div>
      ) : null}
    </div>
  );
}
