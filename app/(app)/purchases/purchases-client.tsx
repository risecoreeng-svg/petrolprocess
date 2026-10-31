"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";
import { PackagePlus, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { formatDate, litres, num } from "@/lib/utils";
import type { FuelType, Supplier, Tank, Truck } from "@/lib/types";
import type { PriceRefs } from "@/lib/price-check";
import { useMoney } from "@/components/money-provider";
import { AddStockForm } from "@/components/add-stock-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Modal } from "@/components/ui/modal";
import { DeleteButton, useMayChange } from "@/components/delete-record";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type DeliveryRow = {
  id: string;
  date: string;
  supplier_id: string;
  truck_id: string;
  tank_id: string;
  fuel_type_id: string;
  litres: number;
  currency: string;
  original_total: number;
  fuel_cost: number;
  trip_cost: number;
  landed_cost_per_litre: number;
  original_cost_per_litre: number;
  original_trip_cost: number;
  trip_id: string | null;
  created_by: string | null;
  created_at: string;
};

export function PurchasesClient({
  rows,
  trucks,
  suppliers,
  tanks,
  fuelTypes,
  filter,
  refs,
}: {
  rows: DeliveryRow[];
  trucks: Truck[];
  suppliers: Supplier[];
  tanks: Tank[];
  fuelTypes: FuelType[];
  filter: { truck: string; supplier: string };
  refs: PriceRefs;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { money, fmt, base } = useMoney();
  const name = {
    truck: (id: string) => trucks.find((t) => t.id === id)?.plate_number ?? "—",
    supplier: (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—",
    tank: (id: string) => tanks.find((t) => t.id === id)?.name ?? "—",
    fuel: (id: string) => fuelTypes.find((f) => f.id === id)?.name ?? "",
  };

  function setFilter(key: "truck" | "supplier", value: string) {
    const params = new URLSearchParams({ ...filter, [key]: value });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  const totalLitres = rows.reduce((s, r) => s + Number(r.litres), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.fuel_cost) + Number(r.trip_cost), 0);

  return (
    <>
      <PageHeader title="Add stock" description="Record fuel that arrived. It can be sold as soon as you save it." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New delivery</CardTitle>
          </CardHeader>
          <CardContent>
            <AddStockForm fuelTypes={fuelTypes} tanks={tanks} suppliers={suppliers} trucks={trucks} refs={refs} />
          </CardContent>
        </Card>

        <div className="min-w-0">
          <h2 className="card-title mb-3">Past deliveries</h2>
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
          <p className="mb-3 text-[15px] text-muted">
            {rows.length} deliveries · {litres(totalLitres)} · {money(totalCost)} paid
          </p>
          {rows.length === 0 ? (
            <EmptyState icon={<PackagePlus />} title="No deliveries yet" description="Add your first stock with the form." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Fuel · tank</TH>
                  <TH>Truck</TH>
                  <TH>Supplier</TH>
                  <TH className="text-right">Litres</TH>
                  <TH className="text-right">Paid</TH>
                  <TH className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      Real cost / L
                      <InfoTip>Fuel price plus trip cost, per litre, in {base}.</InfoTip>
                    </span>
                  </TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD>{formatDate(r.date)}</TD>
                    <TD>
                      {name.fuel(r.fuel_type_id)} · <span className="text-muted">{name.tank(r.tank_id)}</span>
                    </TD>
                    <TD className="font-medium">{name.truck(r.truck_id)}</TD>
                    <TD>{name.supplier(r.supplier_id)}</TD>
                    <TD className="text-right tabular-nums">{num(r.litres)}</TD>
                    <TD className="text-right tabular-nums">
                      {fmt(r.original_total, r.currency)}
                      {r.currency !== base ? (
                        <span className="block text-[13px] text-muted">{money(Number(r.fuel_cost) + Number(r.trip_cost))}</span>
                      ) : null}
                    </TD>
                    <TD className="text-right tabular-nums">{money(r.landed_cost_per_litre)}</TD>
                    <TD className="py-2">
                      <RowActions row={r} what={`the delivery of ${num(r.litres)} L on ${formatDate(r.date)}`} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}

/** Edit and Delete for one delivery (owner, or whoever entered it within the time window). */
function RowActions({ row, what }: { row: DeliveryRow; what: string }) {
  const [editing, setEditing] = useState(false);
  const canEdit = useMayChange("purchase", row.created_by, row.created_at) && !row.trip_id;
  return (
    <div className="flex justify-end gap-0.5">
      {canEdit ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} title="Edit delivery" aria-label={`Edit ${what}`}>
          <Pencil />
        </Button>
      ) : null}
      <DeleteButton kind="purchase" id={row.id} createdBy={row.created_by} createdAt={row.created_at} what={what} onEdit={canEdit ? () => setEditing(true) : undefined} />
      {editing ? <EditDelivery row={row} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

const editSchema = z.object({
  litres: z.number({ error: "Enter the litres" }).positive("Must be more than 0"),
  cost: z.number({ error: "Enter the cost per litre" }).positive("Must be more than 0"),
  trip: z.number().min(0, "Can't be negative"),
  date: z.string().min(10, "Pick a date"),
});

/** Changing a delivery takes the old litres and cost out of the tank and puts the new ones in. */
function EditDelivery({ row, onClose }: { row: DeliveryRow; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [v, setV] = useState({
    litres: String(row.litres),
    cost: String(row.original_cost_per_litre),
    trip: String(row.original_trip_cost ?? 0),
    date: row.date,
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  async function onSave() {
    const ok = await submit(
      editSchema,
      { litres: toNum(v.litres), cost: toNum(v.cost), trip: toNum(v.trip) ?? 0, date: v.date },
      (d) => createClient().rpc("edit_purchase", { p_id: row.id, p_litres: d.litres, p_cost_per_litre: d.cost, p_trip_cost: d.trip, p_date: d.date }),
      "Delivery updated",
    );
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="Edit delivery">
      <div className="space-y-4">
        <p className="text-[14px] text-muted">
          Amounts are in {row.currency}, at the rate used when the delivery was recorded. The tank&apos;s stock and average cost are
          recalculated.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Litres" htmlFor="e-litres" error={errors.litres}>
            <Input id="e-litres" inputMode="decimal" value={v.litres} onChange={set("litres")} />
          </Field>
          <Field label={`Cost per litre (${row.currency})`} htmlFor="e-cost" error={errors.cost}>
            <Input id="e-cost" inputMode="decimal" value={v.cost} onChange={set("cost")} />
          </Field>
          <Field label={`Transport (${row.currency})`} htmlFor="e-trip" error={errors.trip}>
            <Input id="e-trip" inputMode="decimal" value={v.trip} onChange={set("trip")} />
          </Field>
          <Field label="Date" htmlFor="e-date" error={errors.date}>
            <Input id="e-date" type="date" value={v.date} onChange={set("date")} />
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
