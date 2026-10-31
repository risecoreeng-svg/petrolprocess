/**
 * Catches prices typed wrong at the moment of entry: a total typed where a per-litre price
 * belongs, a price in the wrong currency, an extra zero. Everything is compared in the base
 * currency (USD). No imports, so the unit tests can run it directly.
 */

/** Warn when a value is more than this many times above or below a reference. */
export const PRICE_FACTOR = 5;

export type PriceRef = {
  /** e.g. "last price", "tank average cost", "pump price", "last rent expense" */
  label: string;
  /** Base currency (USD) */
  value: number | null | undefined;
};

export type PriceWarning = { ratio: number; direction: "higher" | "lower"; ref: PriceRef & { value: number }; message: string };

function times(r: number) {
  return r >= 10 ? `${Math.round(r)}x` : `${Math.round(r * 10) / 10}x`;
}

/**
 * The reference the value is furthest from, if it is more than PRICE_FACTOR times above or
 * below it. `perLitre` changes the wording and adds "/L". Returns null when it looks normal,
 * when there is nothing to compare with, or when the value isn't a positive number.
 */
export function checkPrice(
  valueBase: number,
  refs: PriceRef[],
  opts: { perLitre: boolean; fmt: (base: number) => string },
): PriceWarning | null {
  if (!Number.isFinite(valueBase) || valueBase <= 0) return null;
  let worst: PriceWarning | null = null;
  for (const ref of refs) {
    if (!ref.value || !Number.isFinite(ref.value) || ref.value <= 0) continue;
    const up = valueBase / ref.value;
    const ratio = up >= 1 ? up : 1 / up;
    if (ratio <= PRICE_FACTOR || (worst && ratio <= worst.ratio)) continue;
    const direction = up >= 1 ? "higher" : "lower";
    const unit = opts.perLitre ? "/L" : "";
    const hint = opts.perLitre
      ? direction === "higher"
        ? "Did you enter the total instead of the price per litre, or use the wrong currency?"
        : "Did you enter the price in the wrong currency, or leave out a digit?"
      : direction === "higher"
        ? "Check for an extra zero or the wrong currency."
        : "Check for a missing zero or the wrong currency.";
    worst = {
      ratio,
      direction,
      ref: { label: ref.label, value: ref.value },
      message: `This is ${times(ratio)} ${direction} than your ${ref.label} of ${opts.fmt(ref.value)}${unit}. ${hint}`,
    };
  }
  return worst;
}

/** Reference prices for the entry forms, all in base currency. */
export type PriceRefs = {
  /** Per fuel type: last delivery's fuel price per litre, last sale price per litre, pump price */
  fuel: Record<string, { lastCost: number | null; lastSale: number | null; pump: number | null }>;
  /** Per tank: average cost per litre (owner only; empty for everyone else) */
  tankAvg: Record<string, number>;
  /** Per expense category: the last amount */
  expense: Record<string, number>;
};

export const NO_REFS: PriceRefs = { fuel: {}, tankAvg: {}, expense: {} };
