"use client";

import { useState } from "react";
import { z } from "zod";
import { Droplets, Pencil, Plus, Tag, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, formatDateTime, kes, litres, num } from "@/lib/utils";
import type { FuelType, Tank } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { EmptyState, PageHeader, Progress } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type AdjustmentRow = {
  id: string;
  tank_id: string;
  date: string;
  created_at: string;
  system_litres: number;
  dip_litres: number;
  difference: number;
  reason: string;
  created_by: string | null;
};

const dipSchema = z.object({
  tank_id: z.string().uuid("Pick a tank"),
  dip_litres: z.number({ error: "Enter the dip reading" }).min(0, "Cannot be negative"),
  reason: z.string().trim().min(3, "Give a reason (e.g. evaporation, weekly dip)"),
});

const tankSchema = z.object({
  name: z.string().trim().min(2, "Enter a tank name"),
  fuel_type_id: z.string().uuid("Pick the fuel type"),
  capacity_litres: z.number({ error: "Enter capacity" }).positive("Must be more than 0"),
  low_stock_level: z.number({ error: "Enter the low-stock level" }).min(0),
});

const priceSchema = z.object({
  current_selling_price: z.number({ error: "Enter a price" }).positive("Must be more than 0"),
});

export function StockClient({
  tanks,
  fuelTypes,
  adjustments,
  valueByTank,
  staff,
}: {
  tanks: Tank[];
  fuelTypes: FuelType[];
  adjustments: AdjustmentRow[];
  valueByTank: Record<string, { avg: number; value: number }> | null;
  staff: { id: string; full_name: string }[];
}) {
  const [editingTank, setEditingTank] = useState<Tank | "new" | null>(null);
  const [editingPrice, setEditingPrice] = useState<FuelType | null>(null);
  const fuelName = (id: string) => fuelTypes.find((f) => f.id === id)?.name ?? "";
  const tankName = (id: string) => tanks.find((t) => t.id === id)?.name ?? "";
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "";
  const totalValue = valueByTank ? Object.values(valueByTank).reduce((s, v) => s + v.value, 0) : null;

  return (
    <>
      <PageHeader
        title="Fuel stock"
        description={totalValue !== null ? `Your fuel is worth ${kes(totalValue)} at what it cost you` : "How much fuel is left in each tank"}
        actions={
          <Button variant="outline" onClick={() => setEditingTank("new")}>
            <Plus /> Tank
          </Button>
        }
      />

      {tanks.length === 0 ? (
        <EmptyState
          icon={<Droplets />}
          title="No tanks yet"
          description="Add your fuel types' prices below, then add tanks."
          action={<Button onClick={() => setEditingTank("new")}>Add tank</Button>}
        />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tanks.map((t) => {
            const pct = (Number(t.current_litres) / Number(t.capacity_litres)) * 100;
            const low = Number(t.current_litres) <= Number(t.low_stock_level);
            const v = valueByTank?.[t.id];
            return (
              <Card key={t.id} className={cn(low && "border-orange/40")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{fuelName(t.fuel_type_id)}</p>
                    </div>
                    <button onClick={() => setEditingTank(t)} className="p-1 text-muted-foreground" aria-label="Edit tank">
                      <Pencil className="size-4" />
                    </button>
                  </div>
                  <p className="mt-3 text-2xl font-bold tabular-nums">{litres(t.current_litres)}</p>
                  <Progress value={pct} tone={low ? "low" : "ok"} className="mt-2" />
                  <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>{num(pct, 0)}% of {litres(t.capacity_litres)}</span>
                    {low ? (
                      <span className="flex items-center gap-1 font-medium text-orange">
                        <TriangleAlert className="size-3" /> Running low
                      </span>
                    ) : (
                      <span>Warns below {litres(t.low_stock_level)}</span>
                    )}
                  </div>
                  {v ? (
                    <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                      Cost {kes(v.avg)}/L on average · worth <span className="font-medium text-fg">{kes(v.value)}</span>
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="grid h-fit gap-6">
          <DipForm tanks={tanks} />
          <Card>
            <CardHeader>
              <CardTitle>Pump prices</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {fuelTypes.some((f) => Number(f.current_selling_price) === 0) ? (
                <p className="rounded-[var(--radius-inner)] bg-yellow p-3 text-sm text-[#1c1c1a]">
                  Set a pump price for each fuel before recording sales.
                </p>
              ) : null}
              {fuelTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fuel types found for your business.</p>
              ) : (
                fuelTypes.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-[var(--radius-inner)] bg-surface-3 px-4 py-2.5 shadow-[var(--shadow-soft)]">
                    <span className="font-medium">{f.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{kes(f.current_selling_price)}/L</span>
                      <Button size="sm" variant="ghost" onClick={() => setEditingPrice(f)}>
                        <Tag /> Change
                      </Button>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <h2 className="card-title mb-3">Past dip readings</h2>
          {adjustments.length === 0 ? (
            <EmptyState title="No dip readings yet" description="Measure a tank with the dipstick and record it to keep the numbers honest." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Tank</TH>
                  <TH className="text-right">App expected</TH>
                  <TH className="text-right">Measured</TH>
                  <TH className="text-right">Difference</TH>
                  <TH>Reason</TH>
                  <TH>By</TH>
                </tr>
              </THead>
              <TBody>
                {adjustments.map((a) => (
                  <TR key={a.id}>
                    <TD>{formatDateTime(a.created_at)}</TD>
                    <TD>{tankName(a.tank_id)}</TD>
                    <TD className="text-right tabular-nums">{num(a.system_litres)}</TD>
                    <TD className="text-right tabular-nums">{num(a.dip_litres)}</TD>
                    <TD
                      className={cn(
                        "text-right font-medium tabular-nums",
                        Number(a.difference) < 0 ? "text-orange" : Number(a.difference) > 0 ? "text-green" : "",
                      )}
                    >
                      {Number(a.difference) > 0 ? "+" : ""}
                      {num(a.difference)}
                    </TD>
                    <TD className="max-w-60 truncate">{a.reason}</TD>
                    <TD>{staffName(a.created_by)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      {editingTank ? (
        <TankForm tank={editingTank === "new" ? null : editingTank} fuelTypes={fuelTypes} onClose={() => setEditingTank(null)} />
      ) : null}
      {editingPrice ? <PriceForm fuel={editingPrice} onClose={() => setEditingPrice(null)} /> : null}
    </>
  );
}

function DipForm({ tanks }: { tanks: Tank[] }) {
  const { submit, pending, errors } = useSubmit();
  const [tankId, setTankId] = useState("");
  const [dip, setDip] = useState("");
  const [reason, setReason] = useState("");
  const tank = tanks.find((t) => t.id === tankId);
  const dipN = toNum(dip);
  const diff = tank && dipN !== undefined ? dipN - Number(tank.current_litres) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      dipSchema,
      { tank_id: tankId, dip_litres: dipN, reason },
      // system_litres is captured by the database at the moment of saving
      (data) => createClient().from("stock_adjustments").insert({ ...data, system_litres: 0 }),
      "Saved. Tank level updated to what you measured.",
    );
    if (ok) {
      setDip("");
      setReason("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">Measure a tank (dip reading) <InfoTip>A dip reading is when you measure the fuel in the tank with a dipstick. The app compares it with what it expected and corrects the tank level.</InfoTip></CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Tank" htmlFor="dtank" error={errors.tank_id}>
            <Select id="dtank" value={tankId} onChange={(e) => setTankId(e.target.value)}>
              <option value="">Select…</option>
              {tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="App expects (L)">
              <Input disabled value={tank ? num(tank.current_litres) : ""} />
            </Field>
            <Field label="You measured (L)" htmlFor="dip" error={errors.dip_litres}>
              <Input id="dip" inputMode="decimal" value={dip} onChange={(e) => setDip(e.target.value)} />
            </Field>
          </div>
          {diff !== null ? (
            <div
              className={cn(
                "flex justify-between rounded-[var(--radius-inner)] p-3.5 text-[15px] font-semibold",
                diff < 0 ? "bg-orange text-white" : diff > 0 ? "bg-green text-white" : "bg-surface-2",
              )}
            >
              <span>{diff < 0 ? "Missing" : diff > 0 ? "Extra" : "Matches"}</span>
              <span className="tabular-nums">
                {diff > 0 ? "+" : ""}
                {num(diff)} L
              </span>
            </div>
          ) : null}
          <Field label="Reason" htmlFor="reason" error={errors.reason}>
            <Textarea id="reason" placeholder="Weekly dip, evaporation, leak…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            Save reading
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TankForm({ tank, fuelTypes, onClose }: { tank: Tank | null; fuelTypes: FuelType[]; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [name, setName] = useState(tank?.name ?? "");
  const [fuelId, setFuelId] = useState(tank?.fuel_type_id ?? "");
  const [capacity, setCapacity] = useState(tank ? String(tank.capacity_litres) : "");
  const [low, setLow] = useState(tank ? String(tank.low_stock_level) : "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const ok = await submit(
      tankSchema,
      { name, fuel_type_id: fuelId, capacity_litres: toNum(capacity), low_stock_level: toNum(low) },
      (data) => (tank ? supabase.from("tanks").update(data).eq("id", tank.id) : supabase.from("tanks").insert(data)),
      tank ? "Tank updated" : "Tank added (starts empty; record a delivery to fill it)",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={tank ? `Edit ${tank.name}` : "Add tank"}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Name" htmlFor="tname" error={errors.name}>
          <Input id="tname" placeholder="Tank 4 - Diesel" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Fuel type" htmlFor="tfuel" error={errors.fuel_type_id}>
          <Select id="tfuel" value={fuelId} onChange={(e) => setFuelId(e.target.value)} disabled={!!tank}>
            <option value="">Select…</option>
            {fuelTypes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacity (L)" htmlFor="tcap" error={errors.capacity_litres}>
            <Input id="tcap" inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
          <Field label="Warn me below (L)" htmlFor="tlow" error={errors.low_stock_level}>
            <Input id="tlow" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {tank ? "Save" : "Add tank"}
        </Button>
      </form>
    </Modal>
  );
}

function PriceForm({ fuel, onClose }: { fuel: FuelType; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [price, setPrice] = useState(String(fuel.current_selling_price));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      priceSchema,
      { current_selling_price: toNum(price) },
      (data) => createClient().from("fuel_types").update(data).eq("id", fuel.id),
      `${fuel.name} price updated`,
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`${fuel.name} pump price`}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Price per litre (KES)" htmlFor="price" error={errors.current_selling_price} hint="Applies to new sales immediately.">
          <Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="h-14 text-2xl font-bold" />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          Update price
        </Button>
      </form>
    </Modal>
  );
}
