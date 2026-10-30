"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Pencil, Plus, Truck as TruckIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, litres, num } from "@/lib/utils";
import { TRUCK_STATUS_BADGE, TRUCK_STATUS_TEXT, type FleetDriver, type FleetTruck } from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export type TruckPerf = { trips: number; litres: number; profit: number | null };

const truckSchema = z
  .object({
    plate_number: z
      .string()
      .trim()
      .min(4, "Enter the plate number")
      .transform((s) => s.toUpperCase().replace(/\s+/g, " ")),
    make_model: z.string().trim().max(80).nullable(),
    year: z.number().int().min(1950).max(2100).nullable(),
    truck_type: z.enum(["tanker", "flatbed", "other"]),
    capacity_litres: z.number({ error: "Enter the capacity" }).positive("Must be more than 0"),
    capacity_unit: z.enum(["litres", "tonnes"]),
    driver_id: z.string().uuid().nullable(),
    status: z.enum(["active", "on_trip", "maintenance", "inactive"]),
    odometer_km: z.number().min(0),
    ownership: z.enum(["own", "third_party"]),
    third_party_owner: z.string().trim().nullable(),
    payout_type: z.enum(["fixed_per_trip", "percent_of_fee"]).nullable(),
    payout_value: z.number().min(0).nullable(),
    notes: z.string().trim().max(500).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.ownership === "third_party") {
      if (!v.third_party_owner) ctx.addIssue({ code: "custom", path: ["third_party_owner"], message: "Who owns the truck?" });
      if (v.payout_value === null) ctx.addIssue({ code: "custom", path: ["payout_value"], message: "Enter the payout" });
    }
  });

