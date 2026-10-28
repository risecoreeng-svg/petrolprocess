// Currency display rules. The database (public.currencies) is the source of truth for which
// currencies exist; this mirrors their formatting so pages can render without a round trip.
// To support another currency, add a row in the database and an entry here.

export type CurrencyInfo = { name: string; decimals: number; symbol: string };

export const CURRENCY_INFO: Record<string, CurrencyInfo> = {
  USD: { name: "US dollar", decimals: 2, symbol: "$" },
  SDG: { name: "Sudanese pound", decimals: 0, symbol: "SDG" },
  SSP: { name: "South Sudanese pound", decimals: 0, symbol: "SSP" },
  KES: { name: "Kenyan shilling", decimals: 2, symbol: "KES" },
};

export function decimalsOf(code: string) {
  return CURRENCY_INFO[code]?.decimals ?? 2;
}

export function currencyName(code: string) {
  return CURRENCY_INFO[code]?.name ?? code;
}

/** "$1,234.56", "SDG 1,234,560", "−$12.00". */
export function formatMoney(amount: number | string | null | undefined, code: string) {
  const n = Number(amount ?? 0);
  const d = decimalsOf(code);
  const digits = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(n));
  const sign = n < 0 ? "−" : "";
  const symbol = CURRENCY_INFO[code]?.symbol ?? code;
  return symbol === "$" ? `${sign}$${digits}` : `${sign}${symbol} ${digits}`;
}

/** A rate as people say it: "1 USD = 2,600 SDG". */
export function describeRate(base: string, code: string, perBase: number) {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: perBase < 10 ? 4 : 2 }).format(perBase);
  return `1 ${base} = ${n} ${code}`;
}

export type RateInfo = { perBase: number; date: string; placeholder: boolean; stale: boolean };

export type MoneyContextValue = {
  base: string;
  enabled: string[];
  /** Latest rate per non-base currency */
  rates: Record<string, RateInfo>;
};

/** Units of `code` per 1 unit of base (1 for the base currency, null if no rate yet). */
export function perBaseOf(ctx: MoneyContextValue, code: string): number | null {
  if (code === ctx.base) return 1;
  return ctx.rates[code]?.perBase ?? null;
}
