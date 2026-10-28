"use client";

import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";
import { Ban, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSubmit } from "@/lib/use-submit";
import { formatDate, litres, num } from "@/lib/utils";
import type { FuelType, Supplier, Tank, Truck } from "@/lib/types";
import { useMoney } from "@/components/money-provider";
import { AddStockForm } from "@/components/add-stock-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form-controls";
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
};

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
            <AddStockForm fuelTypes={fuelTypes} tanks={tanks} suppliers={suppliers} trucks={trucks} />
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
                  {isOwner ? <TH /> : null}
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
                    {isOwner ? (
                      <TD>
                        <VoidButton id={r.id} label={`${num(r.litres)} L on ${formatDate(r.date)}`} />
                      </TD>
                    ) : null}
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

function VoidButton({ id, label }: { id: string; label: string }) {
  const { submit, pending } = useSubmit();
  async function onVoid() {
    if (!confirm(`Remove the delivery of ${label}? Its litres come out of the tank. This is logged.`)) return;
    await submit(
      z.object({}),
      {},
      () => createClient().from("purchases").update({ deleted_at: new Date().toISOString() }).eq("id", id),
      "Delivery removed",
    );
  }
  return (
    <Button variant="ghost" size="sm" onClick={onVoid} disabled={pending} title="Remove delivery" aria-label="Remove delivery">
      <Ban />
    </Button>
  );
}
