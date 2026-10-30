"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Pause, Play, Repeat, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { errorMessage, formatDate, litres, nairobiToday, num } from "@/lib/utils";
import { TRUCK_EXPENSE_CATEGORIES, type FleetDriver, type FleetTruck, type TruckExpenseCategory } from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { ReceiptInput, ReceiptLink } from "@/components/receipt-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-record";

export type TruckExpense = {
  id: string;
  truck_id: string;
  date: string;
  category: TruckExpenseCategory;
  description: string | null;
  litres: number | null;
  odometer_km: number | null;
  workshop: string | null;
  driver_id: string | null;
  currency: string;
  original_amount: number;
  amount: number;
  receipt_path: string | null;
  recurring_id: string | null;
  created_by: string | null;
  created_at: string;
};
export type Recurring = {
  id: string;
  truck_id: string;
  category: TruckExpenseCategory;
  description: string | null;
  driver_id: string | null;
  currency: string;
  original_amount: number;
  next_due: string;
  active: boolean;
};

const schema = z
  .object({
    truck_id: z.string().uuid("Pick the truck"),
    date: z.iso.date(),
    category: z.string().min(2),
    currency: z.string().min(3),
    original_amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
    description: z.string().trim().nullable(),
    litres: z.number().positive().nullable(),
    odometer_km: z.number().min(0).nullable(),
    workshop: z.string().trim().nullable(),
    driver_id: z.string().uuid().nullable(),
    receipt_path: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.category === "driver_salary" && !v.driver_id) ctx.addIssue({ code: "custom", path: ["driver_id"], message: "Which driver?" });
  });