export function TrucksClient({
  trucks,
  drivers,
  perf,
  isOwner,
  canTrips,
}: {
  trucks: FleetTruck[];
  drivers: FleetDriver[];
  perf: Record<string, TruckPerf>;
  isOwner: boolean;
  canTrips: boolean;
}) {
  const { money } = useMoney();
  const [editing, setEditing] = useState<FleetTruck | "new" | null>(null);
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.name ?? "No driver";
  const available = trucks.filter((t) => t.status === "active").length;

  return (
    <>
      <PageHeader
        title="Trucks"
        description={`${trucks.length} trucks · ${available} available`}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add truck
          </Button>
        }
      />

      {trucks.length === 0 ? (
        <EmptyState
          icon={<TruckIcon />}
          title="No trucks yet"
          description="Add your trucks to hire them out on trips and bring fuel to your depot."
          action={<Button onClick={() => setEditing("new")}>Add truck</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trucks.map((t) => {
            const p = perf[t.id];
            return (
              <div key={t.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/trucks/${t.id}`} className="min-w-0">
                    <p className="text-[21px] font-semibold tracking-[-0.01em]">{t.plate_number}</p>
                    <p className="truncate text-sm text-muted">
                      {[t.make_model, t.year].filter(Boolean).join(" · ") || "Make not set"}
                    </p>
                  </Link>
                  <Badge variant={TRUCK_STATUS_BADGE[t.status]}>{TRUCK_STATUS_TEXT[t.status]}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {driverName(t.driver_id)} · {num(t.capacity_litres)} {t.capacity_unit === "tonnes" ? "t" : "L"} {t.truck_type} ·{" "}
                  {num(t.odometer_km, 0)} km
                </p>
                {t.ownership === "third_party" ? (
                  <p className="mt-1 text-[13px] text-muted">
                    Owned by {t.third_party_owner} ·{" "}
                    {t.payout_type === "percent_of_fee" ? `${num(t.payout_value)}% of each fee` : `${money(t.payout_value)} per trip`}
                  </p>
                ) : null}
                {canTrips ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="inner-box px-2 py-3">
                      <p className="font-semibold tabular-nums">{p?.trips ?? 0}</p>
                      <p className="text-xs text-muted">Trips done</p>
                    </div>
                    <div className="inner-box px-2 py-3">
                      <p className="truncate font-semibold tabular-nums">{litres(p?.litres ?? 0)}</p>
                      <p className="text-xs text-muted">Fuel hauled</p>
                    </div>
                    <div className="inner-box px-2 py-3">
                      {isOwner ? (
                        <p className={cn("truncate font-semibold tabular-nums", (p?.profit ?? 0) < 0 && "text-orange")}>{money(p?.profit ?? 0)}</p>
                      ) : (
                        <p className="font-semibold">—</p>
                      )}
                      <p className="text-xs text-muted">Net profit</p>
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/trucks/${t.id}`}>Details</Link>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                    <Pencil /> Edit
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <TruckForm truck={editing === "new" ? null : editing} drivers={drivers} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function TruckForm({ truck, drivers, onClose }: { truck: FleetTruck | null; drivers: FleetDriver[]; onClose: () => void }) {
  const { base } = useMoney();
  const { submit, pending, errors } = useSubmit();
  const [f, setF] = useState({
    plate_number: truck?.plate_number ?? "",
    make_model: truck?.make_model ?? "",
    year: truck?.year ? String(truck.year) : "",
    truck_type: truck?.truck_type ?? "tanker",
    capacity_litres: truck ? String(truck.capacity_litres) : "",
    capacity_unit: truck?.capacity_unit ?? "litres",
    driver_id: truck?.driver_id ?? "",
    status: truck?.status ?? "active",
    odometer_km: truck ? String(truck.odometer_km) : "",
    ownership: truck?.ownership ?? "own",
    third_party_owner: truck?.third_party_owner ?? "",
    payout_type: truck?.payout_type ?? "percent_of_fee",
    payout_value: truck?.payout_value != null ? String(truck.payout_value) : "",
    notes: truck?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const third = f.ownership === "third_party";
    const ok = await submit(
      truckSchema,
      {
        plate_number: f.plate_number,
        make_model: f.make_model || null,
        year: toNum(f.year) ?? null,
        truck_type: f.truck_type,
        capacity_litres: toNum(f.capacity_litres),
        capacity_unit: f.capacity_unit,
        driver_id: f.driver_id || null,
        status: f.status,
        odometer_km: toNum(f.odometer_km) ?? 0,
        ownership: f.ownership,
        third_party_owner: third ? f.third_party_owner || null : null,
        payout_type: third ? f.payout_type : null,
        payout_value: third ? toNum(f.payout_value) ?? null : null,
        notes: f.notes || null,
      },
      (data) => (truck ? supabase.from("trucks").update(data).eq("id", truck.id) : supabase.from("trucks").insert(data)),
      truck ? "Truck updated" : "Truck added",
    );
    if (ok) onClose();
  }

  async function archive() {
    if (!truck || !confirm(`Archive ${truck.plate_number}? Its history is kept.`)) return;
    const ok = await submit(
      z.object({}),
      {},
      () => createClient().from("trucks").update({ deleted_at: new Date().toISOString() }).eq("id", truck.id),
      "Truck archived",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={truck ? `Edit ${truck.plate_number}` : "Add truck"}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plate number" htmlFor="t-plate" error={errors.plate_number}>
            <Input id="t-plate" placeholder="KCA 123A" value={f.plate_number} onChange={set("plate_number")} />
          </Field>
          <Field label="Status" htmlFor="t-status">
            <Select id="t-status" value={f.status} onChange={set("status")}>
              {Object.entries(TRUCK_STATUS_TEXT).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Make / model" htmlFor="t-make">
            <Input id="t-make" placeholder="e.g. Isuzu FVZ" value={f.make_model} onChange={set("make_model")} />
          </Field>
          <Field label="Year" htmlFor="t-year" error={errors.year}>
            <Input id="t-year" inputMode="numeric" value={f.year} onChange={set("year")} />
          </Field>
          <Field label="Type" htmlFor="t-type">
            <Select id="t-type" value={f.truck_type} onChange={set("truck_type")}>
              <option value="tanker">Tanker</option>
              <option value="flatbed">Flatbed</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Capacity" htmlFor="t-cap" error={errors.capacity_litres}>
            <div className="flex gap-2">
              <Input id="t-cap" inputMode="decimal" value={f.capacity_litres} onChange={set("capacity_litres")} className="min-w-0" />
              <Select aria-label="Unit" value={f.capacity_unit} onChange={set("capacity_unit")} className="w-[96px] px-3">
                <option value="litres">L</option>
                <option value="tonnes">t</option>
              </Select>
            </div>
          </Field>
          <Field label="Current driver" htmlFor="t-driver">
            <Select id="t-driver" value={f.driver_id} onChange={set("driver_id")}>
              <option value="">No driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Odometer (km)" htmlFor="t-odo">
            <Input id="t-odo" inputMode="decimal" value={f.odometer_km} onChange={set("odometer_km")} />
          </Field>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            Who owns it?
            <InfoTip>For a truck you run for someone else, set what they get from each trip. It counts as a cost in that truck&apos;s profit.</InfoTip>
          </legend>
          <div className="seg w-fit">
            {(["own", "third_party"] as const).map((o) => (
              <button key={o} type="button" onClick={() => setF({ ...f, ownership: o })} className={cn(f.ownership === o && "on")}>
                {o === "own" ? "Our truck" : "Someone else's"}
              </button>
            ))}
          </div>
          {f.ownership === "third_party" ? (
            <div className="inner-box grid grid-cols-2 gap-3">
              <Field label="Owner's name" htmlFor="t-owner" error={errors.third_party_owner} className="col-span-2">
                <Input id="t-owner" value={f.third_party_owner} onChange={set("third_party_owner")} />
              </Field>
              <Field label="They get" htmlFor="t-ptype">
                <Select id="t-ptype" value={f.payout_type} onChange={set("payout_type")}>
                  <option value="percent_of_fee">% of each trip fee</option>
                  <option value="fixed_per_trip">Fixed per trip ({base})</option>
                </Select>
              </Field>
              <Field label={f.payout_type === "percent_of_fee" ? "Percent" : `Amount (${base})`} htmlFor="t-pval" error={errors.payout_value}>
                <Input id="t-pval" inputMode="decimal" value={f.payout_value} onChange={set("payout_value")} />
              </Field>
            </div>
          ) : null}
        </fieldset>

        <Field label="Notes" htmlFor="t-notes">
          <Textarea id="t-notes" value={f.notes} onChange={set("notes")} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {truck ? "Save changes" : "Add truck"}
        </Button>
        {truck ? (
          <Button type="button" variant="ghost" className="text-orange" onClick={archive} disabled={pending}>
            Archive truck
          </Button>
        ) : null}
      </form>
    </Modal>
  );
}
