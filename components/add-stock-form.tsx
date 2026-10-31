"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, litres, nairobiToday, num } from "@/lib/utils";
import type { FuelType, Supplier, Tank, Truck } from "@/lib/types";
import { NO_REFS, type PriceRefs } from "@/lib/price-check";
import { CONFIRM_FIRST, PriceSummary, usePriceCheck } from "@/components/price-check";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";

const NEW = "__new__";

const schema = z
  .object({
    fuel: z.string().uuid("Pick the fuel"),
    tank: z.string().min(1, "Pick the tank"),
    newTankName: z.string().trim(),
    newTankCapacity: z.number().optional(),
    litres: z.number({ error: "Enter the litres" }).positive("Must be more than 0"),
    cost: z.number({ error: "Enter the cost" }).positive("Must be more than 0"),
    sellPrice: z.number().positive("Must be more than 0").optional(),
    supplier: z.string().min(1, "Pick or add a supplier"),
    newSupplier: z.string().trim(),
    truck: z.string().min(1, "Pick or add a truck"),
    newTruck: z.string().trim(),
    trip: z.number().min(0),
    date: z.iso.date("Pick the date"),
  })
  .superRefine((v, ctx) => {
    if (v.tank === NEW && v.newTankName.length < 2) ctx.addIssue({ code: "custom", path: ["newTankName"], message: "Name the tank" });
    if (v.tank === NEW && !(v.newTankCapacity && v.newTankCapacity > 0))
      ctx.addIssue({ code: "custom", path: ["newTankCapacity"], message: "How many litres does it hold?" });
    if (v.supplier === NEW && v.newSupplier.length < 2) ctx.addIssue({ code: "custom", path: ["newSupplier"], message: "Enter the supplier's name" });
    if (v.truck === NEW && v.newTruck.length < 4) ctx.addIssue({ code: "custom", path: ["newTruck"], message: "Enter the plate number" });
  });

/**
 * Add stock: owner and sales manager. Creates a tank / supplier / truck inline when needed
 * and records the delivery in one database call (add_stock). The litres are sellable at once.
 */
