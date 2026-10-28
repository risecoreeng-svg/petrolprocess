"use client";

import { createContext, useContext, useMemo } from "react";
import { formatMoney, perBaseOf, type MoneyContextValue } from "@/lib/currency";

const MoneyContext = createContext<MoneyContextValue>({ base: "USD", enabled: ["USD"], rates: {} });

export function MoneyProvider({ value, children }: { value: MoneyContextValue; children: React.ReactNode }) {
  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

/**
 * money(x): a base-currency amount, formatted in the base currency.
 * fmt(x, code): any amount already in `code`.
 * perBase(code): today's rate (units of code per 1 base), or null if none.
 */
export function useMoney() {
  const ctx = useContext(MoneyContext);
  return useMemo(
    () => ({
      ...ctx,
      money: (amount: number | string | null | undefined) => formatMoney(amount, ctx.base),
      fmt: formatMoney,
      perBase: (code: string) => perBaseOf(ctx, code),
    }),
    [ctx],
  );
}
