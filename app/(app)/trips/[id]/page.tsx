import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getFleetLookups } from "@/lib/fleet-server";
import { createClient } from "@/lib/supabase/server";
import { TRIP_COLUMNS, type Trip } from "@/lib/fleet";
import { TripDetailClient, type Advance, type Line, type TripPayment } from "./trip-detail-client";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireRole("owner", "fleet_manager");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  const { data: trip } = await supabase.from("trips").select(TRIP_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!trip) notFound();

  const [lookups, { data: lines }, { data: advances }, { data: payments }, profitRes] = await Promise.all([
    getFleetLookups(),
    // RLS hides driver pay lines from everyone but the owner.
    supabase
      .from("trip_lines")
      .select("id, kind, category, description, currency, original_amount, amount, litres, driver_id, paid_from_advance, receipt_path, created_at")
      .eq("trip_id", id)
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("driver_advances").select("id, kind, date, currency, original_amount, amount").eq("trip_id", id).is("deleted_at", null).order("date"),
    supabase.from("trip_payments").select("id, date, method, reference, currency, original_amount, amount").eq("trip_id", id).is("deleted_at", null).order("date"),
    isOwner ? supabase.from("trip_profit").select("owner_payout, profit, km").eq("trip_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return (
    <TripDetailClient
      trip={trip as Trip}
      lines={(lines ?? []) as Line[]}
      advances={(advances ?? []) as Advance[]}
      payments={(payments ?? []) as TripPayment[]}
      ownerView={isOwner ? { payout: Number(profitRes.data?.owner_payout ?? 0) } : null}
      orgId={profile.org_id}
      orgName={profile.org_name}
      {...lookups}
    />
  );
}
