import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/misc";
import type { FleetDriver, FleetTruck, Reminder } from "@/lib/fleet";
import { DocumentsClient, type Doc } from "./documents-client";

export default async function DocumentsPage() {
  const profile = await requireRole("owner", "fleet_manager");
  const supabase = await createClient();
  const [{ data: trucks }, { data: docs }, { data: reminders }, { data: drivers }] = await Promise.all([
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    supabase.from("truck_documents").select("id, truck_id, doc_type, reference, expires_on, notes, file_path").is("deleted_at", null).order("expires_on", { ascending: false }),
    supabase.from("service_reminders").select("id, truck_id, name, every_km, every_days, last_done_km, last_done_on").is("deleted_at", null).order("name"),
    supabase.from("drivers").select("id, name, phone, licence_no, licence_expiry, profile_id").is("deleted_at", null).order("name"),
  ]);
  return (
    <>
      <PageHeader title="Documents and reminders" description="Licences, insurance, inspections and permits per truck, services due, and drivers' licences." />
      <DocumentsClient
        trucks={(trucks ?? []) as FleetTruck[]}
        docs={(docs ?? []) as Doc[]}
        reminders={(reminders ?? []) as Reminder[]}
        drivers={(drivers ?? []) as FleetDriver[]}
        orgId={profile.org_id}
      />
    </>
  );
}
