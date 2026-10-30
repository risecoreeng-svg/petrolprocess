"use client";

import { useState } from "react";
import { z } from "zod";
import { Handshake, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, formatDate, nairobiToday } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type ClientBalance = {
  customer_id: string;
  name: string;
  phone: string | null;
  credit_terms_days: number;
  trips: number;
  billed: number;
  paid: number;
  owed: number;
  overdue: number;
};
export type PaymentRow = {
  id: string;
  customer_id: string;
  trip_id: string | null;
  date: string;
  method: string;
  reference: string | null;
  currency: string;
  original_amount: number;
  amount: number;
};
export type OpenTrip = { id: string; trip_no: number; customer_id: string | null; label: string; delivered_at: string | null; total: number; paid: number };

const METHOD_LABEL: Record<string, string> = { cash: "Cash", mobile: "Mobile money", bank: "Bank transfer" };

export function TripClientsClient({
  balances,
  payments,
  openTrips,
  customers,
  preselect,
}: {
  balances: ClientBalance[];
  payments: PaymentRow[];
  openTrips: OpenTrip[];
  customers: { id: string; name: string }[];
  preselect: string;
}) {
  const { money, fmt, base } = useMoney();
  const owed = balances.reduce((s, b) => s + Math.max(0, Number(b.owed)), 0);
  const overdueList = balances.filter((b) => Number(b.overdue) > 0.005);
  const overdue = overdueList.reduce((s, b) => s + Number(b.overdue), 0);
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "";

  return (
    <>
      <PageHeader title="Trip clients" description="What clients owe for delivered trips, who is late, and payments received." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Money owed to you" value={money(owed)} />
        <Stat
          label="Late"
          value={money(overdue)}
          sub={`${overdueList.length} ${overdueList.length === 1 ? "client" : "clients"}`}
          tone={overdue > 0 ? "negative" : undefined}
          tip={<InfoTip>Unpaid trip money older than the days you gave the client to pay (set on the client in Customers).</InfoTip>}
        />
        <Stat label="Clients with trips" value={balances.length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,400px)_1fr] [&>*]:min-w-0">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Record a payment</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentForm balances={balances} openTrips={openTrips} preselect={preselect} />
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-6">
          {overdueList.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
              <p className="card-title mb-3 flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-full bg-orange text-white">
                  <TriangleAlert className="size-4" />
                </span>
                Late payers
              </p>
              <ul className="grid gap-2">
                {overdueList.map((b) => (
                  <li key={b.customer_id} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                    <span>
                      <span className="font-medium">{b.name}</span>
                      <span className="text-muted"> · {b.credit_terms_days}-day terms{b.phone ? ` · ${b.phone}` : ""}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-orange">{money(b.overdue)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {balances.length === 0 ? (
            <EmptyState icon={<Handshake />} title="No client trips delivered yet" description="When a hired trip is delivered, what the client owes shows here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Client</TH>
                  <TH className="text-right">Trips</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Paid</TH>
                  <TH className="text-right">Owed</TH>
                </tr>
              </THead>
              <TBody>
                {balances.map((b) => (
                  <TR key={b.customer_id}>
                    <TD className="font-medium">{b.name}</TD>
                    <TD className="text-right tabular-nums">{b.trips}</TD>
                    <TD className="text-right tabular-nums">{money(b.billed)}</TD>
                    <TD className="text-right tabular-nums">{money(b.paid)}</TD>
                    <TD className={cn("text-right font-semibold tabular-nums", Number(b.owed) > 0.005 && "text-orange")}>{money(b.owed)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <section>
            <h2 className="card-title mb-3">Recent payments</h2>
            {payments.length === 0 ? (
              <EmptyState title="No payments yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Client</TH>
                    <TH>For</TH>
                    <TH>How</TH>
                    <TH className="text-right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {payments.map((p) => (
                    <TR key={p.id}>
                      <TD>{formatDate(p.date)}</TD>
                      <TD>{nameOf(p.customer_id)}</TD>
                      <TD>{p.trip_id ? openTrips.find((t) => t.id === p.trip_id)?.label ?? "Trip" : "Account"}</TD>
                      <TD>
                        {METHOD_LABEL[p.method] ?? p.method}
                        {p.reference ? <span className="block text-[13px] text-muted">{p.reference}</span> : null}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {fmt(p.original_amount, p.currency)}
                        {p.currency !== base ? <span className="block text-[13px] text-muted">{money(p.amount)}</span> : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function PaymentForm({ balances, openTrips, preselect }: { balances: ClientBalance[]; openTrips: OpenTrip[]; preselect: string }) {
  const { base, enabled, perBase, money, fmt } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const owing = balances.filter((b) => Number(b.owed) > 0.005);
  const [customerId, setCustomerId] = useState(owing.some((b) => b.customer_id === preselect) ? preselect : owing[0]?.customer_id ?? "");
  const [tripId, setTripId] = useState("");
  const [method, setMethod] = useState("bank");
  const [currency, setCurrency] = useState(base);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const client = balances.find((b) => b.customer_id === customerId);
  const trips = openTrips.filter((t) => t.customer_id === customerId && t.total - t.paid > 0.005);
  const rate = perBase(currency);
  const amt = toNum(amount) ?? 0;
  const amtBase = rate ? amt / rate : 0;

  if (owing.length === 0) return <p className="text-[15px] text-muted">No client owes anything right now.</p>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      z.object({
        customer_id: z.string().uuid("Pick the client"),
        trip_id: z.string().uuid().nullable(),
        method: z.string(),
        currency: z.string(),
        original_amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
        reference: z.string().nullable(),
        date: z.iso.date(),
      }),
      { customer_id: customerId, trip_id: tripId || null, method, currency, original_amount: toNum(amount), reference: reference || null, date: nairobiToday() },
      (d) => createClient().from("trip_payments").insert(d),
      `Payment of ${fmt(amt, currency)} recorded`,
    );
    if (ok) {
      setAmount("");
      setReference("");
      setTripId("");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field label="Client" htmlFor="tp-client" error={errors.customer_id}>
        <Select id="tp-client" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setTripId(""); }}>
          {owing.map((b) => (
            <option key={b.customer_id} value={b.customer_id}>
              {b.name} (owes {money(b.owed)})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="For which trip?" htmlFor="tp-trip" hint="Leave as 'Account' to pay off the oldest trips first.">
        <Select id="tp-trip" value={tripId} onChange={(e) => setTripId(e.target.value)}>
          <option value="">Account</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} · {money(t.total - t.paid)} left
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount paid" htmlFor="tp-amt" error={errors.original_amount} hint={currency !== base && amt && rate ? `≈ ${money(amtBase)}` : undefined}>
        <div className="flex gap-2">
          <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[92px] px-3">
            {enabled.map((c) => (
              <option key={c} value={c} disabled={!perBase(c)}>
                {c}
              </option>
            ))}
          </Select>
          <Input id="tp-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0 text-xl font-semibold" />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How" htmlFor="tp-method">
          <Select id="tp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="tp-ref">
          <Input id="tp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {client && amt > 0 ? (
        <p className={cn("text-[15px]", amtBase > Number(client.owed) + 0.01 ? "text-orange" : "text-muted")}>
          {amtBase > Number(client.owed) + 0.01 ? "That's more than they owe." : `Still owed after this: ${money(Number(client.owed) - amtBase)}`}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        Record payment
      </Button>
    </form>
  );
}
