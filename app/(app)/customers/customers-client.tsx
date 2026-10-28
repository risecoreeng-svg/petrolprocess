"use client";

import { useState } from "react";
import { z } from "zod";
import { Ban, HandCoins, Pencil, Plus, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, formatDate, kes, nairobiToday } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

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
  method: "cash" | "mpesa";
  date: string;
  received_by: string | null;
};

const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name"),
  phone: z.string().trim().nullable(),
  credit_limit: z.number({ error: "Enter a credit limit" }).min(0),
  credit_terms_days: z.number({ error: "Enter payment terms" }).int().positive(),
});

const paymentSchema = z.object({
  customer_id: z.string().uuid("Pick the customer"),
  amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
  method: z.enum(["cash", "mpesa"]),
  date: z.iso.date(),
});

export function CustomersClient({
  balances,
  payments,
  staff,
  isOwner,
}: {
  balances: BalanceRow[];
  payments: PaymentRow[];
  staff: { id: string; full_name: string }[];
  isOwner: boolean;
}) {
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
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Customer
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Money owed" value={kes(owed)} />
        <Stat label="Overdue" value={kes(overdueTotal)} sub={`${overdue.length} customers`} tone={overdueTotal > 0 ? "negative" : undefined} />
        <Stat label="Credit customers" value={balances.length} />
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-red-50 p-4">
          <p className="mb-2 flex items-center gap-2 font-semibold text-destructive">
            <TriangleAlert className="size-4" /> Overdue
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
                  <span className="font-semibold tabular-nums text-destructive">{kes(b.overdue)}</span>
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
              <div key={b.customer_id} className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{b.phone ?? "No phone"}</p>
                  </div>
                  {Number(b.overdue) > 0 ? <Badge variant="destructive">Overdue</Badge> : null}
                </div>
                <p className={cn("mt-2 text-2xl font-bold tabular-nums", Number(b.balance) > 0 && "text-destructive")}>
                  {kes(b.balance)}
                </p>
                <p className="text-xs text-muted-foreground">
                  of {kes(b.credit_limit)} limit ({Math.round(used)}%) · paid {kes(b.total_paid)} to date
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

      <h2 className="mb-2 mt-8 font-semibold">Recent payments</h2>
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
              {isOwner ? <TH /> : null}
            </tr>
          </THead>
          <TBody>
            {payments.map((p) => (
              <TR key={p.id}>
                <TD>{formatDate(p.date)}</TD>
                <TD>{customerName(p.customer_id)}</TD>
                <TD>{p.method === "mpesa" ? "M-Pesa" : "Cash"}</TD>
                <TD>{staffName(p.received_by)}</TD>
                <TD className="text-right tabular-nums">{kes(p.amount)}</TD>
                {isOwner ? (
                  <TD>
                    <VoidPayment id={p.id} />
                  </TD>
                ) : null}
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
          <Field label="Credit limit (KES)" htmlFor="climit" error={errors.credit_limit}>
            <Input id="climit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Field label="Terms (days)" htmlFor="cterms" error={errors.credit_terms_days}>
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
  const { submit, pending, errors } = useSubmit();
  const [customerId, setCustomerId] = useState(customer.customer_id);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "mpesa">("mpesa");
  const selected = customers.find((c) => c.customer_id === customerId);
  const amt = toNum(amount) ?? 0;
  const after = selected ? Number(selected.balance) - amt : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      paymentSchema,
      { customer_id: customerId, amount: toNum(amount), method, date: nairobiToday() },
      (data) => createClient().from("credit_payments").insert(data),
      `Payment of ${kes(amt)} recorded`,
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
                {c.name} ({kes(c.balance)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (KES)" htmlFor="pamt" error={errors.amount}>
          <Input id="pamt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-14 text-2xl font-bold" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {(["mpesa", "cash"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn(
                "h-12 rounded-xl border-2 font-medium",
                method === m ? "border-primary bg-accent" : "border-border",
              )}
            >
              {m === "mpesa" ? "M-Pesa" : "Cash"}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="flex justify-between rounded-lg bg-muted p-3 text-sm">
            <span className="text-muted-foreground">Balance after payment</span>
            <span className={cn("font-semibold tabular-nums", after < 0 && "text-destructive")}>{kes(after)}</span>
          </div>
        ) : null}
        {after < 0 ? <p className="text-sm text-destructive">Payment is more than the balance owed.</p> : null}
        <Button type="submit" size="lg" disabled={pending}>
          Record payment
        </Button>
      </form>
    </Modal>
  );
}

function VoidPayment({ id }: { id: string }) {
  const { submit, pending } = useSubmit();
  async function onVoid() {
    if (!confirm("Void this payment? The customer's balance goes back up. This is logged.")) return;
    await submit(
      z.object({}),
      {},
      () => createClient().from("credit_payments").update({ deleted_at: new Date().toISOString() }).eq("id", id),
      "Payment voided",
    );
  }
  return (
    <Button variant="ghost" size="sm" onClick={onVoid} disabled={pending} title="Void payment">
      <Ban />
    </Button>
  );
}
