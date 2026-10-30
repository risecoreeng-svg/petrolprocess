import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { formatMoney } from "@/lib/currency";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";
import { cn, litres } from "@/lib/utils";
import { Suspense } from "react";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BackToDashboard, type DrillParams } from "../shared";

/** Owner only: what the fuel in each tank is worth at cost. */
export default async function StockValuePage({ searchParams }: { searchParams: Promise<DrillParams> }) {
  await requireRole("owner");
  const sp = await searchParams;
  const ctx = await getMoneyContext();
  const disp = displayCurrency(ctx, sp.cur);
  const money = (v: number) => formatMoney(v * disp.rate, disp.code);
  const supabase = await createClient();
  const [{ data: tanks }, { data: fuelTypes }] = await Promise.all([
    supabase.from("stock_value").select("tank_id, name, fuel_type_id, current_litres, avg_cost_per_litre, value").order("name"),
    supabase.from("fuel_types").select("id, name, current_selling_price"),
  ]);
  const rows = (tanks ?? []).map((t) => {
    const fuel = fuelTypes?.find((f) => f.id === t.fuel_type_id);
    const avg = Number(t.avg_cost_per_litre);
    const price = Number(fuel?.current_selling_price ?? 0);
    return { ...t, fuel: fuel?.name ?? "", avg, price, value: Number(t.value), litres: Number(t.current_litres), odd: price > 0 && (avg > price * 3 || price > avg * 20) };
  });
  const total = rows.reduce((x, r) => x + r.value, 0);

  return (
    <>
      <BackToDashboard sp={sp} />
      <PageHeader
        title={
          <>
            Stock value{" "}
            <span className="tabular-nums [overflow-wrap:anywhere]" title={money(total)}>
              {money(total)}
            </span>
          </>
        }
        description="Right now · what the fuel in your tanks cost you, not what it will sell for"
      />
      <div className="mb-5 flex justify-end">
        <Suspense>
          <CurrencySwitcher current={disp.code} />
        </Suspense>
      </div>
      <Card className="mb-5">
        <CardContent className="pt-5 text-[15px] sm:pt-6">
          <p className="font-medium">How it&apos;s worked out</p>
          <p className="mt-1 text-muted">
            For each tank: litres in the tank × average cost per litre. The average cost includes the purchase price and the transport to the
            depot, and is updated every time you add stock (a weighted average). Selling fuel doesn&apos;t change it; adding stock at a new
            price does.
          </p>
        </CardContent>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="No tanks yet" description="A tank is created the first time you add stock." />
      ) : (
        <>
          {rows.some((r) => r.odd) ? (
            <div className="mb-5 flex gap-3 rounded-[var(--radius-tile)] bg-yellow/40 p-4 text-[15px]">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" />
              <p>
                A tank&apos;s average cost is far from its pump price. Check the purchase prices in{" "}
                <Link href="/purchases" className="font-medium underline underline-offset-2">
                  Purchases
                </Link>{" "}
                and the pump price in Sales.
              </p>
            </div>
          ) : null}
          <Table>
            <THead>
              <tr>
                <TH>Tank</TH>
                <TH>Fuel</TH>
                <TH className="text-right">Litres</TH>
                <TH className="text-right">Average cost / L</TH>
                <TH className="text-right">Pump price / L</TH>
                <TH className="text-right">Value at cost</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.tank_id}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD>{r.fuel}</TD>
                  <TD className="text-right tabular-nums">{litres(r.litres)}</TD>
                  <TD className={cn("text-right tabular-nums", r.odd && "font-medium text-orange")}>{formatMoney(r.avg, ctx.base)}</TD>
                  <TD className="text-right tabular-nums text-muted">{formatMoney(r.price, ctx.base)}</TD>
                  <TD className="text-right font-medium tabular-nums">{money(r.value)}</TD>
                </TR>
              ))}
              <TR>
                <TD className="font-semibold" colSpan={5}>
                  Total
                </TD>
                <TD className="text-right font-semibold tabular-nums">{money(total)}</TD>
              </TR>
            </TBody>
          </Table>
        </>
      )}
    </>
  );
}