export function AddStockForm({
  fuelTypes,
  tanks,
  suppliers,
  trucks,
  defaultFuelId,
  onDone,
  refs = NO_REFS,
}: {
  fuelTypes: FuelType[];
  tanks: Tank[];
  suppliers: Supplier[];
  trucks: Truck[];
  defaultFuelId?: string;
  onDone?: () => void;
  /** Usual prices, for the "this looks wrong" warnings */
  refs?: PriceRefs;
}) {
  const { base, enabled, perBase, money, fmt } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [fuel, setFuel] = useState(defaultFuelId ?? fuelTypes[0]?.id ?? "");
  const fuelTanks = tanks.filter((t) => t.fuel_type_id === fuel);
  const [tank, setTank] = useState(fuelTanks[0]?.id ?? NEW);
  const [newTankName, setNewTankName] = useState("");
  const [newTankCapacity, setNewTankCapacity] = useState("");
  const [qty, setQty] = useState("");
  const [costMode, setCostMode] = useState<"per_litre" | "total">("per_litre");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState(base);
  const [sellPrice, setSellPrice] = useState("");
  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? NEW);
  const [newSupplier, setNewSupplier] = useState("");
  const [truck, setTruck] = useState(trucks[0]?.id ?? NEW);
  const [newTruck, setNewTruck] = useState("");
  const [trip, setTrip] = useState("");
  const [date, setDate] = useState(nairobiToday());

  const rate = perBase(currency);
  const l = toNum(qty) ?? 0;
  const c = toNum(cost) ?? 0;
  const tripN = toNum(trip) ?? 0;
  const fuelTotal = costMode === "total" ? c : c * l;
  const perLitre = l > 0 ? (costMode === "total" ? c / l : c) : 0;
  const allIn = fuelTotal + tripN;
  const realPerLitre = l > 0 ? allIn / l : 0;
  const selectedTank = fuelTanks.find((t) => t.id === tank);
  const free = selectedTank ? Number(selectedTank.capacity_litres) - Number(selectedTank.current_litres) : toNum(newTankCapacity) ?? null;
  const currentPrice = useMemo(() => {
    const f = fuelTypes.find((x) => x.id === fuel);
    return f && rate ? Number(f.current_selling_price) * rate : 0;
  }, [fuel, fuelTypes, rate]);

  // Warn when the price is far from what this fuel usually costs or sells for (compared in the base currency).
  const fuelRefs = refs.fuel[fuel];
  const costCheck = usePriceCheck(rate ? perLitre / rate : 0, [
    { label: "last price", value: fuelRefs?.lastCost },
    { label: "tank average cost", value: selectedTank ? refs.tankAvg[selectedTank.id] : null },
  ], true);
  const sellN = toNum(sellPrice) ?? 0;
  const sellCheck = usePriceCheck(rate ? sellN / rate : 0, [
    { label: "pump price", value: fuelRefs?.pump },
    { label: "last sale price", value: fuelRefs?.lastSale },
  ], true);

  function changeFuel(id: string) {
    setFuel(id);
    setTank(tanks.find((t) => t.fuel_type_id === id)?.id ?? NEW);
    setSellPrice("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!costCheck.ok || !sellCheck.ok) return toast.error(CONFIRM_FIRST);
    const ok = await submit(
      schema,
      {
        fuel,
        tank,
        newTankName,
        newTankCapacity: toNum(newTankCapacity),
        litres: toNum(qty),
        cost: toNum(cost),
        sellPrice: toNum(sellPrice),
        supplier,
        newSupplier,
        truck,
        newTruck,
        trip: tripN,
        date,
      },
      (d) =>
        createClient().rpc("add_stock", {
          p_fuel_type_id: d.fuel,
          p_litres: d.litres,
          p_currency: currency,
          p_cost_per_litre: costMode === "per_litre" ? d.cost : null,
          p_cost_total: costMode === "total" ? d.cost : null,
          p_selling_price: d.sellPrice ?? null,
          p_tank_id: d.tank === NEW ? null : d.tank,
          p_new_tank_name: d.tank === NEW ? d.newTankName : null,
          p_new_tank_capacity: d.tank === NEW ? d.newTankCapacity : null,
          p_supplier_id: d.supplier === NEW ? null : d.supplier,
          p_new_supplier_name: d.supplier === NEW ? d.newSupplier : null,
          p_truck_id: d.truck === NEW ? null : d.truck,
          p_new_truck_plate: d.truck === NEW ? d.newTruck : null,
          p_trip_cost: d.trip,
          p_date: d.date,
        }),
      `${num(l)} L added. It can be sold now.`,
    );
    if (ok) {
      setQty("");
      setCost("");
      setTrip("");
      setSellPrice("");
      setNewTankName("");
      setNewTankCapacity("");
      onDone?.();
    }
  }

  const currencySelect = (
    <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[92px] px-3">
      {enabled.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </Select>
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fuel" htmlFor="as-fuel" error={errors.fuel}>
          <Select id="as-fuel" value={fuel} onChange={(e) => changeFuel(e.target.value)}>
            {fuelTypes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Into tank" htmlFor="as-tank" error={errors.tank}>
          <Select id="as-tank" value={tank} onChange={(e) => setTank(e.target.value)}>
            {fuelTanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={NEW}>+ New tank</option>
          </Select>
        </Field>
      </div>
      {tank === NEW ? (
        <div className="inner-box grid grid-cols-2 gap-3">
          <p className="col-span-2 text-[13px] text-muted">No tank for this fuel yet. Name it and we&apos;ll create it.</p>
          <Field label="Tank name" htmlFor="as-tname" error={errors.newTankName}>
            <Input id="as-tname" placeholder="e.g. Diesel tank 1" value={newTankName} onChange={(e) => setNewTankName(e.target.value)} />
          </Field>
          <Field label="Holds (litres)" htmlFor="as-tcap" error={errors.newTankCapacity}>
            <Input id="as-tcap" inputMode="decimal" value={newTankCapacity} onChange={(e) => setNewTankCapacity(e.target.value)} />
          </Field>
        </div>
      ) : null}

      <Field label="Litres delivered" htmlFor="as-litres" error={errors.litres} hint={free !== null ? `Room for ${litres(free)}` : undefined}>
        <Input id="as-litres" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      {free !== null && l > free ? <p className="-mt-2 text-[13px] text-orange">That won&apos;t fit in the tank.</p> : null}

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">What you paid</span>
          <div className="seg text-sm" role="tablist" aria-label="Cost entered as">
            {(["per_litre", "total"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={costMode === m}
                onClick={() => setCostMode(m)}
                className={cn("!px-4 !py-2 !text-sm", costMode === m && "on")}
              >
                {m === "per_litre" ? "Per litre" : "Total"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {currencySelect}
          <Input
            aria-label={costMode === "per_litre" ? "Cost per litre" : "Total cost"}
            inputMode="decimal"
            placeholder={costMode === "per_litre" ? "Cost per litre" : "Total for this delivery"}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>
        {errors.cost ? <p className="text-[13px] text-orange">{errors.cost}</p> : null}
      </div>
      {c > 0 && l > 0 ? <PriceSummary perLitre={perLitre} total={fuelTotal} currency={currency} label="Fuel total" /> : null}
      {costCheck.node}

      <Field
        label={`Sell it for, per litre (${currency})`}
        htmlFor="as-sell"
        error={errors.sellPrice}
        hint={currentPrice ? `Now ${fmt(currentPrice, currency)}. Leave empty to keep it.` : "Set the pump price so it can be sold."}
      >
        <Input id="as-sell" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
      </Field>
      {sellN > 0 ? <PriceSummary perLitre={sellN} total={l > 0 ? sellN * l : null} currency={currency} label="If all sold" /> : null}
      {sellCheck.node}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier" htmlFor="as-sup" error={errors.supplier}>
          <Select id="as-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={NEW}>+ New supplier</option>
          </Select>
        </Field>
        <Field label="Truck" htmlFor="as-truck" error={errors.truck}>
          <Select id="as-truck" value={truck} onChange={(e) => setTruck(e.target.value)}>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
              </option>
            ))}
            <option value={NEW}>+ New truck</option>
          </Select>
        </Field>
        {supplier === NEW ? (
          <Field label="Supplier name" htmlFor="as-nsup" error={errors.newSupplier}>
            <Input id="as-nsup" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        {truck === NEW ? (
          <Field label="Plate number" htmlFor="as-ntruck" error={errors.newTruck}>
            <Input id="as-ntruck" placeholder="e.g. KCA 123A" value={newTruck} onChange={(e) => setNewTruck(e.target.value)} />
          </Field>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Trip cost (${currency})`} htmlFor="as-trip" hint="Driver, truck fuel, tolls">
          <Input id="as-trip" inputMode="decimal" placeholder="0" value={trip} onChange={(e) => setTrip(e.target.value)} />
        </Field>
        <Field label="Delivery date" htmlFor="as-date" error={errors.date}>
          <Input id="as-date" type="date" max={nairobiToday()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="inner-box grid gap-1.5 text-[15px]">
        <Row label="Fuel" value={fmt(fuelTotal, currency)} />
        <Row label="Trip" value={fmt(tripN, currency)} />
        <Row label="Total paid" value={fmt(allIn, currency)} strong />
        {currency !== base && rate ? <Row label={`In ${base}`} value={money(allIn / rate)} /> : null}
        <div className="mt-1 flex items-center justify-between border-t border-line pt-2 font-semibold">
          <span className="flex items-center gap-1.5">
            Real cost per litre
            <InfoTip>What one litre really cost once it reached your tank: fuel price plus the trip cost, divided by the litres.</InfoTip>
          </span>
          <span className="tabular-nums">
            {fmt(realPerLitre, currency)}
            {currency !== base && rate ? <span className="ml-1 text-[13px] font-normal text-muted">≈ {money(realPerLitre / rate)}</span> : null}
          </span>
        </div>
        {perLitre && costMode === "total" ? <p className="text-[13px] text-muted">Fuel alone: {fmt(perLitre, currency)} per litre</p> : null}
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        Add stock
      </Button>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "font-semibold")}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
