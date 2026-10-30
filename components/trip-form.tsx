"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, nairobiToday } from "@/lib/utils";
import type { Customer, FuelType, Supplier, Tank } from "@/lib/types";
import { TRIP_COLUMNS, type FleetDriver, type FleetTruck, type Trip } from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";

const schema = z
  .object({
    date: z.iso.date("Pick the date"),
    truck_id: z.string().uuid("Pick the truck"),
    driver_id: z.string().uuid().nullable(),
    for_own_depot: z.boolean(),
    customer_id: z.string().uuid().nullable(),
    route_from: z.string().trim().min(2, "Where from?"),
    route_to: z.string().trim().min(2, "Where to?"),
    cargo_type: z.enum(["fuel", "goods", "other"]),
    currency: z.string().min(3),
    fee_original: z.number().min(0, "Can't be negative"),
    fuel_type_id: z.string().uuid().nullable(),
    litres_loaded: z.number().positive("Must be more than 0").nullable(),
    loaded_from: z.string().trim().nullable(),
    loading_ticket: z.string().trim().nullable(),
    supplier_id: z.string().uuid().nullable(),
    tank_id: z.string().uuid().nullable(),
    notes: z.string().trim().max(1000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.for_own_depot && !v.customer_id) ctx.addIssue({ code: "custom", path: ["customer_id"], message: "Pick the client" });
    if (v.cargo_type === "fuel" && !v.fuel_type_id) ctx.addIssue({ code: "custom", path: ["fuel_type_id"], message: "Pick the fuel" });
    if (v.for_own_depot && !v.supplier_id) ctx.addIssue({ code: "custom", path: ["supplier_id"], message: "Pick the supplier" });
  });

