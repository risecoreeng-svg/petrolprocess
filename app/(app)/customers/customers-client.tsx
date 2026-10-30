"use client";

import { Suspense, useState } from "react";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { z } from "zod";
import { HandCoins, Pencil, Plus, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, formatDate, nairobiToday } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-record";
import { InfoTip } from "@/components/ui/info-tip";

export type BalanceRow = {
  customer_id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  credit_terms_days: number;
  balance: number;
  total_credit_sales: number;
  total_paid: number;
  overdue: number;
};

export type PaymentRow = {
  id: string;
  customer_id: string;
  amount: number;
  currency: string;
  original_amount: number;
  method: "cash" | "mobile";
  date: string;
  received_by: string | null;
  created_at: string;
};

const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name"),
  phone: z.string().trim().nullable(),
  credit_limit: z.number({ error: "Enter a credit limit" }).min(0),
  credit_terms_days: z.number({ error: "Enter payment terms" }).int().positive(),
});

const paymentSchema = z.object({
  customer_id: z.string().uuid("Pick the customer"),
  currency: z.string().min(3),
  original_amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
  method: z.enum(["cash", "mobile"]),
  date: z.iso.date(),
});

export function CustomersClient({
  balances,
  payments,
  staff,
  display,
}: {
  display: { code: string; rate: number };
  balances: BalanceRow[];
  payments: PaymentRow[];
  staff: { id: string; full_name: string }[];
}) {
  const { fmt, base } = useMoney();
  // Balances are kept in base currency; shown in the chosen currency at today's rate.
  const money = (v: number | string | null | undefined) => fmt(Number(v ?? 0) * display.rate, display.code);
  const [editing, setEditing] = useState<BalanceRow | "new" | null>(null);
  const [paying, setPaying] = useState<BalanceRow | null>(null);
  const owed = balances.reduce((s, b) => s + Math.max(0, Number(b.balance)), 0);
  const overdue = balances.filter((b) => Number(b.overdue) > 0);
  const overdueTotal = overdue.reduce((s, b) => s + Number(b.overdue), 0);
  const customerName = (id: string) => balances.find((b) => b.customer_id === id)?.name ?? "";
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "";

  return (
    <>
      <PageHeader
        title="Customers & credit"
        description="Who owes you money for fuel taken on credit, and who is late."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Customer
          </Button>
        }
      />

      <div className="mb-5">
        <Suspense>
          <CurrencySwitcher current={display.code} />
        </Suspense>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Money owed" value={money(owed)} />
        <Stat label="Late" value={money(overdueTotal)} sub={`${overdue.length} ${overdue.length === 1 ? "customer" : "customers"}`} tip={<InfoTip>Money still unpaid after the number of days you gave the customer to pay.</InfoTip>} tone={overdueTotal > 0 ? "negative" : undefined} />
        <Stat label="Credit customers" value={balances.length} />
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)] sm:p-[26px]">
          <p className="card-title mb-3 flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-orange text-white"><TriangleAlert className="size-4" /></span> Late payers
          </p>
          <ul className="grid gap-2">
            {overdue.map((b) => (
              <li key={b.customer_id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{b.name}</span>
                  {b.phone ? <span className="text-muted-foreground"> · {b.phone}</span> : null}
                  <span className="text-muted-foreground"> · {b.credit_terms_days}-day terms</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-orange">{money(b.overdue)}</span>
                  <Button size="sm" variant="outline" onClick={() => setPaying(b)}>
                    Pay
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {balances.length === 0 ? (
        <EmptyState
          icon={<HandCoins />}
          title="No credit customers"
          description="Add customers who buy on credit, with a credit limit."
          action={<Button onClick={() => setEditing("new")}>Add customer</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((b) => {
            const used = Number(b.credit_limit) > 0 ? (Number(b.balance) / Number(b.credit_limit)) * 100 : 0;
            return (
              <div key={b.customer_id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{b.phone ?? "No phone"}</p>
                  </div>
                  {Number(b.overdue) > 0 ? <Badge variant="destructive">Late</Badge> : null}
                </div>
                <p className={cn("mt-3 text-[28px] font-semibold tracking-[-0.02em] tabular-nums", Number(b.balance) > 0 && "text-orange")}>
                  {money(b.balance)}
                </p>
                <p className="text-xs text-muted-foreground">
                  owed · can owe up to {money(b.credit_limit)} ({Math.round(used)}% used) · paid {money(b.total_paid)} so far
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => setPaying(b)} disabled={Number(b.balance) <= 0}>
                    Record payment
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                    <Pencil />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="card-title mb-3 mt-8">Recent payments</h2>
      {payments.length === 0 ? (
        <EmptyState title="No payments yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Customer</TH>
              <TH>Method</TH>
              <TH>Received by</TH>
              <TH className="text-right">Amount</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {payments.map((p) => (
              <TR key={p.id}>
                <TD>{formatDate(p.date)}</TD>
                <TD>{customerName(p.customer_id)}</TD>
                <TD>{p.method === "mobile" ? "Mobile money" : "Cash"}</TD>
                <TD>{staffName(p.received_by)}</TD>
                <TD className="text-right tabular-nums">{p.currency !== base ? fmt(p.original_amount, p.currency) : money(p.amount)}</TD>
                <TD className="py-2">
                  <DeleteButton
                    kind="credit_payment"
                    id={p.id}
                    createdBy={p.received_by}
                    createdAt={p.created_at}
                    what={`the payment from ${customerName(p.customer_id)} on ${formatDate(p.date)}`}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing ? <CustomerForm customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {paying ? <PaymentForm customer={paying} customers={balances} onClose={() => setPaying(null)} /> : null}
    </>
  );
}

function CustomerForm({ customer, onClose }: { customer: BalanceRow | null; onClose: () => void }) {
  const { base } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [limit, setLimit] = useState(customer ? String(customer.credit_limit) : "");
  const [terms, setTerms] = useState(customer ? String(customer.credit_terms_days) : "30");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const ok = await submit(
      customerSchema,
      { name, phone: phone || null, credit_limit: toNum(limit), credit_terms_days: toNum(terms) },
      (data) =>
        customer
          ? supabase.from("customers").update(data).eq("id", customer.customer_id)
          : supabase.from("customers").insert(data),
      customer ? "Customer updated" : "Customer added",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={customer ? `Edit ${customer.name}` : "Add customer"}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Name" htmlFor="cname" error={errors.name}>
          <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="cphone">
          <Input id="cphone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Credit limit (${base})`} htmlFor="climit" error={errors.credit_limit}>
            <Input id="climit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Field label="Days to pay" htmlFor="cterms" error={errors.credit_terms_days}>
            <Input id="cterms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {customer ? "Save" : "Add customer"}
        </Button>
      </form>
    </Modal>
  );
}

function PaymentForm({ customer, customers, onClose }: { customer: BalanceRow; customers: BalanceRow[]; onClose: () => void }) {
  const { money, base, enabled, perBase, fmt } = useMoney();
  const [currency, setCurrency] = useState(base);
  const { submit, pending, errors } = useSubmit();
  const [customerId, setCustomerId] = useState(customer.customer_id);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "mobile">("mobile");
  const selected = customers.find((c) => c.customer_id === customerId);
  const rate = perBase(currency) ?? 1;
  const amt = (toNum(amount) ?? 0) / rate; // in base currency
  const after = selected ? Number(selected.balance) - amt : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      paymentSchema,
      { customer_id: customerId, currency, original_amount: toNum(amount), method, date: nairobiToday() },
      (data) => createClient().from("credit_payments").insert(data),
      `Payment of ${money(amt)} recorded`,
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Record payment">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Customer" htmlFor="pcust" error={errors.customer_id}>
          <Select id="pcust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.name} ({money(c.balance)}{currency !== base ? ` · ${fmt(Number(c.balance) * rate, currency)}` : ""})
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Amount paid"
          htmlFor="pamt"
          error={errors.original_amount}
          hint={currency !== base && amt ? `≈ ${money(amt)}` : undefined}
        >
          <div className="flex gap-2">
            <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-14 w-[92px] px-3">
              {enabled.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input id="pamt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-14 text-2xl font-bold" />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {(["mobile", "cash"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn(
                "h-14 rounded-[var(--radius-tile)] font-medium",
                method === m ? "bg-black text-white shadow-[var(--shadow-lift)]" : "bg-surface-3 shadow-[var(--shadow-soft)]",
              )}
            >
              {m === "mobile" ? "Mobile money" : "Cash"}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="inner-box flex justify-between text-[15px]">
            <span className="text-muted-foreground">Balance after payment</span>
            <span className={cn("font-semibold tabular-nums", after < 0 && "text-orange")}>{money(after)}</span>
          </div>
        ) : null}
        {after < 0 ? <p className="text-[15px] text-orange">That&apos;s more than they owe.</p> : null}
        <Button type="submit" size="lg" disabled={pending}>
          Record payment
        </Button>
      </form>
    </Modal>
  );
}
