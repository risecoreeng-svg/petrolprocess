"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Check, FileBadge, Plus, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { errorMessage, formatDate, nairobiToday, num } from "@/lib/utils";
import { DOC_TYPES, expiryState, reminderState, type DocType, type FleetDriver, type FleetTruck, type Reminder } from "@/lib/fleet";
import { ReceiptInput, ReceiptLink } from "@/components/receipt-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export type Doc = { id: string; truck_id: string; doc_type: DocType; reference: string | null; expires_on: string; notes: string | null; file_path: string | null };

export function ExpiryBadge({ date }: { date: string | null }) {
  const s = expiryState(date);
  if (s === "none") return <Badge variant="secondary">Not recorded</Badge>;
  if (s === "expired") return <Badge variant="destructive">Expired {formatDate(date)}</Badge>;
  if (s === "soon") return <Badge variant="warning">Expires {formatDate(date)}</Badge>;
  return <Badge>Valid to {formatDate(date)}</Badge>;
}

export function DocumentsClient({
  trucks,
  docs,
  reminders,
  drivers,
  orgId,
}: {
  trucks: FleetTruck[];
  docs: Doc[];
  reminders: Reminder[];
  drivers: FleetDriver[];
  orgId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState<{ truckId: string; type: DocType } | null>(null);
  const [addingReminder, setAddingReminder] = useState<string | null>(null);
  const latest = (truckId: string, type: DocType) => docs.find((d) => d.truck_id === truckId && d.doc_type === type);

  async function markDone(r: Reminder, odometer: number) {
    const input = window.prompt(`Odometer when "${r.name}" was done (km)`, String(odometer));
    if (input === null) return;
    const { error } = await createClient().rpc("mark_service_done", { p_reminder: r.id, p_odometer: toNum(input) ?? null });
    if (error) return toast.error(errorMessage(error));
    toast.success("Service recorded");
    router.refresh();
  }

  if (trucks.length === 0) {
    return <EmptyState icon={<FileBadge />} title="No trucks yet" description="Add trucks first, then record their documents." />;
  }

  return (
    <div className="grid gap-6">
      {trucks.map((t) => {
        const tr = reminders.filter((r) => r.truck_id === t.id);
        return (
          <Card key={t.id}>
            <CardHeader className="flex-row items-center gap-2">
              <CardTitle>{t.plate_number}</CardTitle>
              <span className="text-sm text-muted">{num(t.odometer_km, 0)} km</span>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-2">
              <div className="grid gap-2">
                {(Object.keys(DOC_TYPES) as DocType[]).map((type) => {
                  const d = latest(t.id, type);
                  if (!d && type === "other") return null;
                  return (
                    <div key={type} className="inner-box flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{DOC_TYPES[type]}</p>
                        <p className="truncate text-[13px] text-muted">{d?.reference ?? "—"}</p>
                        {d ? <ReceiptLink path={d.file_path} /> : null}
                      </div>
                      <ExpiryBadge date={d?.expires_on ?? null} />
                      <Button size="sm" variant="outline" onClick={() => setAdding({ truckId: t.id, type })}>
                        {d ? "Renew" : "Add"}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="grid h-fit gap-2">
                <p className="text-sm font-medium">Services</p>
                {tr.length === 0 ? <p className="text-[15px] text-muted">No service reminders.</p> : null}
                {tr.map((r) => {
                  const s = reminderState(r, Number(t.odometer_km));
                  return (
                    <div key={r.id} className="inner-box flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-[13px] text-muted">
                          {[r.every_km ? `every ${num(r.every_km, 0)} km` : null, r.every_days ? `every ${r.every_days} days` : null].filter(Boolean).join(" or ")}
                          {s.kmLeft !== null ? ` · ${s.kmLeft <= 0 ? `${num(-s.kmLeft, 0)} km overdue` : `${num(s.kmLeft, 0)} km to go`}` : ""}
                          {s.dueDate ? ` · due ${formatDate(s.dueDate)}` : ""}
                        </p>
                      </div>
                      {s.overdue ? <Badge variant="destructive">Due now</Badge> : s.soon ? <Badge variant="warning">Due soon</Badge> : <Badge>OK</Badge>}
                      <Button size="sm" variant="outline" onClick={() => markDone(r, Number(t.odometer_km))}>
                        <Check /> Done
                      </Button>
                    </div>
                  );
                })}
                <Button size="sm" variant="ghost" className="w-fit" onClick={() => setAddingReminder(t.id)}>
                  <Plus /> Add a service reminder
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="flex-row items-center">
          <CardTitle>Drivers&apos; licences</CardTitle>
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href="/drivers">Edit drivers</Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {drivers.map((d) => (
            <div key={d.id} className="inner-box flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{d.name}</p>
                <p className="text-[13px] text-muted">{d.licence_no ?? "No licence number"}</p>
              </div>
              <ExpiryBadge date={d.licence_expiry} />
            </div>
          ))}
        </CardContent>
      </Card>

      {adding ? <DocForm {...adding} orgId={orgId} plate={trucks.find((t) => t.id === adding.truckId)?.plate_number ?? ""} onClose={() => setAdding(null)} /> : null}
      {addingReminder ? <ReminderForm truck={trucks.find((t) => t.id === addingReminder)!} onClose={() => setAddingReminder(null)} /> : null}
    </div>
  );
}

function DocForm({ truckId, type, plate, orgId, onClose }: { truckId: string; type: DocType; plate: string; orgId: string; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [reference, setReference] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      z.object({ expires_on: z.iso.date("Pick the expiry date"), reference: z.string().nullable(), file_path: z.string().nullable() }),
      { expires_on: expires, reference: reference || null, file_path: file },
      (d) => createClient().from("truck_documents").insert({ truck_id: truckId, doc_type: type, ...d }),
      `${DOC_TYPES[type]} saved`,
    );
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title={`${DOC_TYPES[type]} · ${plate}`}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Reference / number" htmlFor="doc-ref">
          <Input id="doc-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Expires on" htmlFor="doc-exp" error={errors.expires_on}>
          <Input id="doc-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <ReceiptInput orgId={orgId} value={file} onChange={setFile} />
        <Button type="submit" size="lg" disabled={pending}>
          Save
        </Button>
      </form>
    </Modal>
  );
}

function ReminderForm({ truck, onClose }: { truck: FleetTruck; onClose: () => void }) {
  const { submit, pending, errors } = useSubmit();
  const [name, setName] = useState("Oil change");
  const [km, setKm] = useState("10000");
  const [days, setDays] = useState("");
  const [lastKm, setLastKm] = useState(String(truck.odometer_km));
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await submit(
      z
        .object({ name: z.string().trim().min(2, "Name it"), every_km: z.number().positive().nullable(), every_days: z.number().int().positive().nullable(), last_done_km: z.number().min(0).nullable() })
        .refine((v) => v.every_km || v.every_days, { path: ["every_km"], message: "Set km, days or both" }),
      { name, every_km: toNum(km) ?? null, every_days: toNum(days) ?? null, last_done_km: toNum(lastKm) ?? null },
      (d) => createClient().from("service_reminders").insert({ truck_id: truck.id, last_done_on: nairobiToday(), ...d }),
      "Reminder added",
    );
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Service reminder · ${truck.plate_number}`}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Service" htmlFor="rm-name" error={errors.name}>
          <Input id="rm-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every (km)" htmlFor="rm-km" error={errors.every_km}>
            <Input id="rm-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
          </Field>
          <Field label="Or every (days)" htmlFor="rm-days">
            <Input id="rm-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <Field label="Last done at (km)" htmlFor="rm-last" hint="Counted from today for the days option.">
          <Input id="rm-last" inputMode="numeric" value={lastKm} onChange={(e) => setLastKm(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          <Wrench /> Save reminder
        </Button>
      </form>
    </Modal>
  );
}
