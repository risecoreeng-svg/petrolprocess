"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Check, Flag, Pencil, Play, Printer, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, errorMessage, formatDate, formatDateTime, litres, num } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import type { Customer, FuelType, Supplier, Tank } from "@/lib/types";
import {
  CARGO_LABEL,
  TRIP_EXPENSE_CATEGORIES,
  TRIP_INCOME_CATEGORIES,
  TRIP_STATUS_LABEL,
  TRIP_STATUS_VARIANT,
  type FleetDriver,
  type FleetTruck,
  type Trip,
} from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { ReceiptInput, ReceiptLink } from "@/components/receipt-input";
import { TripForm } from "@/components/trip-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { DeleteButton } from "@/components/delete-record";

export type Line = {
  id: string;
  kind: "income" | "expense";
  category: string;
  description: string | null;
  currency: string;
  original_amount: number;
  amount: number;
  litres: number | null;
  driver_id: string | null;
  paid_from_advance: boolean;
  receipt_path: string | null;
  created_at: string;
  created_by: string | null;
};
export type Advance = { id: string; kind: "given" | "returned"; date: string; currency: string; original_amount: number; amount: number };
export type TripPayment = { id: string; date: string; method: string; reference: string | null; currency: string; original_amount: number; amount: number };

const CAT_LABEL: Record<string, string> = { ...TRIP_EXPENSE_CATEGORIES, ...TRIP_INCOME_CATEGORIES };

