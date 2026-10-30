import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatDate, num } from "@/lib/utils";
import { DOC_TYPES, expiryState, reminderState, type DocType, type Reminder } from "@/lib/fleet";

export type FleetAlert = {
  key: string;
  kind: "document" | "licence" | "service";
  severity: "expired" | "soon";
  title: string;
  sub: string;
  href: string;
  action: string;
};

/**
 * Documents expiring within 30 days or already expired (latest per truck and type),
 * drivers' licences, and services due by km or date. RLS limits this to the caller's org
 * and to roles that may see trucks.
 */
export async function getFleetAlerts(): Promise<FleetAlert[]> {
  const supabase = await createClient();
  const [{ data: trucks }, { data: docs }, { data: reminders }, { data: drivers }] = await Promise.all([
    supabase.from("trucks").select("id, plate_number, odometer_km").is("deleted_at", null),
    supabase.from("truck_documents").select("truck_id, doc_type, expires_on").is("deleted_at", null).order("expires_on", { ascending: false }),
    supabase.from("service_reminders").select("id, truck_id, name, every_km, every_days, last_done_km, last_done_on").is("deleted_at", null),
    supabase.from("drivers").select("id, name, licence_expiry").is("deleted_at", null),
  ]);
  const plate = (id: string) => trucks?.find((t) => t.id === id)?.plate_number ?? "Truck";
  const alerts: FleetAlert[] = [];

  const seen = new Set<string>();
  for (const d of docs ?? []) {
    const key = `${d.truck_id}:${d.doc_type}`;
    if (seen.has(key)) continue; // only the latest of each type counts
    seen.add(key);
    const s = expiryState(d.expires_on);
    if (s !== "expired" && s !== "soon") continue;
    alerts.push({
      key: `doc-${key}`,
      kind: "document",
      severity: s,
      title: `${plate(d.truck_id)}: ${DOC_TYPES[d.doc_type as DocType]} ${s === "expired" ? "has expired" : "expires soon"}`,
      sub: `${s === "expired" ? "Expired" : "Expires"} ${formatDate(d.expires_on)}${["insurance", "licence"].includes(d.doc_type) && s === "expired" ? " · trips can't start until it's renewed" : ""}`,
      href: "/documents",
      action: "Renew",
    });
  }
  for (const d of drivers ?? []) {
    const s = expiryState(d.licence_expiry);
    if (s !== "expired" && s !== "soon") continue;
    alerts.push({
      key: `lic-${d.id}`,
      kind: "licence",
      severity: s,
      title: `${d.name}'s driving licence ${s === "expired" ? "has expired" : "expires soon"}`,
      sub: `${s === "expired" ? "Expired" : "Expires"} ${formatDate(d.licence_expiry)}`,
      href: "/drivers",
      action: "Update",
    });
  }
  for (const r of (reminders ?? []) as Reminder[]) {
    const t = trucks?.find((x) => x.id === r.truck_id);
    if (!t) continue;
    const s = reminderState(r, Number(t.odometer_km));
    if (!s.overdue && !s.soon) continue;
    alerts.push({
      key: `svc-${r.id}`,
      kind: "service",
      severity: s.overdue ? "expired" : "soon",
      title: `${t.plate_number}: ${r.name} ${s.overdue ? "is due" : "is coming up"}`,
      sub: [
        s.kmLeft !== null ? (s.kmLeft <= 0 ? `${num(-s.kmLeft, 0)} km overdue` : `in ${num(s.kmLeft, 0)} km`) : null,
        s.dueDate ? `by ${formatDate(s.dueDate)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/documents",
      action: "Open",
    });
  }
  // Expired first
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "expired" ? -1 : 1));
}
