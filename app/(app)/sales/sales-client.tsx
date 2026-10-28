"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Ban, Banknote, Clock, CreditCard, Fuel, Smartphone } from "lucide-react";
import type { Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, errorMessage, formatDateTime, litres, num } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import { PAYMENT_LABEL, type Customer, type FuelType, type PaymentType, type Tank } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";

export type SaleRow = {
  id: string;
  created_at: string;
  tank_id: string;
  fuel_type_id: string;
  litres: number;
  price_per_litre: number;
  total: number;
  payment_type: PaymentType;
  customer_id: string | null;
  payment_ref: string | null;
  attendant_id: string;
};

const saleSchema = z
  .object({
    tank_id: z.string().uuid("Pick a fuel type"),
    litres: z.number({ error: "Enter litres" }).positive("Must be more than 0"),
    payment_type: z.enum(["cash", "mobile", "credit"]),
    customer_id: z.string().uuid().nullable(),
    payment_ref: z.string().trim().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.payment_type === "credit" && !v.customer_id)
      ctx.addIssue({ code: "custom", path: ["customer_id"], message: "Pick the customer" });
  });

const PAY_ICON = { cash: Banknote, mobile: Smartphone, credit: CreditCard } as const;

export function SalesClient({
  role,
  fuelTypes,
  tanks,
  customers,
  sales,
  openShift,
  staff,
}: {
  role: Role;
  fuelTypes: FuelType[];
  tanks: Tank[];
  customers: Customer[];
  sales: SaleRow[];
  openShift: { id: string; started_at: string } | null;
  staff: { id: string; full_name: string }[];
}) {
  const { money } = useMoney();
  const router = useRouter();
  const { submit, pending, errors } = useSubmit();
  const [fuelId, setFuelId] = useState(fuelTypes[0]?.id ?? "");
  const [tankId, setTankId] = useState("");
  const [mode, setMode] = useState<"litres" | "amount">("litres");
  const [qty, setQty] = useState("");
  const [payment, setPayment] = useState<PaymentType>("cash");
  const [customerId, setCustomerId] = useState("");
  const [payRef, setPayRef] = useState("");
  const [startingShift, setStartingShift] = useState(false);

  const fuel = fuelTypes.find((f) => f.id === fuelId);
  const fuelTanks = tanks.filter((t) => t.fuel_type_id === fuelId);
  // Default to the fullest tank of the chosen fuel.
  const tank =
    fuelTanks.find((t) => t.id === tankId) ??
    [...fuelTanks].sort((a, b) => Number(b.current_litres) - Number(a.current_litres))[0];
  const price = Number(fuel?.current_selling_price ?? 0);
  const entered = toNum(qty) ?? 0;
  const saleLitres = mode === "litres" ? entered : price > 0 ? Math.round((entered / price) * 100) / 100 : 0;
  const total = Math.round(saleLitres * price * 100) / 100;
  const customer = customers.find((c) => c.id === customerId);
  const available = customer ? Number(customer.credit_limit) - Number(customer.balance) : null;
  const needsShift = role === "attendant" && !openShift;

  const totals = useMemo(() => {
    const t = { all: 0, cash: 0, mobile: 0, credit: 0, litres: 0 };
    for (const s of sales) {
      t.all += Number(s.total);
      t[s.payment_type] += Number(s.total);
      t.litres += Number(s.litres);
    }
    return t;
  }, [sales]);

  const name = {
    fuel: (id: string) => fuelTypes.find((f) => f.id === id)?.name ?? "",
    customer: (id: string | null) => customers.find((c) => c.id === id)?.name ?? "",
    staff: (id: string) => staff.find((s) => s.id === id)?.full_name ?? "",
  };

  async function startShift() {
    setStartingShift(true);
    const { error } = await createClient().rpc("start_shift");
    setStartingShift(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Shift started");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      saleSchema,
      {
        tank_id: tank?.id ?? "",
        litres: saleLitres || undefined,
        payment_type: payment,
        customer_id: payment === "credit" ? customerId || null : null,
        payment_ref: payment === "mobile" ? payRef.toUpperCase() || null : null,
      },
      // Price, cost, attendant and shift are set by the database.
      (data) => createClient().from("sales").insert(data),
      `Sold ${num(saleLitres)} L · ${money(total)}`,
    );
    if (ok) {
      setQty("");
      setPayRef("");
      setCustomerId("");
      setPayment("cash");
    }
  }

  return (
    <>
      <PageHeader title="Sell fuel" description="Pick the fuel, enter litres or shillings, choose how they paid." />

      {needsShift ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-tile)] bg-yellow p-4 text-[#1c1c1a] sm:p-5">
          <div className="flex items-center gap-3">
            <Clock className="size-5 shrink-0" />
            <p className="font-medium">Start your shift first, then you can record sales.</p>
          </div>
          <Button size="lg" onClick={startShift} disabled={startingShift} className="w-full sm:w-auto">
            Start shift
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_1fr]">
        <Card className={cn("h-fit", needsShift && "pointer-events-none opacity-50")}>
          <CardContent className="pt-5 sm:pt-[26px]">
            <form onSubmit={onSubmit} className="grid gap-6" noValidate>
              {/* Fuel type */}
              <fieldset className="grid gap-2.5">
                <legend className="mb-2.5 text-[15px] font-medium">1. Which fuel?</legend>
                <div className="grid grid-cols-3 gap-2.5">
                  {fuelTypes.map((f) => (
                    <Choice
                      key={f.id}
                      on={fuelId === f.id}
                      onClick={() => {
                        setFuelId(f.id);
                        setTankId("");
                      }}
                      className="min-h-[84px]"
                    >
                      <span className="text-[16px] font-semibold">{f.name}</span>
                      <span className="text-[13px] tabular-nums opacity-70">KES {num(f.current_selling_price)}/L</span>
                    </Choice>
                  ))}
                </div>
                {fuelTanks.length > 1 ? (
                  <Select aria-label="Tank" value={tank?.id ?? ""} onChange={(e) => setTankId(e.target.value)}>
                    {fuelTanks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {litres(t.current_litres)} left
                      </option>
                    ))}
                  </Select>
                ) : tank ? (
                  <p className="text-[13px] text-muted">
                    {tank.name} · {litres(tank.current_litres)} left
                  </p>
                ) : (
                  <p className="text-[13px] text-orange">No tank set up for this fuel. Ask the manager.</p>
                )}
              </fieldset>

              {/* Quantity */}
              <div className="grid gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="qty" className="text-[15px] font-medium">
                    2. How much?
                  </label>
                  <div className="seg text-sm" role="tablist" aria-label="Enter by">
                    {(["litres", "amount"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => {
                          setMode(m);
                          setQty("");
                        }}
                        className={cn("!px-4 !py-2.5 !text-sm", mode === m && "on")}
                      >
                        {m === "litres" ? "Litres" : "Shillings"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <Input
                    id="qty"
                    inputMode="decimal"
                    placeholder="0"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    aria-invalid={!!errors.litres}
                    className="h-[72px] rounded-[var(--radius-tile)] text-center text-[34px] font-semibold tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[15px] text-muted">
                    {mode === "litres" ? "L" : "KES"}
                  </span>
                </div>
                {errors.litres ? <p className="text-[13px] text-orange">{errors.litres}</p> : null}
                {tank && saleLitres > Number(tank.current_litres) ? (
                  <p className="text-[13px] text-orange">Only {litres(tank.current_litres)} left in the tank.</p>
                ) : null}
              </div>

              {/* Payment */}
              <fieldset className="grid gap-2.5">
                <legend className="mb-2.5 text-[15px] font-medium">3. How did they pay?</legend>
                <div className="grid grid-cols-3 gap-2.5">
                  {(["cash", "mobile", "credit"] as const).map((p) => {
                    const Icon = PAY_ICON[p];
                    return (
                      <Choice key={p} on={payment === p} onClick={() => setPayment(p)} className="min-h-[72px] gap-1.5">
                        <Icon className="size-5" />
                        <span className="text-[15px] font-medium">{PAYMENT_LABEL[p]}</span>
                      </Choice>
                    );
                  })}
                </div>
              </fieldset>

              {payment === "mobile" ? (
                <Field label="Mobile money reference (optional)" htmlFor="mref" error={errors.payment_ref} hint="The transaction code from the payment message, if there is one.">
                  <Input
                    id="mref"
                    autoCapitalize="characters"
                    placeholder="e.g. SJK3H7XQ2P"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                  />
                </Field>
              ) : null}
              {payment === "credit" ? (
                <Field
                  label="Customer"
                  htmlFor="cust"
                  error={errors.customer_id}
                  hint={available !== null ? `They can still take ${money(available)} on credit` : "Only customers allowed to buy on credit are listed."}
                >
                  <Select id="cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Choose customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {available !== null && total > available ? (
                <p className="text-[15px] text-orange">This is more than this customer is allowed to owe.</p>
              ) : null}

              <div className="flex items-end justify-between gap-3 rounded-[var(--radius-tile)] bg-black p-5 text-white">
                <div className="text-[13px] text-white/70">
                  Customer pays
                  <br />
                  <span className="tabular-nums">
                    {num(saleLitres)} L × {num(price)}
                  </span>
                </div>
                <div className="text-[28px] font-semibold tabular-nums">{money(total)}</div>
              </div>

              <Button type="submit" size="xl" variant="yellow" disabled={pending || needsShift}>
                Record sale
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="min-w-0">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            <MiniStat label={role === "attendant" ? "Your sales today" : "Sales today"} value={money(totals.all)} strong />
            <MiniStat label="Cash" value={money(totals.cash)} />
            <MiniStat label="Mobile money" value={money(totals.mobile)} />
            <MiniStat label="Credit" value={money(totals.credit)} />
          </div>
          <p className="mb-3 text-[15px] text-muted">
            {sales.length} {sales.length === 1 ? "sale" : "sales"} today · {litres(totals.litres)}
          </p>
          {sales.length === 0 ? (
            <EmptyState icon={<Fuel />} title="No sales yet today" description="Sales you record will show up here." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-tile)] border border-line bg-surface-3 shadow-[var(--shadow-soft)]">
              {sales.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {name.fuel(s.fuel_type_id)} · {num(s.litres)} L
                    </p>
                    <p className="truncate text-[13px] text-muted">
                      {formatDateTime(s.created_at)}
                      {s.customer_id ? ` · ${name.customer(s.customer_id)}` : ""}
                      {s.payment_ref ? ` · ${s.payment_ref}` : ""}
                      {role !== "attendant" ? ` · ${name.staff(s.attendant_id)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end gap-1">
                      <p className="font-semibold tabular-nums">{money(s.total)}</p>
                      <Badge variant={s.payment_type === "credit" ? "warning" : s.payment_type === "mobile" ? "info" : "secondary"}>
                        {PAYMENT_LABEL[s.payment_type]}
                      </Badge>
                    </div>
                    {role === "owner" ? <VoidSale id={s.id} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/** Big tap tile: white when off, black when chosen. */
function Choice({
  on,
  onClick,
  className,
  children,
}: {
  on: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-tile)] p-2 transition-colors active:scale-[0.98]",
        on ? "bg-black text-white shadow-[var(--shadow-lift)]" : "bg-surface-3 text-fg shadow-[var(--shadow-soft)] hover:bg-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

function MiniStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-[var(--radius-tile)] p-4 shadow-[var(--shadow-soft)]", strong ? "bg-yellow text-[#1c1c1a]" : "bg-surface-3")}>
      <p className={cn("text-[13px]", strong ? "opacity-75" : "text-muted")}>{label}</p>
      <p className="mt-0.5 truncate text-[17px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function VoidSale({ id }: { id: string }) {
  const { submit, pending } = useSubmit();
  async function onVoid() {
    if (!confirm("Cancel this sale? The fuel goes back into the tank and any credit is reversed. This is recorded in the audit log.")) return;
    await submit(
      z.object({}),
      {},
      () => createClient().from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id),
      "Sale cancelled",
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={onVoid} disabled={pending} title="Cancel sale" aria-label="Cancel sale">
      <Ban />
    </Button>
  );
}
