"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Ban, Banknote, Clock, CreditCard, Fuel, Smartphone } from "lucide-react";
import type { Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, errorMessage, formatDateTime, kes, litres, num } from "@/lib/utils";
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
  mpesa_ref: string | null;
  attendant_id: string;
};

const saleSchema = z
  .object({
    tank_id: z.string().uuid("Pick a fuel type"),
    litres: z.number({ error: "Enter litres" }).positive("Must be more than 0"),
    payment_type: z.enum(["cash", "mpesa", "credit"]),
    customer_id: z.string().uuid().nullable(),
    mpesa_ref: z.string().trim().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.payment_type === "credit" && !v.customer_id)
      ctx.addIssue({ code: "custom", path: ["customer_id"], message: "Pick the customer" });
    if (v.payment_type === "mpesa" && !v.mpesa_ref)
      ctx.addIssue({ code: "custom", path: ["mpesa_ref"], message: "Enter the M-Pesa code" });
  });

const PAY_ICON = { cash: Banknote, mpesa: Smartphone, credit: CreditCard } as const;

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
  const router = useRouter();
  const { submit, pending, errors } = useSubmit();
  const [fuelId, setFuelId] = useState(fuelTypes[0]?.id ?? "");
  const [tankId, setTankId] = useState("");
  const [mode, setMode] = useState<"litres" | "amount">("litres");
  const [qty, setQty] = useState("");
  const [payment, setPayment] = useState<PaymentType>("cash");
  const [customerId, setCustomerId] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
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
    const t = { all: 0, cash: 0, mpesa: 0, credit: 0, litres: 0 };
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
        mpesa_ref: payment === "mpesa" ? mpesaRef.toUpperCase() || null : null,
      },
      // Price, cost, attendant and shift are set by the database.
      (data) => createClient().from("sales").insert(data),
      `Sold ${num(saleLitres)} L · ${kes(total)}`,
    );
    if (ok) {
      setQty("");
      setMpesaRef("");
      setCustomerId("");
      setPayment("cash");
    }
  }

  return (
    <>
      <PageHeader title="Sales" description="Quick entry" />

      {needsShift ? (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-amber-900">
              <Clock className="size-5" />
              <p className="font-medium">Start your shift before recording sales.</p>
            </div>
            <Button size="lg" onClick={startShift} disabled={startingShift}>
              Start shift
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
        <Card className={cn("h-fit", needsShift && "pointer-events-none opacity-50")}>
          <CardContent className="p-4">
            <form onSubmit={onSubmit} className="grid gap-5" noValidate>
              {/* Fuel type */}
              <div className="grid gap-2">
                <p className="text-sm font-medium">Fuel</p>
                <div className="grid grid-cols-3 gap-2">
                  {fuelTypes.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setFuelId(f.id);
                        setTankId("");
                      }}
                      className={cn(
                        "flex min-h-20 flex-col items-center justify-center rounded-xl border-2 p-2 transition-colors",
                        fuelId === f.id ? "border-primary bg-accent" : "border-border bg-card",
                      )}
                    >
                      <span className="font-semibold">{f.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{num(f.current_selling_price)}/L</span>
                    </button>
                  ))}
                </div>
                {fuelTanks.length > 1 ? (
                  <Select aria-label="Tank" value={tank?.id ?? ""} onChange={(e) => setTankId(e.target.value)}>
                    {fuelTanks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {litres(t.current_litres)}
                      </option>
                    ))}
                  </Select>
                ) : tank ? (
                  <p className="text-xs text-muted-foreground">
                    {tank.name} · {litres(tank.current_litres)} available
                  </p>
                ) : (
                  <p className="text-xs text-destructive">No tank set up for this fuel.</p>
                )}
              </div>

              {/* Quantity */}
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{mode === "litres" ? "Litres" : "Amount (KES)"}</p>
                  <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                    {(["litres", "amount"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMode(m);
                          setQty("");
                        }}
                        className={cn("rounded-md px-3 py-1.5", mode === m && "bg-card font-medium shadow-xs")}
                      >
                        {m === "litres" ? "Litres" : "KES"}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  aria-invalid={!!errors.litres}
                  className="h-16 text-center text-3xl font-bold tabular-nums"
                />
                {errors.litres ? <p className="text-xs text-destructive">{errors.litres}</p> : null}
                {tank && saleLitres > Number(tank.current_litres) ? (
                  <p className="text-xs text-destructive">Only {litres(tank.current_litres)} in the tank.</p>
                ) : null}
              </div>

              {/* Payment */}
              <div className="grid gap-2">
                <p className="text-sm font-medium">Payment</p>
                <div className="grid grid-cols-3 gap-2">
                  {(["cash", "mpesa", "credit"] as const).map((p) => {
                    const Icon = PAY_ICON[p];
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPayment(p)}
                        className={cn(
                          "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 text-sm font-medium",
                          payment === p ? "border-primary bg-accent" : "border-border bg-card",
                        )}
                      >
                        <Icon className="size-5" />
                        {PAYMENT_LABEL[p]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {payment === "mpesa" ? (
                <Field label="M-Pesa code" htmlFor="mref" error={errors.mpesa_ref}>
                  <Input
                    id="mref"
                    autoCapitalize="characters"
                    placeholder="e.g. SJK3H7XQ2P"
                    value={mpesaRef}
                    onChange={(e) => setMpesaRef(e.target.value)}
                  />
                </Field>
              ) : null}
              {payment === "credit" ? (
                <Field
                  label="Customer"
                  htmlFor="cust"
                  error={errors.customer_id}
                  hint={available !== null ? `Available credit ${kes(available)}` : undefined}
                >
                  <Select id="cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Select customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {available !== null && total > available ? (
                <p className="text-sm text-destructive">This sale is over the customer&apos;s credit limit.</p>
              ) : null}

              <div className="flex items-end justify-between rounded-xl bg-muted p-4">
                <div className="text-sm text-muted-foreground">
                  {num(saleLitres)} L × {num(price)}
                </div>
                <div className="text-2xl font-bold tabular-nums">{kes(total)}</div>
              </div>

              <Button type="submit" size="xl" disabled={pending || needsShift}>
                Record sale
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="min-w-0">
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Today" value={kes(totals.all)} strong />
            <MiniStat label="Cash" value={kes(totals.cash)} />
            <MiniStat label="M-Pesa" value={kes(totals.mpesa)} />
            <MiniStat label="Credit" value={kes(totals.credit)} />
          </div>
          <p className="mb-2 text-sm text-muted-foreground">
            {sales.length} sales today · {litres(totals.litres)}
            {role === "attendant" ? " (yours)" : ""}
          </p>
          {sales.length === 0 ? (
            <EmptyState icon={<Fuel />} title="No sales yet today" description="Recorded sales appear here." />
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {sales.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {name.fuel(s.fuel_type_id)} · {num(s.litres)} L
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(s.created_at)}
                      {s.customer_id ? ` · ${name.customer(s.customer_id)}` : ""}
                      {s.mpesa_ref ? ` · ${s.mpesa_ref}` : ""}
                      {role !== "attendant" ? ` · ${name.staff(s.attendant_id)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{kes(s.total)}</p>
                      <Badge variant={s.payment_type === "credit" ? "warning" : s.payment_type === "mpesa" ? "info" : "default"}>
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

function MiniStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", strong && "border-primary bg-accent")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-bold tabular-nums">{value}</p>
    </div>
  );
}

function VoidSale({ id }: { id: string }) {
  const { submit, pending } = useSubmit();
  async function onVoid() {
    if (!confirm("Void this sale? Stock and customer balance will be restored. This is logged.")) return;
    await submit(
      z.object({}),
      {},
      () => createClient().from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id),
      "Sale voided",
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={onVoid} disabled={pending} title="Void sale">
      <Ban />
    </Button>
  );
}
