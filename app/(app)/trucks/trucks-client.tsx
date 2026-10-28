"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Pencil, Plus, Truck as TruckIcon, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { kes, litres } from "@/lib/utils";
import { TRUCK_STATUS_LABEL, type Driver, type Truck, type TruckStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export type TruckPerf = { deliveries: number; litres: number; profit: number | null };

const truckSchema = z.object({
  plate_number: z
    .string()
    .trim()
    .min(5, "Enter the plate number")
    .transform((s) => s.toUpperCase().replace(/\s+/g, " ")),
  capacity_litres: z.number({ error: "Enter capacity" }).positive("Must be more than 0"),
  driver_id: z.string().uuid().nullable(),
  status: z.enum(["active", "maintenance", "on_trip"]),
  notes: z.string().trim().max(500).nullable(),
});

const driverSchema = z.object({
  name: z.string().trim().min(2, "Enter the driver's name"),
  phone: z.string().trim().nullable(),
  licence_no: z.string().trim().nullable(),
});

const STATUS_VARIANT: Record<TruckStatus, "default" | "warning" | "info"> = {
  active: "default",
  maintenance: "warning",
  on_trip: "info",
};

export function TrucksClient({
  trucks,
  drivers,
  perf,
  isOwner,
}: {
  trucks: Truck[];
  drivers: Driver[];
  perf: Record<string, TruckPerf>;
  isOwner: boolean;
}) {
  const [editing, setEditing] = useState<Truck | "new" | null>(null);
  const [driverOpen, setDriverOpen] = useState(false);
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.name ?? "No driver";
  const active = trucks.filter((t) => t.status === "active").length;

  return (
    <>
      <PageHeader
        title="Trucks"
        description={`${trucks.length} trucks · ${active} active`}
        actions={
          <>
            <Button variant="outline" onClick={() => setDriverOpen(true)}>
              <UserPlus /> Driver
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Add truck
            </Button>
          </>
        }
      />

      {trucks.length === 0 ? (
        <EmptyState
          icon={<TruckIcon />}
          title="No trucks yet"
          description="Add your delivery trucks. Every delivery must be linked to a truck."
          action={<Button onClick={() => setEditing("new")}>Add truck</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trucks.map((t) => {
            const p = perf[t.id];
            return (
              <div key={t.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/trucks/${t.id}`} className="min-w-0">
                    <p className="text-[21px] font-semibold tracking-[-0.01em]">{t.plate_number}</p>
                    <p className="text-sm text-muted-foreground">
                      {driverName(t.driver_id)} · {litres(t.capacity_litres)}
                    </p>
                  </Link>
                  <Badge variant={STATUS_VARIANT[t.status]}>{TRUCK_STATUS_LABEL[t.status]}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="inner-box px-2 py-3">
                    <p className="font-semibold tabular-nums">{p?.deliveries ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Trips</p>
                  </div>
                  <div className="inner-box px-2 py-3">
                    <p className="font-semibold tabular-nums">{litres(p?.litres ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">Brought</p>
                  </div>
                  <div className="inner-box px-2 py-3">
                    {isOwner ? (
                      <p className={`font-semibold tabular-nums ${(p?.profit ?? 0) < 0 ? "text-orange" : ""}`}>
                        {kes(p?.profit ?? 0).replace("KES", "").trim()}
                      </p>
                    ) : (
                      <p className="font-semibold">—</p>
                    )}
                    <p className="text-xs text-muted-foreground">Profit</p>
                  </div>
                </div>
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
      {driverOpen ? <DriverForm onClose={() => setDriverOpen(false)} /> : null}
    </>
  );
}

function TruckForm({ truck, drivers, onClose }: { truck: Truck | null; drivers: Driver[]; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [plate, setPlate] = useState(truck?.plate_number ?? "");
  const [capacity, setCapacity] = useState(truck ? String(truck.capacity_litres) : "");
  const [driverId, setDriverId] = useState(truck?.driver_id ?? "");
  const [status, setStatus] = useState<TruckStatus>(truck?.status ?? "active");
  const [notes, setNotes] = useState(truck?.notes ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const ok = await submit(
      truckSchema,
      {
        plate_number: plate,
        capacity_litres: toNum(capacity),
        driver_id: driverId || null,
        status,
        notes: notes || null,
      },
      (data) =>
        truck ? supabase.from("trucks").update(data).eq("id", truck.id) : supabase.from("trucks").insert(data),
      truck ? "Truck updated" : "Truck added",
    );
    if (ok) onClose();
  }

  async function archive() {
    if (!truck || !confirm(`Archive ${truck.plate_number}? Its history is kept.`)) return;
    const supabase = createClient();
    const ok = await submit(
      z.object({}),
      {},
      () => supabase.from("trucks").update({ deleted_at: new Date().toISOString() }).eq("id", truck.id),
      "Truck archived",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={truck ? `Edit ${truck.plate_number}` : "Add truck"}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Plate number" htmlFor="plate" error={errors.plate_number}>
          <Input id="plate" placeholder="KCA 123A" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </Field>
        <Field label="Capacity (litres)" htmlFor="cap" error={errors.capacity_litres}>
          <Input id="cap" inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label="Driver" htmlFor="driver">
          <Select id="driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">No driver</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as TruckStatus)}>
            {Object.entries(TRUCK_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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

function DriverForm({ onClose }: { onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [licence, setLicence] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const ok = await submit(
      driverSchema,
      { name, phone: phone || null, licence_no: licence || null },
      (data) => supabase.from("drivers").insert(data),
      "Driver added",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Add driver">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Name" htmlFor="dname" error={errors.name}>
          <Input id="dname" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="dphone">
          <Input id="dphone" inputMode="tel" placeholder="07xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Licence number" htmlFor="dlic">
          <Input id="dlic" value={licence} onChange={(e) => setLicence(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          Add driver
        </Button>
      </form>
    </Modal>
  );
}
