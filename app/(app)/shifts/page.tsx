import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ShiftsClient, type ShiftRow } from "./shifts-client";

export default async function ShiftsPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  // RLS limits attendants to their own shifts.
  const [{ data: shifts }, { data: staff }, { data: mySales }] = await Promise.all([
    supabase.from("shifts").select("*").is("deleted_at", null).order("started_at", { ascending: false }).limit(60),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("sales_safe").select("shift_id, total, payment_type").eq("attendant_id", profile.id),
  ]);

  const rows = (shifts ?? []) as ShiftRow[];
  const open = rows.find((s) => s.attendant_id === profile.id && !s.ended_at) ?? null;
  const openSales = open ? (mySales ?? []).filter((s) => s.shift_id === open.id) : [];

  return (
    <ShiftsClient
      userId={profile.id}
      role={profile.role}
      shifts={rows}
      openShift={open}
      openShiftSales={{
        count: openSales.length,
        total: openSales.reduce((s, r) => s + Number(r.total), 0),
      }}
      staff={staff ?? []}
    />
  );
}
