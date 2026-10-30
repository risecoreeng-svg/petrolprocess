"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Banknote, CalendarClock, Check, Clock, CreditCard, Fuel, PackagePlus, Smartphone } from "lucide-react";
import type { Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, errorMessage, formatDate, formatDateTime, litres, nairobiToday, num } from "@/lib/utils";
import { PAYMENT_LABEL, type Customer, type FuelType, type PaymentType, type Supplier, type Tank, type Truck } from "@/lib/types";
import { useMoney } from "@/components/money-provider";
import { AddStockForm } from "@/components/add-stock-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { DeleteButton } from "@/components/delete-record";

export type SaleRow = {
  id: string;
  date: string;
  created_at: string;
  tank_id: string;
  fuel_type_id: string;
  litres: number;
  total: number;
  currency: string;
  original_total: number;
  original_price_per_litre: number;
  payment_type: PaymentType;
  customer_id: string | null;
  payment_ref: string | null;
  attendant_id: string;
  delivery_date: string;
  delivery_status: "scheduled" | "delivered";
  created_by: string | null;
};

const saleSchema = z
  .object({
    tank_id: z.string().uuid("Pick a fuel that has stock"),
    litres: z.number({ error: "Enter the litres" }).positive("Must be more than 0"),
    currency: z.string().min(3),
    amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
    payment_type: z.enum(["cash", "mobile", "credit"]),
    customer_id: z.string().uuid().nullable(),
    payment_ref: z.string().trim().nullable(),
    delivery_date: z.iso.date("Pick the delivery date"),
    delivery_status: z.enum(["scheduled", "delivered"]),
  })
  .superRefine((v, ctx) => {
    if (v.payment_type === "credit" && !v.customer_id)
      ctx.addIssue({ code: "custom", path: ["customer_id"], message: "Credit sales need a customer" });
  });

const PAY_ICON = { cash: Banknote, mobile: Smartphone, credit: CreditCard } as const;

