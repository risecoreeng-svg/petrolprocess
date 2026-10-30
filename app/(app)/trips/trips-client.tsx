"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Navigation, Plus } from "lucide-react";
import { cn, formatDate, litres, num } from "@/lib/utils";
import type { Customer, FuelType, Supplier, Tank } from "@/lib/types";
import { CARGO_LABEL, TRIP_STATUS_LABEL, TRIP_STATUS_VARIANT, type FleetDriver, type FleetTruck, type Trip } from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { TripForm } from "@/components/trip-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

const STATUSES = ["", "planned", "on_road", "delivered", "cancelled"] as const;

export function TripsClient({
  trips,
  profit,
  filter,
  trucks,
  drivers,
  customers,
  fuelTypes,
  suppliers,
  tanks,
}: {
  trips: Trip[];
  profit: Record<string, number> | null;
  filter: { status: string; truck: string; client: string };
  trucks: FleetTruck[];
  drivers: FleetDriver[];
  customers: Customer[];
  fuelTypes: FuelType[];
  suppliers: Supplier[];
  tanks: Tank[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { money, fmt, base } = useMoney();
  const [creating, setCreating] = useState(false);
  const plate = (id: string) => trucks.find((t) => t.id === id)?.plate_number ?? "";
  const client = (t: Trip) => (t.for_own_depot ? "Our depot" : customers.find((c) => c.id === t.customer_id)?.name ?? "—");
  const fuel = (id: string | null) => fuelTypes.find((f) => f.id === id)?.name ?? "";

  function go(patch: Partial<typeof filter>) {
    const params = new URLSearchParams({ ...filter, ...patch });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  return (
    <>
      <PageHeader
        title="Trips"
        description="Hired trips and fuel runs. Open a trip to add expenses, start it and record delivery."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New trip
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="seg no-scrollbar max-w-full overflow-x-auto" role="tablist" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s || "all"} role="tab" aria-selected={filter.status === s} onClick={() => go({ status: s })} className={cn(filter.status === s && "on")}>
              {s ? TRIP_STATUS_LABEL[s] : "All"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:ml-auto lg:w-[420px]">
          <Select aria-label="Truck" value={filter.truck} onChange={(e) => go({ truck: e.target.value })}>
            <option value="">All trucks</option>
            {trucks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.plate_number}
              </option>
            ))}
          </Select>
          <Select aria-label="Client" value={filter.client} onChange={(e) => go({ client: e.target.value })}>
            <option value="">All clients</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {trips.length === 0 ? (
        <EmptyState
          icon={<Navigation />}
          title="No trips here"
          description="Create a trip when a truck is hired or sent to fetch fuel."
          action={<Button onClick={() => setCreating(true)}>New trip</Button>}
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-tile)] border border-line bg-surface-3 shadow-[var(--shadow-soft)]">
          {trips.map((t) => (
            <li key={t.id}>
              <Link href={`/trips/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="text-muted">#{t.trip_no}</span> {t.route_from} → {t.route_to}
                  </p>
                  <p className="truncate text-[13px] text-muted">
                    {formatDate(t.date)} · {plate(t.truck_id)} · {client(t)} · {CARGO_LABEL[t.cargo_type]}
                    {t.cargo_type === "fuel" && t.litres_loaded ? ` · ${fuel(t.fuel_type_id)} ${litres(t.litres_loaded)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {t.haulage_status === "disputed" ? <Badge variant="destructive">Shortage {num(t.shortage_pct, 2)}%</Badge> : null}
                  <Badge variant={TRIP_STATUS_VARIANT[t.status]}>{TRIP_STATUS_LABEL[t.status]}</Badge>
                  <div className="min-w-[110px] text-right">
                    <p className="font-semibold tabular-nums">{fmt(t.fee_original, t.currency)}</p>
                    {profit && t.status === "delivered" ? (
                      <p className={cn("text-[13px] tabular-nums", (profit[t.id] ?? 0) < 0 ? "text-orange" : "text-green")}>
                        {money(profit[t.id] ?? 0)} profit
                      </p>
                    ) : t.currency !== base ? (
                      <p className="text-[13px] tabular-nums text-muted">{money(t.fee)}</p>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <Modal open onClose={() => setCreating(false)} title="New trip">
          <TripForm
            trucks={trucks}
            drivers={drivers}
            customers={customers}
            fuelTypes={fuelTypes}
            suppliers={suppliers}
            tanks={tanks}
            onDone={() => setCreating(false)}
          />
        </Modal>
      ) : null}
    </>
  );
}