/** Create or edit a trip. The fee converts to the base currency live; the database captures the rate. */
export function TripForm({
  trip,
  trucks,
  drivers,
  customers,
  fuelTypes,
  suppliers,
  tanks,
  onDone,
}: {
  trip?: Trip | null;
  trucks: FleetTruck[];
  drivers: FleetDriver[];
  customers: Customer[];
  fuelTypes: FuelType[];
  suppliers: Supplier[];
  tanks: Tank[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const { base, enabled, perBase, money, fmt } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [f, setF] = useState({
    date: trip?.date ?? nairobiToday(),
    truck_id: trip?.truck_id ?? "",
    driver_id: trip?.driver_id ?? "",
    for_own_depot: trip?.for_own_depot ?? false,
    customer_id: trip?.customer_id ?? "",
    route_from: trip?.route_from ?? "",
    route_to: trip?.route_to ?? "",
    cargo_type: trip?.cargo_type ?? "goods",
    currency: trip?.currency ?? base,
    fee_original: trip ? String(trip.fee_original) : "",
    fuel_type_id: trip?.fuel_type_id ?? "",
    litres_loaded: trip?.litres_loaded != null ? String(trip.litres_loaded) : "",
    loaded_from: trip?.loaded_from ?? "",
    loading_ticket: trip?.loading_ticket ?? "",
    supplier_id: trip?.supplier_id ?? "",
    tank_id: trip?.tank_id ?? "",
    notes: trip?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const rate = trip ? Number(trip.fx_rate) : perBase(f.currency);
  const fee = toNum(f.fee_original) ?? 0;
  const isFuel = f.cargo_type === "fuel";

  function pickTruck(id: string) {
    const t = trucks.find((x) => x.id === id);
    setF({ ...f, truck_id: id, driver_id: f.driver_id || t?.driver_id || "" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    let newId: string | null = null;
    const ok = await submit(
      schema,
      {
        date: f.date,
        truck_id: f.truck_id,
        driver_id: f.driver_id || null,
        for_own_depot: isFuel && f.for_own_depot,
        customer_id: isFuel && f.for_own_depot ? null : f.customer_id || null,
        route_from: f.route_from,
        route_to: f.route_to,
        cargo_type: f.cargo_type,
        currency: f.currency,
        fee_original: fee,
        fuel_type_id: isFuel ? f.fuel_type_id || null : null,
        litres_loaded: isFuel ? toNum(f.litres_loaded) ?? null : null,
        loaded_from: isFuel ? f.loaded_from || null : null,
        loading_ticket: isFuel ? f.loading_ticket || null : null,
        supplier_id: isFuel && f.for_own_depot ? f.supplier_id || null : null,
        tank_id: isFuel && f.for_own_depot ? f.tank_id || null : null,
        notes: f.notes || null,
      },
      async (data) => {
        if (trip) {
          // Currency is fixed once a trip exists (its rate was captured then).
          const { currency: _c, ...rest } = data;
          void _c;
          return supabase.from("trips").update(rest).eq("id", trip.id);
        }
        const res = await supabase.from("trips").insert(data).select(TRIP_COLUMNS).single();
        newId = res.data?.id ?? null;
        return res;
      },
      trip ? "Trip updated" : "Trip created",
    );
    if (ok) {
      onDone?.();
      if (newId) router.push(`/trips/${newId}`);
    }
  }

  const fuelTanks = tanks.filter((t) => t.fuel_type_id === f.fuel_type_id);

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="tr-date" error={errors.date}>
          <Input id="tr-date" type="date" value={f.date} onChange={set("date")} />
        </Field>
        <Field label="Cargo" htmlFor="tr-cargo">
          <Select id="tr-cargo" value={f.cargo_type} onChange={set("cargo_type")}>
            <option value="goods">Goods</option>
            <option value="fuel">Fuel</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Truck" htmlFor="tr-truck" error={errors.truck_id}>
          <Select id="tr-truck" value={f.truck_id} onChange={(e) => pickTruck(e.target.value)}>
            <option value="">Choose…</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Driver" htmlFor="tr-driver">
          <Select id="tr-driver" value={f.driver_id} onChange={set("driver_id")}>
            <option value="">No driver</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="tr-from" error={errors.route_from}>
          <Input id="tr-from" placeholder="e.g. Port Sudan" value={f.route_from} onChange={set("route_from")} />
        </Field>
        <Field label="To" htmlFor="tr-to" error={errors.route_to}>
          <Input id="tr-to" placeholder="e.g. Khartoum" value={f.route_to} onChange={set("route_to")} />
        </Field>
      </div>

      {isFuel ? (
        <div className="seg w-fit" role="tablist" aria-label="Who is the fuel for?">
          {[false, true].map((own) => (
            <button
              key={String(own)}
              type="button"
              role="tab"
              aria-selected={f.for_own_depot === own}
              onClick={() => setF({ ...f, for_own_depot: own })}
              className={cn(f.for_own_depot === own && "on")}
            >
              {own ? "For our own depot" : "For a client"}
            </button>
          ))}
        </div>
      ) : null}

      {!(isFuel && f.for_own_depot) ? (
        <Field label={isFuel ? "Who it was brought for (client)" : "Client"} htmlFor="tr-client" error={errors.customer_id}>
          <Select id="tr-client" value={f.customer_id} onChange={set("customer_id")}>
            <option value="">Choose…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field
        label={isFuel && f.for_own_depot ? "Internal charge (optional)" : "Trip fee agreed"}
        htmlFor="tr-fee"
        error={errors.fee_original}
        hint={
          f.currency !== base && fee && rate
            ? `≈ ${money(fee / rate)}`
            : isFuel && f.for_own_depot
              ? "Usually 0. If set, it's added to the fuel's cost at the depot."
              : undefined
        }
      >
        <div className="flex gap-2">
          <Select aria-label="Currency" value={f.currency} disabled={!!trip} onChange={set("currency")} className="w-[92px] px-3">
            {enabled.map((c) => (
              <option key={c} value={c} disabled={!perBase(c)}>
                {c}
              </option>
            ))}
          </Select>
          <Input id="tr-fee" inputMode="decimal" value={f.fee_original} onChange={set("fee_original")} className="min-w-0" />
        </div>
      </Field>

      {isFuel ? (
        <div className="inner-box grid grid-cols-2 gap-3">
          <p className="col-span-2 text-sm font-medium">Fuel loaded</p>
          <Field label="Fuel" htmlFor="tr-fuel" error={errors.fuel_type_id}>
            <Select id="tr-fuel" value={f.fuel_type_id} onChange={set("fuel_type_id")}>
              <option value="">Choose…</option>
              {fuelTypes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Litres loaded" htmlFor="tr-loaded" error={errors.litres_loaded}>
            <Input id="tr-loaded" inputMode="decimal" value={f.litres_loaded} onChange={set("litres_loaded")} />
          </Field>
          {f.for_own_depot ? (
            <>
              <Field label="Bought from (supplier)" htmlFor="tr-sup" error={errors.supplier_id}>
                <Select id="tr-sup" value={f.supplier_id} onChange={set("supplier_id")}>
                  <option value="">Choose…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Into tank" htmlFor="tr-tank" hint={fuelTanks.length ? undefined : "No tank yet; pick or create one on delivery."}>
                <Select id="tr-tank" value={f.tank_id} onChange={set("tank_id")}>
                  <option value="">Decide on delivery</option>
                  {fuelTanks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <Field label="Loaded at (supplier / depot)" htmlFor="tr-lfrom" className="col-span-2">
              <Input id="tr-lfrom" value={f.loaded_from} onChange={set("loaded_from")} />
            </Field>
          )}
          <Field label="Loading ticket no." htmlFor="tr-ticket" className="col-span-2">
            <Input id="tr-ticket" value={f.loading_ticket} onChange={set("loading_ticket")} />
          </Field>
        </div>
      ) : null}

      <Field label="Notes" htmlFor="tr-notes">
        <Textarea id="tr-notes" value={f.notes} onChange={set("notes")} />
      </Field>

      {fee > 0 ? (
        <p className="text-[13px] text-muted">
          Fee {fmt(fee, f.currency)}
          {f.currency !== base && rate ? ` = ${money(fee / rate)}` : ""}. Profit updates as you add expenses on the trip page.
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {trip ? "Save trip" : "Create trip"}
      </Button>
    </form>
  );
}