export function SalesClient({
  role,
  userId,
  defaultCurrency,
  fuelTypes,
  tanks,
  customers,
  sales,
  due,
  openShift,
  staff,
  suppliers,
  trucks,
}: {
  role: Role;
  userId: string;
  defaultCurrency: string;
  fuelTypes: FuelType[];
  tanks: Tank[];
  customers: Customer[];
  sales: SaleRow[];
  due: SaleRow[];
  openShift: { id: string; started_at: string } | null;
  staff: { id: string; full_name: string }[];
  suppliers: Supplier[];
  trucks: Truck[];
}) {
  const router = useRouter();
  const { base, enabled, perBase, money, fmt } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const canStock = role !== "attendant";

  const stockByFuel = useMemo(() => {
    const m: Record<string, { litres: number; tanks: Tank[] }> = {};
    for (const f of fuelTypes) m[f.id] = { litres: 0, tanks: [] };
    for (const t of tanks) {
      m[t.fuel_type_id] ??= { litres: 0, tanks: [] };
      m[t.fuel_type_id].litres += Number(t.current_litres);
      m[t.fuel_type_id].tanks.push(t);
    }
    return m;
  }, [fuelTypes, tanks]);

  const [fuelId, setFuelId] = useState(
    () => fuelTypes.find((f) => (stockByFuel[f.id]?.litres ?? 0) > 0)?.id ?? fuelTypes[0]?.id ?? "",
  );
  const [tankId, setTankId] = useState("");
  const [qty, setQty] = useState("");
  const [currency, setCurrency] = useState(enabled.includes(defaultCurrency) ? defaultCurrency : base);
  const [priceMode, setPriceMode] = useState<"amount" | "per_litre">("amount");
  const [priceInput, setPriceInput] = useState("");
  const [payment, setPayment] = useState<PaymentType>("cash");
  const [customerId, setCustomerId] = useState("");
  const [payRef, setPayRef] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(nairobiToday());
  const [scheduled, setScheduled] = useState(false);
  const [stockFor, setStockFor] = useState<string | null>(null);
  const [startingShift, setStartingShift] = useState(false);

  const fuel = fuelTypes.find((f) => f.id === fuelId);
  const fuelTanks = stockByFuel[fuelId]?.tanks ?? [];
  // Default to the fullest tank of the chosen fuel.
  const tank =
    fuelTanks.find((t) => t.id === tankId) ??
    [...fuelTanks].sort((a, b) => Number(b.current_litres) - Number(a.current_litres))[0];
  const rate = perBase(currency);
  const pumpPrice = fuel && rate ? Number(fuel.current_selling_price) * rate : 0;
  const saleLitres = toNum(qty) ?? 0;
  const typed = toNum(priceInput);
  // Amount in the chosen currency: what was typed, else litres × pump price.
  const amount = priceMode === "amount" ? (typed ?? saleLitres * pumpPrice) : saleLitres * (typed ?? pumpPrice);
  const amountInBase = rate ? amount / rate : 0;
  const customer = customers.find((c) => c.id === customerId);
  const available = customer ? Number(customer.credit_limit) - Number(customer.balance) : null;
  const needsShift = role === "attendant" && !openShift;
  const isScheduled = scheduled || deliveryDate > nairobiToday();

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
        currency,
        amount: amount || undefined,
        payment_type: payment,
        customer_id: customerId || null,
        payment_ref: payment === "mobile" ? payRef.toUpperCase() || null : null,
        delivery_date: deliveryDate,
        delivery_status: isScheduled ? "scheduled" : "delivered",
      },
      // Rate, base-currency amounts, cost, attendant and shift are set by the database.
      (d) =>
        createClient()
          .from("sales")
          .insert({
            tank_id: d.tank_id,
            litres: d.litres,
            currency: d.currency,
            original_total: d.amount,
            payment_type: d.payment_type,
            customer_id: d.customer_id,
            payment_ref: d.payment_ref,
            delivery_date: d.delivery_date,
            delivery_status: d.delivery_status,
          }),
      `Sold ${num(saleLitres)} L · ${fmt(amount, currency)}${isScheduled ? " · delivery scheduled" : ""}`,
    );
    if (ok) {
      setQty("");
      setPriceInput("");
      setPayRef("");
      setCustomerId("");
      setPayment("cash");
      setScheduled(false);
      setDeliveryDate(nairobiToday());
    }
  }

  async function markDelivered(id: string) {
    const { error } = await createClient().rpc("mark_sale_delivered", { p_sale: id });
    if (error) return toast.error(errorMessage(error));
    toast.success("Marked as delivered");
    router.refresh();
  }

  const saleLine = (s: SaleRow) => (
    <>
      <p className="font-medium">
        {name.fuel(s.fuel_type_id)} · {num(s.litres)} L
      </p>
      <p className="truncate text-[13px] text-muted">
        {formatDateTime(s.created_at)}
        {s.customer_id ? ` · ${name.customer(s.customer_id)}` : ""}
        {s.payment_ref ? ` · ${s.payment_ref}` : ""}
        {role !== "attendant" ? ` · ${name.staff(s.attendant_id)}` : ""}
      </p>
    </>
  );
  const amountCell = (s: SaleRow) => (
    <div className="flex flex-col items-end gap-1">
      <p className="font-semibold tabular-nums">{fmt(s.original_total, s.currency)}</p>
      {s.currency !== base ? <p className="text-[13px] tabular-nums text-muted">{money(s.total)}</p> : null}
    </div>
  );

  return (
    <>
      <PageHeader title="Sell fuel" description="Pick the fuel, enter the litres and the amount, choose how they paid." />

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,480px)_1fr]">
        <Card className={cn("h-fit", needsShift && "pointer-events-none opacity-50")}>
          <CardContent className="pt-5 sm:pt-[26px]">
            <form onSubmit={onSubmit} className="grid gap-6" noValidate>
              {/* 1. Fuel: shows what's in stock, not the price */}
              <fieldset className="grid gap-2.5">
                <legend className="mb-2.5 text-[15px] font-medium">1. Which fuel?</legend>
                <div className="grid grid-cols-3 gap-2.5">
                  {fuelTypes.map((f) => {
                    const st = stockByFuel[f.id] ?? { litres: 0, tanks: [] };
                    const out = st.litres <= 0;
                    return (
                      <Choice
                        key={f.id}
                        on={fuelId === f.id}
                        onClick={() => {
                          setFuelId(f.id);
                          setTankId("");
                        }}
                        className="min-h-[96px] gap-1"
                      >
                        <span className="text-[16px] font-semibold">{f.name}</span>
                        <span className="text-[13px] tabular-nums opacity-75">{litres(st.litres)}</span>
                        {st.tanks.length === 0 ? (
                          <span className="text-[11px] font-medium opacity-75">No tank yet</span>
                        ) : out ? (
                          <span className="rounded-full bg-orange px-2 py-0.5 text-[11px] font-medium text-white">Out of stock</span>
                        ) : null}
                      </Choice>
                    );
                  })}
                </div>
                {fuelTanks.length === 0 || (stockByFuel[fuelId]?.litres ?? 0) <= 0 ? (
                  <div className="inner-box flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[15px]">
                      {fuelTanks.length === 0 ? `No ${fuel?.name ?? "fuel"} tank yet.` : `No ${fuel?.name ?? "fuel"} left.`}{" "}
                      {canStock ? "" : "Ask your manager to add stock."}
                    </p>
                    {canStock ? (
                      <Button type="button" size="sm" onClick={() => setStockFor(fuelId)}>
                        <PackagePlus /> Add stock
                      </Button>
                    ) : null}
                  </div>
                ) : fuelTanks.length > 1 ? (
                  <Select aria-label="Tank" value={tank?.id ?? ""} onChange={(e) => setTankId(e.target.value)}>
                    {fuelTanks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {litres(t.current_litres)} left
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-[13px] text-muted">
                    From {tank?.name} · {litres(tank?.current_litres)} left
                  </p>
                )}
              </fieldset>

              {/* 2. Litres */}
              <div className="grid gap-2.5">
                <label htmlFor="qty" className="text-[15px] font-medium">
                  2. How many litres?
                </label>
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
                  <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[15px] text-muted">L</span>
                </div>
                {errors.litres ? <p className="text-[13px] text-orange">{errors.litres}</p> : null}
                {tank && saleLitres > Number(tank.current_litres) ? (
                  <p className="text-[13px] text-orange">Only {litres(tank.current_litres)} left in the tank.</p>
                ) : null}
              </div>

              {/* 3. Amount */}
              <div className="grid gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[15px] font-medium">3. Sold for</span>
                  <div className="seg text-sm" role="tablist" aria-label="Enter">
                    {(["amount", "per_litre"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={priceMode === m}
                        onClick={() => {
                          setPriceMode(m);
                          setPriceInput("");
                        }}
                        className={cn("!px-4 !py-2.5 !text-sm", priceMode === m && "on")}
                      >
                        {m === "amount" ? "Total amount" : "Price per litre"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Select
                    aria-label="Currency"
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setPriceInput("");
                    }}
                    className="h-14 w-[96px] px-3 text-[15px] font-medium"
                  >
                    {enabled.map((c) => (
                      <option key={c} value={c} disabled={!perBase(c)}>
                        {c}
                      </option>
                    ))}
                  </Select>
                  <Input
                    inputMode="decimal"
                    aria-label={priceMode === "amount" ? "Total amount" : "Price per litre"}
                    placeholder={
                      priceMode === "amount"
                        ? saleLitres && pumpPrice
                          ? fmt(saleLitres * pumpPrice, currency)
                          : "0"
                        : pumpPrice
                          ? fmt(pumpPrice, currency)
                          : "0"
                    }
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="h-14 text-xl font-semibold tabular-nums"
                  />
                </div>
                <p className="text-[13px] text-muted">
                  {pumpPrice
                    ? `Pump price ${fmt(pumpPrice, currency)} per litre. Leave empty to use it.`
                    : "No selling price set for this fuel yet, so type what it was sold for."}
                </p>
                {errors.amount ? <p className="text-[13px] text-orange">{errors.amount}</p> : null}
              </div>

              {/* 4. Payment */}
              <fieldset className="grid gap-2.5">
                <legend className="mb-2.5 text-[15px] font-medium">4. How did they pay?</legend>
                <div className="grid grid-cols-3 gap-2.5">
                  {(["cash", "mobile", "credit"] as const).map((p) => {
                    const Icon = PAY_ICON[p];
                    return (
                      <Choice key={p} on={payment === p} onClick={() => setPayment(p)} className="min-h-[72px] gap-1.5">
                        <Icon className="size-5" />
                        <span className="text-[14px] font-medium">{PAYMENT_LABEL[p]}</span>
                      </Choice>
                    );
                  })}
                </div>
              </fieldset>

              {payment === "mobile" ? (
                <Field label="Mobile money reference (optional)" htmlFor="mref" hint="The transaction code from the payment message, if there is one.">
                  <Input id="mref" autoCapitalize="characters" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                </Field>
              ) : null}
              <Field
                label={payment === "credit" ? "Customer" : "Customer (optional)"}
                htmlFor="cust"
                error={errors.customer_id}
                hint={available !== null && payment === "credit" ? `They can still take ${money(available)} on credit` : undefined}
              >
                <Select id="cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">{payment === "credit" ? "Choose customer…" : "Walk-in customer"}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {available !== null && payment === "credit" && amountInBase > available ? (
                <p className="text-[15px] text-orange">This is more than this customer is allowed to owe.</p>
              ) : null}

              {/* 5. Delivery */}
              <div className="grid gap-2.5">
                <span className="text-[15px] font-medium">5. Delivery</span>
                <div className="grid grid-cols-2 gap-2.5">
                  <Choice on={!isScheduled} onClick={() => { setScheduled(false); setDeliveryDate(nairobiToday()); }} className="min-h-[56px] flex-row gap-2">
                    <Check className="size-[18px]" /> Delivered now
                  </Choice>
                  <Choice on={isScheduled} onClick={() => setScheduled(true)} className="min-h-[56px] flex-row gap-2">
                    <CalendarClock className="size-[18px]" /> Scheduled
                  </Choice>
                </div>
                {isScheduled ? (
                  <Field label="Deliver on" htmlFor="ddate" error={errors.delivery_date} hint="The litres are taken out of the tank now, so they can't be sold twice.">
                    <Input id="ddate" type="date" min={nairobiToday()} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                  </Field>
                ) : null}
              </div>

              <div className="flex items-end justify-between gap-3 rounded-[var(--radius-tile)] bg-black p-5 text-white">
                <div className="text-[13px] text-white/70">
                  Customer pays
                  <br />
                  <span className="tabular-nums">{num(saleLitres)} L</span>
                </div>
                <div className="text-right">
                  <div className="text-[28px] font-semibold tabular-nums">{fmt(amount, currency)}</div>
                  {currency !== base && rate ? <div className="text-[13px] tabular-nums text-white/70">≈ {money(amountInBase)}</div> : null}
                </div>
              </div>

              <Button type="submit" size="xl" variant="yellow" disabled={pending || needsShift || !tank}>
                Record sale
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          <div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              <MiniStat label={role === "attendant" ? "Your sales today" : "Sales today"} value={money(totals.all)} strong />
              <MiniStat label="Cash" value={money(totals.cash)} />
              <MiniStat label="Mobile money" value={money(totals.mobile)} />
              <MiniStat label="Credit" value={money(totals.credit)} />
            </div>
            <p className="text-[13px] text-muted">Totals in {base}. Sales in other currencies are converted at the rate on the day they were made.</p>
          </div>

          {due.length > 0 ? (
            <section>
              <h2 className="card-title mb-3 flex items-center gap-2">
                Deliveries due <Badge variant="warning">{due.length}</Badge>
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-tile)] border border-line bg-surface-3 shadow-[var(--shadow-soft)]">
                {due.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {name.fuel(s.fuel_type_id)} · {num(s.litres)} L{s.customer_id ? ` · ${name.customer(s.customer_id)}` : ""}
                      </p>
                      <p className={cn("text-[13px]", s.delivery_date < nairobiToday() ? "font-medium text-orange" : "text-muted")}>
                        {s.delivery_date < nairobiToday() ? "Late: due " : "Due "}
                        {formatDate(s.delivery_date)} · {fmt(s.original_total, s.currency)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {role !== "attendant" || s.attendant_id === userId ? (
                        <Button size="sm" variant="outline" onClick={() => markDelivered(s.id)}>
                          <Check /> Delivered
                        </Button>
                      ) : null}
                      <DeleteButton kind="sale" id={s.id} createdBy={s.created_by} createdAt={s.created_at} what={`the sale of ${num(s.litres)} L ${name.fuel(s.fuel_type_id)}`} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="card-title mb-3">
              Today · {sales.length} {sales.length === 1 ? "sale" : "sales"} · {litres(totals.litres)}
            </h2>
            {sales.length === 0 ? (
              <EmptyState icon={<Fuel />} title="No sales yet today" description="Sales you record show up here straight away." />
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-tile)] border border-line bg-surface-3 shadow-[var(--shadow-soft)]">
                {sales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      {saleLine(s)}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant={s.payment_type === "credit" ? "warning" : s.payment_type === "mobile" ? "info" : "secondary"}>
                          {PAYMENT_LABEL[s.payment_type]}
                        </Badge>
                        {s.delivery_status === "scheduled" ? <Badge variant="dark">Delivery {formatDate(s.delivery_date)}</Badge> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {amountCell(s)}
                      <DeleteButton kind="sale" id={s.id} createdBy={s.created_by} createdAt={s.created_at} what={`the sale of ${num(s.litres)} L ${name.fuel(s.fuel_type_id)}`} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {stockFor ? (
        <Modal open onClose={() => setStockFor(null)} title="Add stock">
          <AddStockForm
            fuelTypes={fuelTypes}
            tanks={tanks}
            suppliers={suppliers}
            trucks={trucks}
            defaultFuelId={stockFor}
            onDone={() => setStockFor(null)}
          />
        </Modal>
      ) : null}
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
        "flex flex-col items-center justify-center rounded-[var(--radius-tile)] p-2 font-medium transition-colors active:scale-[0.98]",
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

