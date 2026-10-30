import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { formatMoney } from "@/lib/currency";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";
import { formatDate, nairobiToday } from "@/lib/utils";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BackToDashboard, type DrillParams } from "../shared";

const daysSince = (iso: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);

/**
 * Who owes money and since when. Payments clear the oldest credit sales first, so the oldest
 * unpaid date is the first credit sale that payments haven't fully covered.
 */
export default async function MoneyOwedPage({ searchParams }: { searchParams: Promise<DrillParams> }) {
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const sp = await searchParams;
  const ctx = await getMoneyContext();
  const disp = displayCurrency(ctx, sp.cur);
  const money = (v: number) => formatMoney(v * disp.rate, disp.code);
  const today = nairobiToday();
  const supabase = await createClient();

  const [{ data: balances }, { data: credit }, { data: payments }, tripRes] = await Promise.all([
    supabase.from("customer_balances").select("customer_id, name, phone, balance, overdue, credit_terms_days").gt("balance", 0).order("balance", { ascending: false }),
    supabase.from("sales_safe").select("customer_id, date, total").eq("payment_type", "credit").order("date").order("created_at").limit(10000),
    supabase.from("credit_payments").select("customer_id, amount").is("deleted_at", null).limit(10000),
    isOwner ? supabase.from("trip_client_balances").select("customer_id, name, owed, overdue").gt("owed", 0) : Promise.resolve({ data: null }),
  ]);

  const paid = new Map<string, number>();
  for (const p of payments ?? []) paid.set(p.customer_id, (paid.get(p.customer_id) ?? 0) + Number(p.amount));
  const oldestUnpaid = (customerId: string) => {
    let left = paid.get(customerId) ?? 0;
    for (const s of credit ?? []) {
      if (s.customer_id !== customerId) continue;
      left -= Number(s.total);
      if (left < -0.005) return s.date as string;
    }
    return null;
  };

  const rows = (balances ?? []).map((b) => ({ ...b, balance: Number(b.balance), overdue: Number(b.overdue), oldest: oldestUnpaid(b.customer_id) }));
  const total = rows.reduce((x, r) => x + r.balance, 0);
  const late = rows.reduce((x, r) => x + r.overdue, 0);
  const trips = (tripRes.data ?? []).map((t) => ({ ...t, owed: Number(t.owed), overdue: Number(t.overdue) }));
  const tripTotal = trips.reduce((x, t) => x + t.owed, 0);

  return (
    <>
      <BackToDashboard sp={sp} />
      <PageHeader
        title={
          <>
            Money owed{" "}
            <span className="tabular-nums [overflow-wrap:anywhere]" title={money(total)}>
              {money(total)}
            </span>
          </>
        }
        description={`Right now · ${late > 0.005 ? `${money(late)} is past the agreed days to pay` : "nothing is late"}${tripTotal > 0.005 ? ` · trip clients owe another ${money(tripTotal)}` : ""}`}
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
            For each customer: everything they bought on credit, minus what they&apos;ve paid back. Payments clear the oldest purchases first,
            so &quot;unpaid since&quot; is the date of the oldest credit sale that isn&apos;t fully paid. Voided sales don&apos;t count.
          </p>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-[17px] font-semibold">Fuel customers</h2>
      {rows.length === 0 ? (
        <EmptyState title="Nobody owes you for fuel" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Customer</TH>
              <TH className="text-right">Owes</TH>
              <TH className="text-right">Late</TH>
              <TH>Unpaid since</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.customer_id}>
                <TD>
                  <Link href="/customers" className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.phone ? <span className="block text-[13px] text-muted">{r.phone}</span> : null}
                </TD>
                <TD className="text-right font-medium tabular-nums">{money(r.balance)}</TD>
                <TD className="text-right tabular-nums">{r.overdue > 0.005 ? <span className="font-medium text-orange">{money(r.overdue)}</span> : <span className="text-muted">—</span>}</TD>
                <TD>
                  {r.oldest ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {formatDate(r.oldest)}
                      <Badge variant={daysSince(r.oldest, today) > Number(r.credit_terms_days ?? 30) ? "destructive" : "secondary"}>
                        {daysSince(r.oldest, today)} days
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {isOwner && trips.length > 0 ? (
        <>
          <h2 className="mb-3 mt-7 text-[17px] font-semibold">Trip clients</h2>
          <Table>
            <THead>
              <tr>
                <TH>Client</TH>
                <TH className="text-right">Owes</TH>
                <TH className="text-right">Late</TH>
              </tr>
            </THead>
            <TBody>
              {trips.map((t) => (
                <TR key={t.customer_id}>
                  <TD>
                    <Link href="/trip-clients" className="font-medium hover:underline">
                      {t.name}
                    </Link>
                  </TD>
                  <TD className="text-right font-medium tabular-nums">{money(t.owed)}</TD>
                  <TD className="text-right tabular-nums">{t.overdue > 0.005 ? <span className="font-medium text-orange">{money(t.overdue)}</span> : <span className="text-muted">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
    </>
  );
}
