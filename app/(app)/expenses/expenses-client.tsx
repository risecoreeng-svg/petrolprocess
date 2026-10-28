"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";
import { Ban, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { formatDate, nairobiToday } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import { EXPENSE_CATEGORIES, labelize, type Truck } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type ExpenseRow = {
  id: string;
  date: string;
  category: string;
  amount: number;
  currency: string;
  original_amount: number;
  truck_id: string | null;
  description: string | null;
};

const schema = z.object({
  date: z.iso.date("Pick a date"),
  category: z.enum(EXPENSE_CATEGORIES, { error: "Pick a category" }),
  currency: z.string().min(3),
  original_amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
  truck_id: z.string().uuid().nullable(),
  description: z.string().trim().max(500).nullable(),
});

const TRUCK_CATEGORIES = new Set(["truck_repairs", "truck_fuel", "maintenance"]);

export function ExpensesClient({
  rows,
  trucks,
  isOwner,
  filter,
  defaults,
}: {
  rows: ExpenseRow[];
  trucks: Truck[];
  isOwner: boolean;
  filter: { from: string; to: string; category: string; truck: string };
  defaults: { monthStart: string; weekStart: string; today: string };
}) {
  const { money, fmt, base } = useMoney();
  const router = useRouter();
  const pathname = usePathname();
  const plate = (id: string | null) => trucks.find((t) => t.id === id)?.plate_number ?? "";
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const byCategory = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + Number(r.amount);
    return acc;
  }, {});

  function setFilter(patch: Partial<typeof filter>) {
    const params = new URLSearchParams({ ...filter, ...patch });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`${pathname}?${params}`);
  }

  return (
    <>
      <PageHeader title="Expenses" description="Running costs: rent, salaries, power, repairs. Buying fuel goes under Deliveries." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <ExpenseForm trucks={trucks} />

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setFilter({ from: defaults.today, to: defaults.today })}>
              Today
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFilter({ from: defaults.weekStart, to: defaults.today })}>
              Last 7 days
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFilter({ from: defaults.monthStart, to: defaults.today })}>
              This month
            </Button>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input type="date" aria-label="From" value={filter.from} onChange={(e) => setFilter({ from: e.target.value })} />
            <Input type="date" aria-label="To" value={filter.to} onChange={(e) => setFilter({ to: e.target.value })} />
            <Select aria-label="Category" value={filter.category} onChange={(e) => setFilter({ category: e.target.value })}>
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {labelize(c)}
                </option>
              ))}
            </Select>
            <Select aria-label="Truck" value={filter.truck} onChange={(e) => setFilter({ truck: e.target.value })}>
              <option value="">All trucks</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.plate_number}
                </option>
              ))}
            </Select>
          </div>

          <div className="mb-4 rounded-[var(--radius-tile)] bg-surface-3 p-5 shadow-[var(--shadow-soft)]">
            <p className="text-[13px] text-muted">Money out in this period</p>
            <p className="mt-0.5 text-[28px] font-semibold tracking-[-0.02em] tabular-nums">{money(total)}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {Object.entries(byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([c, v]) => (
                  <span key={c}>
                    {labelize(c)}: <span className="text-foreground">{money(v)}</span>
                  </span>
                ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<Receipt />} title="No expenses in this period" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Category</TH>
                  <TH>Truck</TH>
                  <TH>Description</TH>
                  <TH className="text-right">Amount</TH>
                  {isOwner ? <TH /> : null}
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD>{formatDate(r.date)}</TD>
                    <TD>{labelize(r.category)}</TD>
                    <TD>{plate(r.truck_id)}</TD>
                    <TD className="max-w-64 truncate">{r.description}</TD>
                    <TD className="text-right tabular-nums">
                      {r.currency !== base ? (
                        <>
                          {fmt(r.original_amount, r.currency)}
                          <span className="block text-[13px] text-muted">{money(r.amount)}</span>
                        </>
                      ) : (
                        money(r.amount)
                      )}
                    </TD>
                    {isOwner ? (
                      <TD>
                        <VoidExpense id={r.id} />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}

function ExpenseForm({ trucks }: { trucks: Truck[] }) {
  const { base, enabled, perBase, money } = useMoney();
  const [currency, setCurrency] = useState(base);
  const { submit, pending, errors } = useSubmit();
  const [date, setDate] = useState(nairobiToday());
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [truckId, setTruckId] = useState("");
  const [description, setDescription] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      schema,
      { date, category, currency, original_amount: toNum(amount), truck_id: truckId || null, description: description || null },
      (data) => createClient().from("expenses").insert(data),
      "Expense recorded",
    );
    if (ok) {
      setAmount("");
      setDescription("");
      setTruckId("");
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Add expense</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="edate" error={errors.date}>
              <Input id="edate" type="date" max={nairobiToday()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field
              label="Amount"
              htmlFor="eamt"
              error={errors.original_amount}
              hint={currency !== base && toNum(amount) && perBase(currency) ? `≈ ${money((toNum(amount) ?? 0) / perBase(currency)!)}` : undefined}
            >
              <div className="flex gap-2">
                <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[92px] px-3">
                  {enabled.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Input id="eamt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </Field>
          </div>
          <Field label="Category" htmlFor="ecat" error={errors.category}>
            <Select id="ecat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select…</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {labelize(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Truck (optional)"
            htmlFor="etruck"
            hint={TRUCK_CATEGORIES.has(category) && !truckId ? "Tag a truck so it counts in that truck's profit." : undefined}
          >
            <Select id="etruck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">None</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.plate_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="edesc">
            <Textarea id="edesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            Add expense
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VoidExpense({ id }: { id: string }) {
  const { submit, pending } = useSubmit();
  async function onVoid() {
    if (!confirm("Remove this expense? It is kept in the audit log.")) return;
    await submit(
      z.object({}),
      {},
      () => createClient().from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", id),
      "Expense removed",
    );
  }
  return (
    <Button variant="ghost" size="sm" onClick={onVoid} disabled={pending} title="Remove expense">
      <Ban />
    </Button>
  );
}
