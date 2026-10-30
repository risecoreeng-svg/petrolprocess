"use client";

import { useState } from "react";
import { z } from "zod";
import { IdCard, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSubmit } from "@/lib/use-submit";
import type { FleetDriver, FleetTruck } from "@/lib/fleet";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { ExpiryBadge } from "../documents/documents-client";

export type DriverStats = { trips: number; onRoad: number; paidMonth: number | null; paidTotal: number | null };

const schema = z.object({
  name: z.string().trim().min(2, "Enter the driver's name"),
  phone: z.string().trim().nullable(),
  licence_no: z.string().trim().nullable(),
  licence_expiry: z.iso.date().nullable(),
});

export function DriversClient({
  drivers,
  trucks,
  stats,
  isOwner,
}: {
  drivers: FleetDriver[];
  trucks: FleetTruck[];
  stats: Record<string, DriverStats>;
  isOwner: boolean;
}) {
  const { money } = useMoney();
  const [editing, setEditing] = useState<FleetDriver | "new" | null>(null);
  return (
    <>
      <PageHeader
        title="Drivers"
        description="Contacts, licences, assigned truck and trips done."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add driver
          </Button>
        }
      />
      {drivers.length === 0 ? (
        <EmptyState icon={<IdCard />} title="No drivers yet" action={<Button onClick={() => setEditing("new")}>Add driver</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {drivers.map((d) => {
            const s = stats[d.id];
            const assigned = trucks.filter((t) => t.driver_id === d.id).map((t) => t.plate_number);
            return (
              <div key={d.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[19px] font-semibold">{d.name}</p>
                    <p className="text-sm text-muted">{d.phone ?? "No phone"}</p>
                  </div>
                  {d.profile_id ? <Badge variant="info">Has login</Badge> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">Licence {d.licence_no ?? "—"}</span>
                  <ExpiryBadge date={d.licence_expiry} />
                </div>
                <p className="mt-2 text-sm text-muted">Truck: {assigned.length ? assigned.join(", ") : "none assigned"}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
                  <div className="inner-box px-2 py-3">
                    <p className="font-semibold tabular-nums">{s?.trips ?? 0}</p>
                    <p className="text-xs text-muted">Trips done{s?.onRoad ? ` · ${s.onRoad} on the road` : ""}</p>
                  </div>
                  <div className="inner-box px-2 py-3">
                    {isOwner ? (
                      <>
                        <p className="font-semibold tabular-nums">{money(s?.paidMonth ?? 0)}</p>
                        <p className="flex items-center justify-center gap-1 text-xs text-muted">
                          Paid this month
                          <InfoTip>Driver pay on trips plus salary from truck costs. All time: {money(s?.paidTotal ?? 0)}.</InfoTip>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">—</p>
                        <p className="text-xs text-muted">Pay (owner only)</p>
                      </>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => setEditing(d)}>
                  <Pencil /> Edit
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {editing ? <DriverForm driver={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function DriverForm({ driver, onClose }: { driver: FleetDriver | null; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [f, setF] = useState({ name: driver?.name ?? "", phone: driver?.phone ?? "", licence_no: driver?.licence_no ?? "", licence_expiry: driver?.licence_expiry ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const ok = await submit(
      schema,
      { name: f.name, phone: f.phone || null, licence_no: f.licence_no || null, licence_expiry: f.licence_expiry || null },
      (d) => (driver ? supabase.from("drivers").update(d).eq("id", driver.id) : supabase.from("drivers").insert(d)),
      driver ? "Driver updated" : "Driver added",
    );
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title={driver ? `Edit ${driver.name}` : "Add driver"}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Name" htmlFor="dr-name" error={errors.name}>
          <Input id="dr-name" value={f.name} onChange={set("name")} />
        </Field>
        <Field label="Phone" htmlFor="dr-phone">
          <Input id="dr-phone" inputMode="tel" value={f.phone} onChange={set("phone")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Licence number" htmlFor="dr-lic">
            <Input id="dr-lic" value={f.licence_no} onChange={set("licence_no")} />
          </Field>
          <Field label="Licence expires" htmlFor="dr-exp">
            <Input id="dr-exp" type="date" value={f.licence_expiry} onChange={set("licence_expiry")} />
          </Field>
        </div>
        <p className="text-[13px] text-muted">To give a driver their own phone login, add a user with the Driver role in Users.</p>
        <Button type="submit" size="lg" disabled={pending}>
          {driver ? "Save" : "Add driver"}
        </Button>
      </form>
    </Modal>
  );
}