export function TripDetailClient({
  trip,
  lines,
  advances,
  payments,
  ownerView,
  orgId,
  orgName,
  trucks,
  drivers,
  customers,
  fuelTypes,
  suppliers,
  tanks,
}: {
  trip: Trip;
  lines: Line[];
  advances: Advance[];
  payments: TripPayment[];
  /** Present only for the owner: profit is never sent to anyone else */
  ownerView: { payout: number } | null;
  orgId: string;
  orgName: string;
  trucks: FleetTruck[];
  drivers: FleetDriver[];
  customers: Customer[];
  fuelTypes: FuelType[];
  suppliers: Supplier[];
  tanks: Tank[];
}) {
  const router = useRouter();
  const { money, fmt, base } = useMoney();
  const [modal, setModal] = useState<null | "edit" | "start" | "deliver" | "cancel" | "dispute">(null);
  const truck = trucks.find((t) => t.id === trip.truck_id);
  const driver = drivers.find((d) => d.id === trip.driver_id);
  const client = customers.find((c) => c.id === trip.customer_id);
  const fuel = fuelTypes.find((f) => f.id === trip.fuel_type_id);
  const open = trip.status === "planned" || trip.status === "on_road";
  const rate = Number(trip.fx_rate);
  const inTrip = (baseAmount: number) => fmt(baseAmount * rate, trip.currency);

  const income = lines.filter((l) => l.kind === "income");
  const expenses = lines.filter((l) => l.kind === "expense");
  const extras = income.reduce((s, l) => s + Number(l.amount), 0);
  const spent = expenses.reduce((s, l) => s + Number(l.amount), 0);
  const totalIncome = Number(trip.fee) + extras;
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const advGiven = advances.filter((a) => a.kind === "given").reduce((s, a) => s + Number(a.amount), 0);
  const advReturned = advances.filter((a) => a.kind === "returned").reduce((s, a) => s + Number(a.amount), 0);
  const fromAdvance = expenses.filter((l) => l.paid_from_advance).reduce((s, l) => s + Number(l.amount), 0);

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { error } = await createClient().rpc(fn, args);
    if (error) {
      toast.error(errorMessage(error));
      return false;
    }
    toast.success(ok);
    router.refresh();
    return true;
  }

  return (
    <>
      <Link href="/trips" className="mb-3 inline-flex items-center gap-1 text-sm text-muted">
        <ArrowLeft className="size-4" /> Trips
      </Link>
      <PageHeader
        title={
          <span>
            <span className="text-muted">#{trip.trip_no}</span> {trip.route_from} → {trip.route_to}
          </span>
        }
        description={`${formatDate(trip.date)} · ${truck?.plate_number ?? ""}${driver ? ` · ${driver.name}` : ""} · ${
          trip.for_own_depot ? "Fuel for our depot" : client?.name ?? ""
        } · ${CARGO_LABEL[trip.cargo_type]}`}
        actions={<Badge variant={TRIP_STATUS_VARIANT[trip.status]}>{TRIP_STATUS_LABEL[trip.status]}</Badge>}
      />

      {/* Actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        {trip.status === "planned" ? (
          <Button onClick={() => setModal("start")}>
            <Play /> Start trip
          </Button>
        ) : null}
        {open ? (
          <Button variant={trip.status === "on_road" ? "default" : "outline"} onClick={() => setModal("deliver")}>
            <Check /> Record delivery
          </Button>
        ) : null}
        {open ? (
          <Button variant="outline" onClick={() => setModal("edit")}>
            <Pencil /> Edit
          </Button>
        ) : null}
        {trip.status === "delivered" && !trip.for_own_depot ? (
          <Button variant="outline" onClick={() => printInvoice({ trip, orgName, client, truck, driver, fuel, income, payments })}>
            <Printer /> Invoice / delivery note
          </Button>
        ) : null}
        {open ? (
          <Button variant="ghost" onClick={() => setModal("cancel")}>
            <X /> Cancel trip
          </Button>
        ) : null}
        <DeleteButton
          kind="trip"
          id={trip.id}
          createdBy={trip.created_by}
          createdAt={trip.created_at}
          what={`trip #${trip.trip_no}`}
          onDeleted={() => router.push("/trips")}
          full
        />
      </div>

      {trip.start_override_reason ? (
        <p className="mb-5 rounded-[var(--radius-tile)] bg-yellow px-4 py-3 text-[15px] text-[#1c1c1a]">
          Started despite expired documents. Owner&apos;s reason: {trip.start_override_reason}
        </p>
      ) : null}
      {trip.status === "cancelled" ? (
        <p className="mb-5 rounded-[var(--radius-tile)] bg-surface-2 px-4 py-3 text-[15px]">Cancelled: {trip.cancel_reason}</p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Money */}
        <Card>
          <CardHeader>
            <CardTitle>Money</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-[15px]">
            <Row label="Fee agreed" value={fmt(trip.fee_original, trip.currency)} sub={trip.currency !== base ? money(trip.fee) : undefined} />
            <Row label="Extras" value={inTrip(extras)} sub={trip.currency !== base ? money(extras) : undefined} />
            <Row label="Income" value={inTrip(totalIncome)} sub={trip.currency !== base ? money(totalIncome) : undefined} strong />
            <Row label={ownerView ? "Trip expenses" : "Trip expenses (excluding pay)"} value={money(spent)} sub={trip.currency !== base ? inTrip(spent) : undefined} />
            {ownerView ? (
              <>
                {ownerView.payout ? <Row label="Truck owner's share" value={money(ownerView.payout)} /> : null}
                <ProfitLine
                  label={
                    <span className="flex items-center gap-1.5">
                      Trip profit
                      <InfoTip>Fee + extras − trip expenses{ownerView.payout ? " − the truck owner's share" : ""}. Shown in {base} and in the trip&apos;s currency.</InfoTip>
                    </span>
                  }
                  base={totalIncome - spent - ownerView.payout}
                  inTrip={inTrip(totalIncome - spent - ownerView.payout)}
                  showTrip={trip.currency !== base}
                />
                {trip.status !== "delivered" ? <p className="text-[13px] text-muted">Profit counts once the trip is delivered.</p> : null}
              </>
            ) : null}
            {trip.status === "delivered" && !trip.for_own_depot ? (
              <div className="mt-2 border-t border-line pt-2">
                <Row label="Paid by client" value={money(paid)} />
                <Row label="Still owed for this trip" value={money(Math.max(0, totalIncome - paid))} strong />
              </div>
            ) : null}
            {trip.start_odometer != null ? (
              <p className="mt-1 text-[13px] text-muted">
                Odometer {num(trip.start_odometer, 0)} km
                {trip.end_odometer != null ? ` → ${num(trip.end_odometer, 0)} km (${num(Number(trip.end_odometer) - Number(trip.start_odometer), 0)} km)` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Fuel haulage */}
        {trip.cargo_type === "fuel" ? (
          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <CardTitle>Fuel</CardTitle>
              {trip.haulage_status ? (
                <Badge variant={trip.haulage_status === "disputed" ? "destructive" : trip.haulage_status === "resolved" ? "info" : "default"} className="ml-auto">
                  {trip.haulage_status === "disputed" ? "Disputed" : trip.haulage_status === "resolved" ? "Resolved" : "Within tolerance"}
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-2 text-[15px]">
              <Row label="Fuel" value={fuel?.name ?? "—"} />
              <Row label="Loaded" value={trip.litres_loaded != null ? litres(trip.litres_loaded) : "—"} sub={[trip.loaded_from, trip.loading_ticket && `ticket ${trip.loading_ticket}`].filter(Boolean).join(" · ") || undefined} />
              <Row label="Delivered" value={trip.litres_delivered != null ? litres(trip.litres_delivered) : "Not yet"} sub={trip.for_own_depot ? "Into our depot" : `For ${client?.name ?? "client"} at ${trip.route_to}`} />
              {trip.shortage_litres != null ? (
                <div className={cn("flex items-center justify-between rounded-[var(--radius-inner)] px-3.5 py-3 font-semibold", Number(trip.shortage_litres) > 0 ? "bg-orange/10 text-orange" : "bg-green/10 text-green")}>
                  <span className="flex items-center gap-1.5">
                    Shortage
                    <InfoTip>Litres loaded minus litres delivered. Above your tolerance (Settings) it&apos;s flagged as a possible loss or theft.</InfoTip>
                  </span>
                  <span className="tabular-nums">
                    {litres(trip.shortage_litres)} · {num(trip.shortage_pct, 2)}%
                  </span>
                </div>
              ) : null}
              {trip.dispute_note ? <p className="text-[13px] text-muted">Note: {trip.dispute_note}</p> : null}
              {trip.haulage_status ? (
                <Button variant="outline" size="sm" className="w-fit" onClick={() => setModal("dispute")}>
                  <Flag /> {trip.haulage_status === "disputed" ? "Update dispute" : "Mark as disputed / resolved"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Lines */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Income and expenses</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <LinesList title="Extra income" lines={income} empty="No extras. Add waiting time or extra drops here." drivers={drivers} />
            <LinesList title="Expenses" lines={expenses} empty="No expenses yet." drivers={drivers} />
            {trip.status !== "cancelled" ? (
              <AddLine
                trip={trip}
                orgId={orgId}
                drivers={drivers}
                ownerCanPay={!!ownerView}
                current={{ income: totalIncome, spent, payout: ownerView?.payout ?? 0 }}
                showProfit={!!ownerView}
              />
            ) : null}
          </CardContent>
        </Card>

        {/* Driver advances */}
        {trip.driver_id ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Driver cash advance
                <InfoTip>Cash given to the driver for the trip. Expenses marked &quot;paid from advance&quot; come off it; whatever is left should be returned.</InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-[15px]">
              {advances.map((a) => (
                <Row key={a.id} label={`${a.kind === "given" ? "Given" : "Returned"} · ${formatDate(a.date)}`} value={fmt(a.original_amount, a.currency)} sub={a.currency !== base ? money(a.amount) : undefined} />
              ))}
              <Row label="Spent from advance" value={money(fromAdvance)} />
              <Row label="Driver still holds" value={money(advGiven - advReturned - fromAdvance)} strong />
              <AdvanceForm tripId={trip.id} driverId={trip.driver_id} />
            </CardContent>
          </Card>
        ) : null}

        {/* Payments for this trip */}
        {!trip.for_own_depot && trip.status === "delivered" ? (
          <Card>
            <CardHeader>
              <CardTitle>Client payments for this trip</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-[15px]">
              {payments.length === 0 ? <p className="text-muted">Nothing paid yet.</p> : null}
              {payments.map((p) => (
                <Row key={p.id} label={`${formatDate(p.date)} · ${p.method}${p.reference ? ` · ${p.reference}` : ""}`} value={fmt(p.original_amount, p.currency)} sub={p.currency !== base ? money(p.amount) : undefined} />
              ))}
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link href={`/trip-clients?client=${trip.customer_id}`}>Record a payment</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Modals */}
      {modal === "edit" ? (
        <Modal open onClose={() => setModal(null)} title={`Edit trip #${trip.trip_no}`}>
          <TripForm trip={trip} trucks={trucks} drivers={drivers} customers={customers} fuelTypes={fuelTypes} suppliers={suppliers} tanks={tanks} onDone={() => setModal(null)} />
        </Modal>
      ) : null}
      {modal === "start" ? (
        <StartModal truck={truck} onClose={() => setModal(null)} onStart={(odo, reason) => rpc("start_trip", { p_trip: trip.id, p_start_odometer: odo, p_override_reason: reason }, "Trip started")} />
      ) : null}
      {modal === "deliver" ? <DeliverModal trip={trip} tanks={tanks} onClose={() => setModal(null)} rpc={rpc} /> : null}
      {modal === "cancel" ? (
        <ReasonModal
          title="Cancel this trip"
          help="For a trip that didn't happen. Expenses already spent stay on it."
          action="Cancel trip"
          onClose={() => setModal(null)}
          onSubmit={(reason) => rpc("cancel_trip", { p_trip: trip.id, p_reason: reason }, "Trip cancelled")}
        />
      ) : null}
      {modal === "dispute" ? <DisputeModal trip={trip} onClose={() => setModal(null)} rpc={rpc} /> : null}
    </>
  );
}

function Row({ label, value, sub, strong }: { label: React.ReactNode; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3", strong && "font-semibold")}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className="text-right tabular-nums">
        {value}
        {sub ? <span className="block text-[13px] font-normal text-muted">{sub}</span> : null}
      </span>
    </div>
  );
}

function ProfitLine({ label, base, inTrip, showTrip }: { label: React.ReactNode; base: number; inTrip: string; showTrip: boolean }) {
  const { money } = useMoney();
  return (
    <div className={cn("mt-1 flex items-center justify-between rounded-[var(--radius-inner)] px-3.5 py-3 font-semibold", base < 0 ? "bg-orange/10 text-orange" : "bg-green/10 text-green")}>
      {label}
      <span className="text-right tabular-nums">
        {money(base)}
        {showTrip ? <span className="block text-[13px] font-normal opacity-80">{inTrip}</span> : null}
      </span>
    </div>
  );
}

function LinesList({ title, lines, empty, drivers }: { title: string; lines: Line[]; empty: string; drivers: FleetDriver[] }) {
  const { money, fmt, base } = useMoney();
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {lines.length === 0 ? (
        <p className="text-[15px] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-inner)] bg-surface-3 shadow-[var(--shadow-soft)]">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[15px]">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{CAT_LABEL[l.category] ?? l.category}</p>
                <p className="truncate text-[13px] text-muted">
                  {[
                    l.description,
                    l.litres ? litres(l.litres) : null,
                    l.driver_id ? drivers.find((d) => d.id === l.driver_id)?.name : null,
                    l.paid_from_advance ? "from advance" : null,
                    formatDateTime(l.created_at),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ReceiptLink path={l.receipt_path} />
              </div>
              <div className="text-right tabular-nums">
                <p className="font-semibold">{fmt(l.original_amount, l.currency)}</p>
                {l.currency !== base ? <p className="text-[13px] text-muted">{money(l.amount)}</p> : null}
              </div>
              <DeleteButton
                kind="trip_line"
                id={l.id}
                createdBy={l.created_by}
                createdAt={l.created_at}
                what={`this ${(CAT_LABEL[l.category] ?? l.category).toLowerCase()} line`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const lineSchema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(2),
  currency: z.string().min(3),
  original_amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0"),
  description: z.string().trim().nullable(),
  litres: z.number().positive().nullable(),
  driver_id: z.string().uuid().nullable(),
  paid_from_advance: z.boolean(),
  receipt_path: z.string().nullable(),
});

/** Add a line; the owner sees what profit would become with it, live. */
function AddLine({
  trip,
  orgId,
  drivers,
  ownerCanPay,
  current,
  showProfit,
}: {
  trip: Trip;
  orgId: string;
  drivers: FleetDriver[];
  ownerCanPay: boolean;
  current: { income: number; spent: number; payout: number };
  showProfit: boolean;
}) {
  const { enabled, perBase, money, fmt, base } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState("fuel");
  const [currency, setCurrency] = useState(trip.currency);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [lit, setLit] = useState("");
  const [driverId, setDriverId] = useState(trip.driver_id ?? "");
  const [fromAdvance, setFromAdvance] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const cats = kind === "expense" ? TRIP_EXPENSE_CATEGORIES : TRIP_INCOME_CATEGORIES;
  const rate = perBase(currency);
  const amt = toNum(amount) ?? 0;
  const amtBase = rate ? amt / rate : 0;
  const projected = useMemo(() => {
    const income = current.income + (kind === "income" ? amtBase : 0);
    const spent = current.spent + (kind === "expense" ? amtBase : 0);
    return income - spent - current.payout;
  }, [current, kind, amtBase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      lineSchema,
      {
        kind,
        category,
        currency,
        original_amount: toNum(amount),
        description: description || null,
        litres: kind === "expense" && category === "fuel" ? toNum(lit) ?? null : null,
        driver_id: category === "driver_pay" ? driverId || null : null,
        paid_from_advance: kind === "expense" && fromAdvance,
        receipt_path: receipt,
      },
      (d) => createClient().from("trip_lines").insert({ trip_id: trip.id, ...d }),
      kind === "expense" ? "Expense added" : "Extra income added",
    );
    if (ok) {
      setAmount("");
      setDescription("");
      setLit("");
      setReceipt(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="inner-box grid gap-3" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Add a line</p>
        <div className="seg text-sm">
          {(["expense", "income"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setCategory(k === "expense" ? "fuel" : "waiting_time");
              }}
              className={cn("!px-4 !py-2 !text-sm", kind === k && "on")}
            >
              {k === "expense" ? "Expense" : "Extra income"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What for" htmlFor="ln-cat">
          <Select id="ln-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(cats)
              .filter(([k]) => k !== "driver_pay" || ownerCanPay)
              .map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Amount" htmlFor="ln-amt" error={errors.original_amount} hint={currency !== base && amt && rate ? `≈ ${money(amtBase)}` : undefined}>
          <div className="flex gap-2">
            <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[92px] px-3">
              {enabled.map((c) => (
                <option key={c} value={c} disabled={!perBase(c)}>
                  {c}
                </option>
              ))}
            </Select>
            <Input id="ln-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0" />
          </div>
        </Field>
        {kind === "expense" && category === "fuel" ? (
          <Field label="Litres (optional)" htmlFor="ln-lit">
            <Input id="ln-lit" inputMode="decimal" value={lit} onChange={(e) => setLit(e.target.value)} />
          </Field>
        ) : null}
        {category === "driver_pay" ? (
          <Field label="Paid to" htmlFor="ln-drv">
            <Select id="ln-drv" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Choose…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Note (optional)" htmlFor="ln-desc" className={kind === "expense" && (category === "fuel" || category === "driver_pay") ? "" : "sm:col-span-2"}>
          <Input id="ln-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      {kind === "expense" ? (
        <>
          <ReceiptInput orgId={orgId} value={receipt} onChange={setReceipt} />
          {trip.driver_id ? (
            <label className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" className="size-5 accent-black" checked={fromAdvance} onChange={(e) => setFromAdvance(e.target.checked)} />
              Driver paid this from the cash advance
            </label>
          ) : null}
        </>
      ) : null}
      {showProfit && amt > 0 ? (
        <p className={cn("text-[15px] font-medium", projected < 0 ? "text-orange" : "text-green")}>
          Trip profit with this line: {money(projected)}
          {trip.currency !== base ? ` · ${fmt(projected * Number(trip.fx_rate), trip.currency)}` : ""}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Add {kind === "expense" ? "expense" : "extra income"}
      </Button>
    </form>
  );
}

function AdvanceForm({ tripId, driverId }: { tripId: string; driverId: string }) {
  const { enabled, perBase, base } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [kind, setKind] = useState<"given" | "returned">("given");
  const [currency, setCurrency] = useState(base);
  const [amount, setAmount] = useState("");
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      z.object({ original_amount: z.number({ error: "Enter the amount" }).positive() }),
      { original_amount: toNum(amount) },
      (d) => createClient().from("driver_advances").insert({ trip_id: tripId, driver_id: driverId, kind, currency, ...d }),
      kind === "given" ? "Advance recorded" : "Returned cash recorded",
    );
    if (ok) setAmount("");
  }
  return (
    <form onSubmit={onSubmit} className="mt-2 grid gap-2 border-t border-line pt-3" noValidate>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Given or returned" value={kind} onChange={(e) => setKind(e.target.value as "given" | "returned")} className="w-[140px]">
          <option value="given">Given</option>
          <option value="returned">Returned</option>
        </Select>
        <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[92px] px-3">
          {enabled.map((c) => (
            <option key={c} value={c} disabled={!perBase(c)}>
              {c}
            </option>
          ))}
        </Select>
        <Input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 min-w-0 flex-1" />
        <Button type="submit" variant="outline" disabled={pending}>
          Save
        </Button>
      </div>
      {errors.original_amount ? <p className="text-[13px] text-orange">{errors.original_amount}</p> : null}
    </form>
  );
}

function StartModal({
  truck,
  onClose,
  onStart,
}: {
  truck?: FleetTruck;
  onClose: () => void;
  onStart: (odometer: number | null, reason: string | null) => Promise<boolean>;
}) {
  const [odo, setOdo] = useState(truck ? String(truck.odometer_km) : "");
  const [reason, setReason] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const ok = await onStart(toNum(odo) ?? null, reason || null);
    setBusy(false);
    if (ok) onClose();
    else setNeedsOverride(true);
  }
  return (
    <Modal open onClose={onClose} title="Start trip">
      <div className="grid gap-4">
        <Field label="Odometer now (km)" htmlFor="st-odo">
          <Input id="st-odo" inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        {needsOverride ? (
          <Field label="Owner's reason to start anyway" htmlFor="st-reason" hint="Only the owner can start a truck with expired insurance or licence.">
            <Textarea id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
        <Button size="lg" onClick={go} disabled={busy}>
          <Play /> Start
        </Button>
      </div>
    </Modal>
  );
}

function DeliverModal({
  trip,
  tanks,
  onClose,
  rpc,
}: {
  trip: Trip;
  tanks: Tank[];
  onClose: () => void;
  rpc: (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;
}) {
  const { base, enabled, perBase, fmt } = useMoney();
  const [delivered, setDelivered] = useState(trip.litres_delivered != null ? String(trip.litres_delivered) : trip.litres_loaded != null ? String(trip.litres_loaded) : "");
  const [odo, setOdo] = useState(trip.end_odometer != null ? String(trip.end_odometer) : "");
  const fuelTanks = tanks.filter((t) => t.fuel_type_id === trip.fuel_type_id);
  const [tankId, setTankId] = useState(trip.tank_id ?? fuelTanks[0]?.id ?? "__new__");
  const [newTank, setNewTank] = useState("");
  const [newCap, setNewCap] = useState("");
  const [costMode, setCostMode] = useState<"per_litre" | "total">("per_litre");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState(base);
  const [sell, setSell] = useState("");
  const [busy, setBusy] = useState(false);
  const d = toNum(delivered);
  const loaded = Number(trip.litres_loaded ?? 0);
  const shortage = d !== undefined && loaded ? loaded - d : null;

  async function go() {
    setBusy(true);
    const args: Record<string, unknown> = { p_trip: trip.id, p_litres_delivered: trip.cargo_type === "fuel" ? d ?? null : null, p_end_odometer: toNum(odo) ?? null };
    if (trip.for_own_depot) {
      Object.assign(args, {
        p_tank_id: tankId === "__new__" ? null : tankId,
        p_new_tank_name: tankId === "__new__" ? newTank : null,
        p_new_tank_capacity: tankId === "__new__" ? toNum(newCap) ?? null : null,
        p_cost_per_litre: costMode === "per_litre" ? toNum(cost) ?? null : null,
        p_cost_total: costMode === "total" ? toNum(cost) ?? null : null,
        p_cost_currency: currency,
        p_selling_price: toNum(sell) ?? null,
      });
    }
    const ok = await rpc("record_delivery", args, trip.for_own_depot ? "Delivered. The fuel is in stock and can be sold." : "Trip delivered");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Record delivery">
      <div className="grid gap-4">
        {trip.cargo_type === "fuel" ? (
          <Field
            label="Litres delivered"
            htmlFor="dv-lit"
            hint={shortage !== null ? `Loaded ${litres(loaded)} · shortage ${litres(shortage)} (${num(loaded ? (shortage / loaded) * 100 : 0, 2)}%)` : undefined}
          >
            <Input id="dv-lit" inputMode="decimal" value={delivered} onChange={(e) => setDelivered(e.target.value)} className="h-14 text-2xl font-semibold" />
          </Field>
        ) : null}
        <Field label="Odometer at the end (km)" htmlFor="dv-odo">
          <Input id="dv-odo" inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        {trip.for_own_depot ? (
          <div className="inner-box grid gap-3">
            <p className="text-sm font-medium">Into our stock</p>
            <Field label="Tank" htmlFor="dv-tank">
              <Select id="dv-tank" value={tankId} onChange={(e) => setTankId(e.target.value)}>
                {fuelTanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="__new__">+ New tank</option>
              </Select>
            </Field>
            {tankId === "__new__" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tank name" htmlFor="dv-tname">
                  <Input id="dv-tname" value={newTank} onChange={(e) => setNewTank(e.target.value)} />
                </Field>
                <Field label="Holds (L)" htmlFor="dv-tcap">
                  <Input id="dv-tcap" inputMode="decimal" value={newCap} onChange={(e) => setNewCap(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">What we paid the supplier</span>
              <div className="seg text-sm">
                {(["per_litre", "total"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setCostMode(m)} className={cn("!px-3 !py-2 !text-sm", costMode === m && "on")}>
                    {m === "per_litre" ? "Per litre" : "Total"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[92px] px-3">
                {enabled.map((c) => (
                  <option key={c} value={c} disabled={!perBase(c)}>
                    {c}
                  </option>
                ))}
              </Select>
              <Input aria-label="Cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="min-w-0" />
            </div>
            <Field label={`Sell it for, per litre (${currency}, optional)`} htmlFor="dv-sell">
              <Input id="dv-sell" inputMode="decimal" value={sell} onChange={(e) => setSell(e.target.value)} />
            </Field>
            <p className="text-[13px] text-muted">
              The delivered litres go into the tank once, linked to this trip.
              {Number(trip.fee) ? ` The trip's internal charge (${fmt(trip.fee, base)}) is added to the fuel's cost.` : ""}
            </p>
          </div>
        ) : null}
        <Button size="lg" onClick={go} disabled={busy}>
          <Check /> Mark delivered
        </Button>
      </div>
    </Modal>
  );
}

function ReasonModal({
  title,
  help,
  action,
  onClose,
  onSubmit,
}: {
  title: string;
  help: string;
  action: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="grid gap-4">
        <p className="text-[15px] text-muted">{help}</p>
        <Field label="Reason" htmlFor="rs-reason">
          <Textarea id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button
          size="lg"
          variant="destructive"
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit(reason.trim());
            setBusy(false);
            if (ok) onClose();
          }}
        >
          {action}
        </Button>
      </div>
    </Modal>
  );
}

function DisputeModal({
  trip,
  onClose,
  rpc,
}: {
  trip: Trip;
  onClose: () => void;
  rpc: (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<"ok" | "disputed" | "resolved">(trip.haulage_status === "ok" ? "disputed" : trip.haulage_status ?? "disputed");
  const [note, setNote] = useState(trip.dispute_note ?? "");
  return (
    <Modal open onClose={onClose} title="Shortage status">
      <div className="grid gap-4">
        <div className="seg w-fit">
          {(["disputed", "resolved", "ok"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cn(status === s && "on")}>
              {s === "disputed" ? "Disputed" : s === "resolved" ? "Resolved" : "No issue"}
            </button>
          ))}
        </div>
        <Field label="Note" htmlFor="dp-note" hint="What happened, and what was agreed.">
          <Textarea id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          size="lg"
          onClick={async () => {
            if (await rpc("set_haulage_status", { p_trip: trip.id, p_status: status, p_note: note }, "Saved")) onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

/** Printable invoice / delivery note (PDF) for a delivered client trip. */
async function printInvoice({
  trip,
  orgName,
  client,
  truck,
  driver,
  fuel,
  income,
  payments,
}: {
  trip: Trip;
  orgName: string;
  client?: Customer;
  truck?: FleetTruck;
  driver?: FleetDriver;
  fuel?: FuelType;
  income: Line[];
  payments: TripPayment[];
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF();
  const cur = trip.currency;
  const rate = Number(trip.fx_rate);
  const f = (n: number) => formatMoney(n, cur);
  doc.setFontSize(18);
  doc.text(orgName || "PetroTrack", 14, 18);
  doc.setFontSize(12);
  doc.text(`Invoice / delivery note  ·  Trip #${trip.trip_no}`, 14, 27);
  doc.setFontSize(10);
  const info = [
    `Bill to: ${client?.name ?? ""}${client?.phone ? `  (${client.phone})` : ""}`,
    `Date: ${formatDate(trip.date)}${trip.delivered_at ? `   Delivered: ${formatDate(trip.delivered_at.slice(0, 10))}` : ""}`,
    `Route: ${trip.route_from} → ${trip.route_to}`,
    `Truck: ${truck?.plate_number ?? ""}${driver ? `   Driver: ${driver.name}` : ""}`,
  ];
  info.forEach((line, i) => doc.text(line, 14, 36 + i * 6));
  let y = 36 + info.length * 6 + 4;
  if (trip.cargo_type === "fuel") {
    autoTable(doc, {
      startY: y,
      head: [["Fuel", "Litres loaded", "Litres delivered", "Shortage", "Loading ticket"]],
      body: [[
        fuel?.name ?? "",
        num(trip.litres_loaded),
        num(trip.litres_delivered),
        `${num(trip.shortage_litres)} L (${num(trip.shortage_pct, 2)}%)`,
        trip.loading_ticket ?? "",
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 30, 28] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }
  const rows: string[][] = [[`Trip fee (${CARGO_LABEL[trip.cargo_type]})`, f(Number(trip.fee_original))]];
  for (const l of income) rows.push([`${CAT_LABEL[l.category] ?? l.category}${l.description ? ` – ${l.description}` : ""}`, f(Number(l.amount) * rate)]);
  const total = Number(trip.fee_original) + income.reduce((s, l) => s + Number(l.amount) * rate, 0);
  const paidCur = payments.reduce((s, p) => s + Number(p.amount) * rate, 0);
  rows.push(["Total", f(total)], ["Paid", f(paidCur)], ["Amount due", f(Math.max(0, total - paidCur))]);
  autoTable(doc, {
    startY: y,
    head: [["Description", `Amount (${cur})`]],
    body: rows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [30, 30, 28] },
    columnStyles: { 1: { halign: "right" } },
  });
  doc.save(`invoice_trip_${trip.trip_no}.pdf`);
}
