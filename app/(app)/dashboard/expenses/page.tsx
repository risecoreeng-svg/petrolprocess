import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { formatMoney } from "@/lib/currency";
import { TRUCK_EXPENSE_CATEGORIES } from "@/lib/fleet";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { resolveRange } from "@/lib/range";
import { createClient } from "@/lib/supabase/server";
import { labelize } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ReceiptLink } from "@/components/receipt-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BackToDashboard, keepQuery, periodLabel, type DrillParams } from "../shared";

type Row = {
  id: string;
  kind: "depot" | "truck";
  date: string;
  category: string;
  description: string;
  amount: number;
  original_amount: number;
  currency: string;
  truck: string;
  truckId: string | null;
  by: string;
  receipt: string | null;
};

export default async function ExpensesDrillPage({ searchParams }: { searchParams: Promise<DrillParams & { kind?: string }> }) {
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const sp = await searchParams;
  const { range, from, to } = resolveRange(sp);
  const ctx = await getMoneyContext();
  const disp = displayCurrency(ctx, sp.cur);
  const money = (v: number) => formatMoney(v * disp.rate, disp.code);
  // Truck costs are owner-only here (they include driver salaries).
  const kind = !isOwner ? "depot" : sp.kind === "depot" || sp.kind === "truck" ? sp.kind : "all";
  const supabase = await createClient();

  const [depotRes, truckRes, { data: trucks }, { data: staff }] = await Promise.all([
    kind !== "truck"
      ? supabase
          .from("expenses")
          .select("id, date, category, amount, currency, original_amount, truck_id, description, created_by")
          .is("deleted_at", null)
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    kind !== "depot"
      ? supabase
          .from("truck_expenses")
          .select("id, date, category, amount, currency, original_amount, truck_id, description, created_by, receipt_path")
          .is("deleted_at", null)
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("trucks").select("id, plate_number"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const plate = (id: string | null) => (id ? trucks?.find((t) => t.id === id)?.plate_number ?? "" : "");
  const who = (id: string | null) => (id ? staff?.find((p) => p.id === id)?.full_name ?? "" : "System");
  const rows: Row[] = [
    ...(depotRes.data ?? []).map((e) => ({
      id: e.id,
      kind: "depot" as const,
      date: e.date,
      category: labelize(e.category),
      description: e.description ?? "",
      amount: Number(e.amount),
      original_amount: Number(e.original_amount ?? e.amount),
      currency: e.currency ?? ctx.base,
      truck: plate(e.truck_id),
      truckId: e.truck_id,
      by: who(e.created_by),
      receipt: null,
    })),
    ...(truckRes.data ?? []).map((e) => ({
      id: e.id,
      kind: "truck" as const,
      date: e.date,
      category: TRUCK_EXPENSE_CATEGORIES[e.category as keyof typeof TRUCK_EXPENSE_CATEGORIES] ?? labelize(e.category),
      description: e.description ?? "",
      amount: Number(e.amount),
      original_amount: Number(e.original_amount),
      currency: e.currency,
      truck: plate(e.truck_id),
      truckId: e.truck_id,
      by: who(e.created_by),
      receipt: e.receipt_path,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const total = rows.reduce((x, r) => x + r.amount, 0);
  const depotTotal = rows.filter((r) => r.kind === "depot").reduce((x, r) => x + r.amount, 0);
  const truckTotal = total - depotTotal;
  const byCat = Object.entries(
    rows.reduce<Record<string, number>>((m, r) => ((m[r.category] = (m[r.category] ?? 0) + r.amount), m), {}),
  ).sort((a, b) => b[1] - a[1]);
  const top = byCat[0]?.[1] ?? 0;

  return (
    <>
      <BackToDashboard sp={sp} />
      <PageHeader
        title={
          <>
            Expenses{" "}
            <span className="tabular-nums [overflow-wrap:anywhere]" title={money(total)}>
              {money(total)}
            </span>
          </>
        }
        description={`${periodLabel(from, to)} · ${isOwner ? `depot ${money(depotTotal)} · trucks ${money(truckTotal)}` : "depot running costs"}. Buying fuel and trip costs are not expenses.`}
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
          <CurrencySwitcher current={disp.code} />
        </Suspense>
      </div>

      {isOwner ? (
        <div className="seg mb-5 w-fit" role="tablist" aria-label="Show">
          {(["all", "depot", "truck"] as const).map((k) => (
            <Link
              key={k}
              href={`/dashboard/expenses${keepQuery(sp, { kind: k === "all" ? undefined : k })}`}
              scroll={false}
              role="tab"
              aria-selected={kind === k}
              className={cn(kind === k && "on")}
            >
              {k === "all" ? "All" : k === "depot" ? "Depot costs" : "Truck costs"}
            </Link>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="No expenses in this period" description="Try another period." />
      ) : (
        <>
          <Card className="mb-5">
            <CardHeader>
              <CardTitle>By category</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {byCat.map(([cat, v]) => (
                  <li key={cat} className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr]">
                    <span className="text-[14px]">{cat}</span>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="h-2.5 rounded-full bg-orange" style={{ width: `${Math.max(2, (v / top) * 70)}%` }} aria-hidden />
                      <span className="shrink-0 text-[14px] font-medium tabular-nums">{money(v)}</span>
                      <span className="hidden shrink-0 text-[13px] text-muted sm:inline">{total ? Math.round((v / total) * 100) : 0}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Category</TH>
                <TH>Description</TH>
                <TH className="text-right">Amount</TH>
                <TH>Truck</TH>
                <TH>Entered by</TH>
                <TH>Receipt</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={`${r.kind}-${r.id}`}>
                  <TD>{formatDate(r.date)}</TD>
                  <TD>
                    <span className="flex items-center gap-2">
                      {r.category}
                      {isOwner ? <Badge variant="secondary">{r.kind === "depot" ? "Depot" : "Truck"}</Badge> : null}
                    </span>
                  </TD>
                  <TD className="max-w-[18rem] whitespace-normal text-[14px] text-muted">{r.description || "—"}</TD>
                  <TD className="text-right font-medium tabular-nums">
                    {formatMoney(r.original_amount, r.currency)}
                    {r.currency !== ctx.base ? <span className="block text-[13px] font-normal text-muted">{formatMoney(r.amount, ctx.base)}</span> : null}
                  </TD>
                  <TD>{r.truckId ? <Link href={`/trucks/${r.truckId}`} className="hover:underline">{r.truck}</Link> : "—"}</TD>
                  <TD>{r.by}</TD>
                  <TD>{r.receipt ? <ReceiptLink path={r.receipt} /> : <span className="text-muted">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </>
  );
}
