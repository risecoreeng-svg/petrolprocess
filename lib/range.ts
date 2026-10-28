import { addDays, nairobiToday, startOfMonth } from "@/lib/utils";
import type { RangeKey } from "@/components/date-range-filter";

/** Monday of the week containing isoDate. */
function startOfWeek(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, -((day + 6) % 7));
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Resolves ?range=&from=&to= into concrete dates (Nairobi time). Defaults to this month. */
export function resolveRange(sp: { range?: string; from?: string; to?: string }, fallback: RangeKey = "month") {
  const today = nairobiToday();
  const range = (["today", "week", "month", "custom"].includes(sp.range ?? "") ? sp.range : fallback) as RangeKey;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  switch (range) {
    case "today":
      return { range, from: today, to: today };
    case "week":
      return { range, from: startOfWeek(today), to: today };
    case "custom": {
      const from = sp.from && iso.test(sp.from) ? sp.from : startOfMonth(today);
      const to = sp.to && iso.test(sp.to) ? sp.to : today;
      return { range, from: from <= to ? from : to, to: from <= to ? to : from };
    }
    default:
      return { range: "month" as RangeKey, from: startOfMonth(today), to: today };
  }
}

/**
 * The period to compare against, matched like for like:
 * today → yesterday, this week so far → same days last week,
 * this month so far → same days of last month, custom → the same number of days just before.
 */
export function previousRange(range: RangeKey, from: string, to: string) {
  switch (range) {
    case "today":
      return { from: addDays(from, -1), to: addDays(to, -1), label: "vs yesterday" };
    case "week":
      return { from: addDays(from, -7), to: addDays(to, -7), label: "vs same days last week" };
    case "month": {
      const prevStart = startOfMonth(addDays(from, -1));
      const prevEnd = startOfMonth(addDays(from, -1)).slice(0, 8) + to.slice(8);
      // Clamp e.g. 31 March → 28/29 Feb
      const lastOfPrev = addDays(from, -1);
      return { from: prevStart, to: prevEnd > lastOfPrev ? lastOfPrev : prevEnd, label: "vs same days last month" };
    }
    default: {
      const len = daysBetween(from, to) + 1;
      return { from: addDays(from, -len), to: addDays(from, -1), label: `vs previous ${len} days` };
    }
  }
}

/** Every date between from and to inclusive, so charts show empty days as zero. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Percentage change, or null when the earlier figure is zero (nothing meaningful to compare). */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}