export function TruckExpensesClient({
  rows,
  recurring,
  trucks,
  drivers,
  isOwner,
  orgId,
  filter,
}: {
  rows: TruckExpense[];
  recurring: Recurring[];
  trucks: FleetTruck[];
  drivers: FleetDriver[];
  isOwner: boolean;
  orgId: string;
  filter: { truck: string; category: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { money, fmt, base } = useMoney();
  const plate = (id: string) => trucks.find((t) => t.id === id)?.plate_number ?? "";
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.name;
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const cats = Object.entries(TRUCK_EXPENSE_CATEGORIES).filter(([k]) => isOwner || k !== "driver_salary");

  function go(patch: Partial<typeof filter>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}?${next}`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,400px)_1fr] [&>*]:min-w-0">
      <div className="grid h-fit gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a truck cost</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseForm trucks={trucks} drivers={drivers} cats={cats} orgId={orgId} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Repeat className="size-[18px]" /> Repeating costs
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {recurring.length === 0 ? <p className="text-[15px] text-muted">None yet. Set up monthly salaries or insurance here.</p> : null}
            {recurring.map((r) => (
              <RecurringRow key={r.id} r={r} plate={plate(r.truck_id)} driver={driverName(r.driver_id)} />
            ))}
            <RecurringForm trucks={trucks} drivers={drivers} cats={cats} />
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Select aria-label="Truck" value={filter.truck} onChange={(e) => go({ truck: e.target.value })}>
            <option value="">All trucks</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
              </option>
            ))}
          </Select>
          <Select aria-label="Category" value={filter.category} onChange={(e) => go({ category: e.target.value })}>
            <option value="">All costs</option>
            {cats.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <p className="mb-3 text-[15px] text-muted">
          {rows.length} costs · <span className="font-semibold text-fg">{money(total)}</span>
          {isOwner ? "" : " (staff pay not shown)"}
        </p>
        {rows.length === 0 ? (
          <EmptyState icon={<Wrench />} title="No truck costs in this period" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Truck</TH>
                <TH>Cost</TH>
                <TH>Details</TH>
                <TH className="text-right">Amount</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>{formatDate(r.date)}</TD>
                  <TD className="font-medium">{plate(r.truck_id)}</TD>
                  <TD>
                    {TRUCK_EXPENSE_CATEGORIES[r.category]}
                    {r.recurring_id ? <Badge variant="secondary" className="ml-2">Repeating</Badge> : null}
                  </TD>
                  <TD className="max-w-72 whitespace-normal text-[13px] text-muted">
                    {[r.description, r.workshop, r.litres ? litres(r.litres) : null, r.odometer_km ? `${num(r.odometer_km, 0)} km` : null, driverName(r.driver_id)]
                      .filter(Boolean)
                      .join(" · ")}
                    <ReceiptLink path={r.receipt_path} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {fmt(r.original_amount, r.currency)}
                    {r.currency !== base ? <span className="block text-[13px] text-muted">{money(r.amount)}</span> : null}
                  </TD>
                  <TD className="py-2">
                    <DeleteButton
                      kind="truck_expense"
                      id={r.id}
                      createdBy={r.created_by}
                      createdAt={r.created_at}
                      what={`the ${(TRUCK_EXPENSE_CATEGORIES[r.category] ?? r.category).toLowerCase()} cost for ${plate(r.truck_id)}`}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function ExpenseForm({ trucks, drivers, cats, orgId }: { trucks: FleetTruck[]; drivers: FleetDriver[]; cats: [string, string][]; orgId: string }) {
  const { base, enabled, perBase, money } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [f, setF] = useState({ truck_id: "", date: nairobiToday(), category: "truck_fuel", currency: base, amount: "", description: "", litres: "", odometer: "", workshop: "", driver_id: "" });
  const [receipt, setReceipt] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const amt = toNum(f.amount) ?? 0;
  const rate = perBase(f.currency);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      schema,
      {
        truck_id: f.truck_id,
        date: f.date,
        category: f.category,
        currency: f.currency,
        original_amount: toNum(f.amount),
        description: f.description || null,
        litres: f.category === "truck_fuel" ? toNum(f.litres) ?? null : null,
        odometer_km: toNum(f.odometer) ?? null,
        workshop: ["repairs", "tyres"].includes(f.category) ? f.workshop || null : null,
        driver_id: f.category === "driver_salary" ? f.driver_id || null : null,
        receipt_path: receipt,
      },
      (d) => createClient().from("truck_expenses").insert(d),
      "Cost added",
    );
    if (ok) {
      setF({ ...f, amount: "", description: "", litres: "", odometer: "", workshop: "" });
      setReceipt(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Truck" htmlFor="te-truck" error={errors.truck_id}>
          <Select id="te-truck" value={f.truck_id} onChange={set("truck_id")}>
            <option value="">Choose…</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="te-date">
          <Input id="te-date" type="date" max={nairobiToday()} value={f.date} onChange={set("date")} />
        </Field>
      </div>
      <Field label="What for" htmlFor="te-cat">
        <Select id="te-cat" value={f.category} onChange={set("category")}>
          {cats.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount" htmlFor="te-amt" error={errors.original_amount} hint={f.currency !== base && amt && rate ? `≈ ${money(amt / rate)}` : undefined}>
        <div className="flex gap-2">
          <Select aria-label="Currency" value={f.currency} onChange={set("currency")} className="w-[92px] px-3">
            {enabled.map((c) => (
              <option key={c} value={c} disabled={!perBase(c)}>
                {c}
              </option>
            ))}
          </Select>
          <Input id="te-amt" inputMode="decimal" value={f.amount} onChange={set("amount")} className="min-w-0" />
        </div>
      </Field>
      {f.category === "truck_fuel" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Litres" htmlFor="te-lit">
            <Input id="te-lit" inputMode="decimal" value={f.litres} onChange={set("litres")} />
          </Field>
          <Field label="Odometer (km)" htmlFor="te-odo">
            <Input id="te-odo" inputMode="decimal" value={f.odometer} onChange={set("odometer")} />
          </Field>
        </div>
      ) : null}
      {["repairs", "tyres"].includes(f.category) ? (
        <Field label="Workshop" htmlFor="te-shop">
          <Input id="te-shop" value={f.workshop} onChange={set("workshop")} />
        </Field>
      ) : null}
      {f.category === "driver_salary" ? (
        <Field label="Driver" htmlFor="te-drv" error={errors.driver_id}>
          <Select id="te-drv" value={f.driver_id} onChange={set("driver_id")}>
            <option value="">Choose…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Note (optional)" htmlFor="te-desc">
        <Input id="te-desc" value={f.description} onChange={set("description")} />
      </Field>
      <ReceiptInput orgId={orgId} value={receipt} onChange={setReceipt} />
      <Button type="submit" size="lg" disabled={pending}>
        Add cost
      </Button>
    </form>
  );
}

function RecurringRow({ r, plate, driver }: { r: Recurring; plate: string; driver?: string }) {
  const router = useRouter();
  const { fmt } = useMoney();
  async function toggle() {
    const { error } = await createClient().from("truck_recurring_expenses").update({ active: !r.active }).eq("id", r.id);
    if (error) return toast.error(errorMessage(error));
    router.refresh();
  }
  return (
    <div className="inner-box flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {TRUCK_EXPENSE_CATEGORIES[r.category]} · {plate}
        </p>
        <p className="truncate text-[13px] text-muted">
          {fmt(r.original_amount, r.currency)} monthly{driver ? ` · ${driver}` : ""} · {r.active ? `next ${formatDate(r.next_due)}` : "paused"}
        </p>
      </div>
      <Button size="icon" variant="ghost" onClick={toggle} aria-label={r.active ? "Pause" : "Resume"} title={r.active ? "Pause" : "Resume"}>
        {r.active ? <Pause /> : <Play />}
      </Button>
    </div>
  );
}

function RecurringForm({ trucks, drivers, cats }: { trucks: FleetTruck[]; drivers: FleetDriver[]; cats: [string, string][] }) {
  const { base, enabled, perBase } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ truck_id: "", category: "insurance", currency: base, amount: "", next_due: nairobiToday(), driver_id: "", description: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Repeat /> Add a monthly cost
      </Button>
    );
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      z
        .object({
          truck_id: z.string().uuid("Pick the truck"),
          category: z.string(),
          currency: z.string(),
          original_amount: z.number({ error: "Enter the amount" }).positive(),
          next_due: z.iso.date(),
          driver_id: z.string().uuid().nullable(),
          description: z.string().nullable(),
        })
        .superRefine((v, ctx) => {
          if (v.category === "driver_salary" && !v.driver_id) ctx.addIssue({ code: "custom", path: ["driver_id"], message: "Which driver?" });
        }),
      {
        truck_id: f.truck_id,
        category: f.category,
        currency: f.currency,
        original_amount: toNum(f.amount),
        next_due: f.next_due,
        driver_id: f.category === "driver_salary" ? f.driver_id || null : null,
        description: f.description || null,
      },
      (d) => createClient().from("truck_recurring_expenses").insert(d),
      "Monthly cost set up",
    );
    if (ok) setOpen(false);
  }
  return (
    <form onSubmit={onSubmit} className="inner-box grid gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Truck" htmlFor="rc-truck" error={errors.truck_id}>
          <Select id="rc-truck" value={f.truck_id} onChange={set("truck_id")}>
            <option value="">Choose…</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What for" htmlFor="rc-cat">
          <Select id="rc-cat" value={f.category} onChange={set("category")}>
            {cats.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount each month" htmlFor="rc-amt" error={errors.original_amount} className="col-span-2">
          <div className="flex gap-2">
            <Select aria-label="Currency" value={f.currency} onChange={set("currency")} className="w-[92px] px-3">
              {enabled.map((c) => (
                <option key={c} value={c} disabled={!perBase(c)}>
                  {c}
                </option>
              ))}
            </Select>
            <Input id="rc-amt" inputMode="decimal" value={f.amount} onChange={set("amount")} className="min-w-0" />
          </div>
        </Field>
        <Field label="First due on" htmlFor="rc-due">
          <Input id="rc-due" type="date" value={f.next_due} onChange={set("next_due")} />
        </Field>
        {f.category === "driver_salary" ? (
          <Field label="Driver" htmlFor="rc-drv" error={errors.driver_id}>
            <Select id="rc-drv" value={f.driver_id} onChange={set("driver_id")}>
              <option value="">Choose…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
