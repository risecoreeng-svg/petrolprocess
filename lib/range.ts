import { addDays, nairobiToday, startOfMonth } from "@/lib/utils";
import type { RangeKey } from "@/components/date-range-filter";

/** Resolves ?range=&from=&to= into concrete dates (Nairobi time). Defaults to this month. */
export function resolveRange(sp: { range?: string; from?: string; to?: string }, fallback: RangeKey = "month") {
  const today = nairobiToday();
  const range = (["today", "week", "month", "custom"].includes(sp.range ?? "") ? sp.range : fallback) as RangeKey;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  switch (range) {
    case "today":
      return { range, from: today, to: today };
    case "week":
      return { range, from: addDays(today, -6), to: today };
    case "custom": {
      const from = sp.from && iso.test(sp.from) ? sp.from : startOfMonth(today);
      const to = sp.to && iso.test(sp.to) ? sp.to : today;
      return { range, from: from <= to ? from : to, to: from <= to ? to : from };
    }
    default:
      return { range: "month" as RangeKey, from: startOfMonth(today), to: today };
  }
}

/** Every date between from and to inclusive, so charts show empty days as zero. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);
  return days;
}
