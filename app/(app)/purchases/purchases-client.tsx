"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";
import { Ban, PackagePlus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { formatDate, litres, nairobiToday, num } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import type { FuelType, Supplier, Tank, Truck } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type DeliveryRow = {
  id: string;
  date: string;
  supplier_id: string;
  truck_id: string;
  tank_id: string;
  litres: number;
  cost_per_litre?: number;
  fuel_cost?: number;
  trip_cost?: number;
  landed_cost_per_litre?: number;
};

const schema = z.object({
  date: z.iso.date("Pick a date"),
  truck_id: z.string().uuid("Pick the truck"),
  supplier_id: z.string().uuid("Pick the supplier"),
  tank_id: z.string().uuid("Pick the tank"),
  litres: z.number({ error: "Enter litres" }).positive("Must be more than 0"),
  cost_per_litre: z.number({ error: "Enter cost per litre" }).positive("Must be more than 0"),
  trip_cost: z.number().min(0, "Cannot be negative"),
});

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier's name"),
  phone: z.string().trim().nullable(),
  location: z.string().trim().nullable(),
});

export function PurchasesClient({
  rows,
  trucks,
  suppliers,
  tanks,
  fuelTypes,
  isOwner,
  filter,
}: {
  rows: DeliveryRow[];
  trucks: Truck[];
  suppliers: Supplier[];
  tanks: Tank[];
  fuelTypes: FuelType[];
  isOwner: boolean;
  filter: { truck: string; supplier: string };
}) {
  const { money } = useMoney();
  const router = useRouter();
  const pathname = usePathname();
  const [supplierOpen, setSupplierOpen] = useState(false);
  const name = {
    truck: (id: string) => trucks.find((t) => t.id === id)?.plate_number ?? "—",
    supplier: (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—",
    tank: (id: string) => tanks.find((t) => t.id === id)?.name ?? "—",
  };

  function setFilter(key: "truck" | "supplier", value: string) {
    const params = new URLSearchParams({ ...filter, [key]: value });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  const totalLitres = rows.reduce((s, r) => s + Number(r.litres), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.fuel_cost ?? 0) + Number(r.trip_cost ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Record fuel your trucks bring into the depot."
        actions={
          <Button variant="outline" onClick={() => setSupplierOpen(true)}>
            <Plus /> Supplier
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <DeliveryForm trucks={trucks} suppliers={suppliers} tanks={tanks} fuelTypes={fuelTypes} />

        <div className="min-w-0">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Select aria-label="Filter by truck" value={filter.truck} onChange={(e) => setFilter("truck", e.target.value)}>
              <option value="">All trucks</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.plate_number}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by supplier" value={filter.supplier} onChange={(e) => setFilter("supplier", e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="mb-2 text-sm text-muted-foreground">
            {rows.length} deliveries · {litres(totalLitres)}
            {isOwner ? ` · ${money(totalCost)} total cost` : ""}
          </p>
          {rows.length === 0 ? (
            <EmptyState icon={<PackagePlus />} title="No deliveries yet" description="Record the first fuel delivery with the form." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Truck</TH>
                  <TH>Supplier</TH>
                  <TH>Tank</TH>
                  <TH className="text-right">Litres</TH>
                  {isOwner ? (
                    <>
                      <TH className="text-right">Cost / L</TH>
                      <TH className="text-right">Trip</TH>
                      <TH className="text-right">
                        <span className="inline-flex items-center gap-1.5">Real cost / L {<InfoTip>What one litre really cost you once it reached your tank: the fuel price plus the trip cost (driver, truck fuel, tolls), divided by the litres delivered.</InfoTip>}</span>
                      </TH>
                      <TH />
                    </>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD>{formatDate(r.date)}</TD>
                    <TD className="font-medium">{name.truck(r.truck_id)}</TD>
                    <TD>{name.supplier(r.supplier_id)}</TD>
                    <TD>{name.tank(r.tank_id)}</TD>
                    <TD className="text-right tabular-nums">{num(r.litres)}</TD>
                    {isOwner ? (
                      <>
                        <TD className="text-right tabular-nums">{num(r.cost_per_litre, 4)}</TD>
                        <TD className="text-right tabular-nums">{money(r.trip_cost)}</TD>
                        <TD className="text-right tabular-nums">{num(r.landed_cost_per_litre, 4)}</TD>
                        <TD>
                          <VoidButton id={r.id} label={`${num(r.litres)} L on ${formatDate(r.date)}`} />
                        </TD>
                      </>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      {supplierOpen ? <SupplierForm onClose={() => setSupplierOpen(false)} /> : null}
    </>
  );
}

function DeliveryForm({
  trucks,
  suppliers,
  tanks,
  fuelTypes,
}: {
  trucks: Truck[];
  suppliers: Supplier[];
  tanks: Tank[];
  fuelTypes: FuelType[];
}) {
  const { money } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [date, setDate] = useState(nairobiToday());
  const [truckId, setTruckId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [tankId, setTankId] = useState("");
  const [qty, setQty] = useState("");
  const [cpl, setCpl] = useState("");
  const [trip, setTrip] = useState("");

  const l = toNum(qty) ?? 0;
  const c = toNum(cpl) ?? 0;
  const tripCost = toNum(trip) ?? 0;
  const fuelCost = l * c;
  const landed = l > 0 ? (fuelCost + tripCost) / l : 0;
  const tank = tanks.find((t) => t.id === tankId);
  const free = tank ? Number(tank.capacity_litres) - Number(tank.current_litres) : null;
  const fuelName = (id: string) => fuelTypes.find((f) => f.id === id)?.name ?? "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const ok = await submit(
      schema,
      {
        date,
        truck_id: truckId,
        supplier_id: supplierId,
        tank_id: tankId,
        litres: toNum(qty),
        cost_per_litre: toNum(cpl),
        trip_cost: toNum(trip) ?? 0,
      },
      // fuel_type_id is filled from the tank by the database trigger
      (data) => supabase.from("purchases").insert({ ...data, fuel_type_id: tank!.fuel_type_id }),
      `Delivery of ${num(l)} L recorded`,
    );
    if (ok) {
      setQty("");
      setCpl("");
      setTrip("");
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Record delivery</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Truck" htmlFor="truck" error={errors.truck_id}>
              <Select id="truck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                <option value="">Select…</option>
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plate_number}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="pdate" error={errors.date}>
              <Input id="pdate" type="date" value={date} max={nairobiToday()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Supplier" htmlFor="supplier" error={errors.supplier_id}>
            <Select id="supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Into tank"
            htmlFor="tank"
            error={errors.tank_id}
            hint={free !== null ? `Room for ${litres(free)} more` : undefined}
          >
            <Select id="tank" value={tankId} onChange={(e) => setTankId(e.target.value)}>
              <option value="">Select…</option>
              {tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({fuelName(t.fuel_type_id)})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Litres" htmlFor="litres" error={errors.litres}>
              <Input id="litres" inputMode="decimal" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Cost per litre (KES)" htmlFor="cpl" error={errors.cost_per_litre}>
              <Input id="cpl" inputMode="decimal" placeholder="0.00" value={cpl} onChange={(e) => setCpl(e.target.value)} />
            </Field>
          </div>
          <Field label="Trip cost" htmlFor="trip" error={errors.trip_cost} hint="Driver pay, the truck's own fuel and tolls for this trip.">
            <Input id="trip" inputMode="decimal" placeholder="0.00" value={trip} onChange={(e) => setTrip(e.target.value)} />
          </Field>

          <div className="inner-box grid gap-1.5 text-[15px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fuel cost</span>
              <span className="tabular-nums">{money(fuelCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trip cost</span>
              <span className="tabular-nums">{money(tripCost)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total paid</span>
              <span className="tabular-nums">{money(fuelCost + tripCost)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-line pt-2 font-semibold">
              <span className="flex items-center gap-1.5">Real cost per litre <InfoTip>What one litre really cost you once it reached your tank: the fuel price plus the trip cost (driver, truck fuel, tolls), divided by the litres delivered.</InfoTip></span>
              <span className="tabular-nums">{money(landed)}</span>
            </div>
          </div>
          {free !== null && l > free ? (
            <p className="text-[15px] text-orange">That won&apos;t fit. It&apos;s more than the empty space in this tank.</p>
          ) : null}

          <Button type="submit" size="lg" disabled={pending}>
            Record delivery
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VoidButton({ id, label }: { id: string; label: string }) {
  const { submit, pending } = useSubmit();
  async function onVoid() {
    if (!confirm(`Void delivery of ${label}? Stock will be reduced. This is logged.`)) return;
    await submit(
      z.object({}),
      {},
      () => createClient().from("purchases").update({ deleted_at: new Date().toISOString() }).eq("id", id),
      "Delivery voided",
    );
  }
  return (
    <Button variant="ghost" size="sm" onClick={onVoid} disabled={pending} title="Void delivery">
      <Ban />
    </Button>
  );
}

function SupplierForm({ onClose }: { onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [nameV, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      supplierSchema,
      { name: nameV, phone: phone || null, location: location || null },
      (data) => createClient().from("suppliers").insert(data),
      "Supplier added",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Add supplier">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Name" htmlFor="sname" error={errors.name}>
          <Input id="sname" value={nameV} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="sphone">
          <Input id="sphone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Location" htmlFor="sloc">
          <Input id="sloc" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          Add supplier
        </Button>
      </form>
    </Modal>
  );
}
