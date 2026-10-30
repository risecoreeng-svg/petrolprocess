"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Check, Play, Plus, Route } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, errorMessage, formatDate, litres, num } from "@/lib/utils";
import { CARGO_LABEL, TRIP_EXPENSE_CATEGORIES, TRIP_STATUS_LABEL, TRIP_STATUS_VARIANT, type CargoType, type TripStatus } from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { ReceiptInput } from "@/components/receipt-input";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export type DriverTrip = {
  id: string;
  trip_no: number;
  date: string;
  route_from: string;
  route_to: string;
  cargo_type: CargoType;
  status: TripStatus;
  fuel_type_id: string | null;
  litres_loaded: number | null;
  litres_delivered: number | null;
  loading_ticket: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  for_own_depot: boolean;
  currency: string;
  notes: string | null;
  plate_number: string | null;
  client_name: string | null;
};
export type MyLine = { id: string; trip_id: string; category: string; currency: string; original_amount: number; description: string | null; receipt_path: string | null; created_at: string };

const DRIVER_CATS = Object.entries(TRIP_EXPENSE_CATEGORIES).filter(([k]) => k !== "driver_pay");

export function MyTripsClient({
  trips,
  lines,
  fuelTypes,
  orgId,
  name,
}: {
  trips: DriverTrip[];
  lines: MyLine[];
  fuelTypes: { id: string; name: string }[];
  orgId: string;
  name: string;
}) {
  const router = useRouter();
  const { fmt } = useMoney();
  const [expenseFor, setExpenseFor] = useState<DriverTrip | null>(null);
  const [deliverFor, setDeliverFor] = useState<DriverTrip | null>(null);

  async function start(t: DriverTrip) {
    const odo = window.prompt("Odometer now (km)", t.start_odometer != null ? String(t.start_odometer) : "");
    if (odo === null) return;
    const { error } = await createClient().rpc("start_trip", { p_trip: t.id, p_start_odometer: toNum(odo) ?? null });
    if (error) return toast.error(errorMessage(error));
    toast.success("Trip started. Drive safe!");
    router.refresh();
  }

  return (
    <>
      <PageHeader title="My trips" description={`Hello ${name.split(" ")[0]}. Add what you spend on the road, and the litres you deliver.`} />
      {trips.length === 0 ? (
        <EmptyState icon={<Route />} title="No trips for you yet" description="Trips assigned to you by the office will show here." />
      ) : (
        <div className="grid gap-4">
          {trips.map((t) => {
            const mine = lines.filter((l) => l.trip_id === t.id);
            return (
              <div key={t.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[19px] font-semibold">
                      {t.route_from} → {t.route_to}
                    </p>
                    <p className="text-sm text-muted">
                      #{t.trip_no} · {formatDate(t.date)} · {t.plate_number} · {t.for_own_depot ? "Our depot" : t.client_name ?? ""} · {CARGO_LABEL[t.cargo_type]}
                    </p>
                  </div>
                  <Badge variant={TRIP_STATUS_VARIANT[t.status]}>{TRIP_STATUS_LABEL[t.status]}</Badge>
                </div>
                {t.cargo_type === "fuel" ? (
                  <p className="mt-2 text-[15px]">
                    {fuelTypes.find((f) => f.id === t.fuel_type_id)?.name} · loaded {litres(t.litres_loaded)}
                    {t.litres_delivered != null ? ` · delivered ${litres(t.litres_delivered)}` : ""}
                    {t.loading_ticket ? <span className="text-muted"> · ticket {t.loading_ticket}</span> : null}
                  </p>
                ) : null}
                {t.notes ? <p className="mt-1 text-[13px] text-muted">{t.notes}</p> : null}

                {mine.length > 0 ? (
                  <ul className="mt-3 divide-y divide-line rounded-[var(--radius-inner)] bg-surface-3">
                    {mine.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2 px-3.5 py-2 text-[15px]">
                        <span>
                          {TRIP_EXPENSE_CATEGORIES[l.category as keyof typeof TRIP_EXPENSE_CATEGORIES] ?? l.category}
                          {l.description ? <span className="text-muted"> · {l.description}</span> : null}
                        </span>
                        <span className="tabular-nums">{fmt(l.original_amount, l.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {t.status === "planned" ? (
                    <Button size="lg" className="col-span-2" onClick={() => start(t)}>
                      <Play /> Start trip
                    </Button>
                  ) : null}
                  {t.status !== "delivered" ? (
                    <>
                      <Button size="lg" variant="outline" onClick={() => setExpenseFor(t)}>
                        <Plus /> Expense
                      </Button>
                      <Button size="lg" variant={t.status === "on_road" ? "yellow" : "outline"} onClick={() => setDeliverFor(t)}>
                        <Check /> Delivered
                      </Button>
                    </>
                  ) : (
                    <Button size="lg" variant="outline" className="col-span-2" onClick={() => setExpenseFor(t)}>
                      <Plus /> Add a late receipt
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {expenseFor ? <ExpenseModal trip={expenseFor} orgId={orgId} onClose={() => setExpenseFor(null)} /> : null}
      {deliverFor ? <DeliveredModal trip={deliverFor} onClose={() => setDeliverFor(null)} /> : null}
    </>
  );
}

function ExpenseModal({ trip, orgId, onClose }: { trip: DriverTrip; orgId: string; onClose: () => void }) {
  const { enabled, perBase } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [category, setCategory] = useState("fuel");
  const [currency, setCurrency] = useState(trip.currency);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [fromAdvance, setFromAdvance] = useState(true);
  const [receipt, setReceipt] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      z.object({ original_amount: z.number({ error: "Enter the amount" }).positive("Must be more than 0") }),
      { original_amount: toNum(amount) },
      (d) =>
        createClient().from("trip_lines").insert({
          trip_id: trip.id,
          kind: "expense",
          category,
          currency,
          description: note || null,
          paid_from_advance: fromAdvance,
          receipt_path: receipt,
          ...d,
        }),
      "Expense saved",
    );
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Expense · ${trip.route_from} → ${trip.route_to}`}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid grid-cols-2 gap-2">
          {DRIVER_CATS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setCategory(k)}
              className={cn(
                "min-h-[52px] rounded-[var(--radius-tile)] px-2 text-[14px] font-medium",
                category === k ? "bg-black text-white" : "bg-surface-3 shadow-[var(--shadow-soft)]",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <Field label="How much?" htmlFor="me-amt" error={errors.original_amount}>
          <div className="flex gap-2">
            <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-14 w-[96px] px-3">
              {enabled.map((c) => (
                <option key={c} value={c} disabled={!perBase(c)}>
                  {c}
                </option>
              ))}
            </Select>
            <Input id="me-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-14 min-w-0 text-2xl font-semibold" />
          </div>
        </Field>
        <Field label="Note (optional)" htmlFor="me-note">
          <Input id="me-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ReceiptInput orgId={orgId} value={receipt} onChange={setReceipt} />
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" className="size-5 accent-black" checked={fromAdvance} onChange={(e) => setFromAdvance(e.target.checked)} />
          Paid from the cash I was given
        </label>
        <Button type="submit" size="xl" disabled={pending}>
          Save expense
        </Button>
      </form>
    </Modal>
  );
}

function DeliveredModal({ trip, onClose }: { trip: DriverTrip; onClose: () => void }) {
  const router = useRouter();
  const [lit, setLit] = useState(trip.litres_loaded != null ? String(trip.litres_loaded) : "");
  const [odo, setOdo] = useState("");
  const [busy, setBusy] = useState(false);
  const loaded = Number(trip.litres_loaded ?? 0);
  const d = toNum(lit);
  async function go() {
    setBusy(true);
    const { error } = await createClient().rpc("record_delivery", {
      p_trip: trip.id,
      p_litres_delivered: trip.cargo_type === "fuel" ? d ?? null : null,
      p_end_odometer: toNum(odo) ?? null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(trip.for_own_depot ? "Thanks! The office will put the fuel into stock." : "Delivered. Thank you!");
    router.refresh();
    onClose();
  }
  return (
    <Modal open onClose={onClose} title="Delivered">
      <div className="grid gap-4">
        {trip.cargo_type === "fuel" ? (
          <Field
            label="Litres delivered"
            htmlFor="md-lit"
            hint={d !== undefined && loaded ? `Loaded ${litres(loaded)} · short ${litres(loaded - d)} (${num(((loaded - d) / loaded) * 100, 2)}%)` : undefined}
          >
            <Input id="md-lit" inputMode="decimal" value={lit} onChange={(e) => setLit(e.target.value)} className="h-16 text-3xl font-semibold" />
          </Field>
        ) : null}
        <Field label="Odometer now (km)" htmlFor="md-odo">
          <Input id="md-odo" inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        <Button size="xl" variant="yellow" onClick={go} disabled={busy}>
          <Check /> Confirm delivery
        </Button>
      </div>
    </Modal>
  );
}
