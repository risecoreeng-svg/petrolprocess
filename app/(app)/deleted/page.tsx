import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/utils";
import { PageHeader } from "@/components/ui/misc";
import { DeletedClient, type DeletedRow } from "./deleted-client";

const KINDS = ["purchase", "sale", "expense", "credit_payment", "trip", "trip_line", "truck_expense"];
const iso = /^\d{4}-\d{2}-\d{2}$/;

/** Everything that was deleted, who deleted it and why. Owners can restore. */
export default async function DeletedPage({ searchParams }: { searchParams: Promise<{ kind?: string; from?: string; to?: string }> }) {
  const profile = await requireRole("owner", "manager");
  const sp = await searchParams;
  const kind = KINDS.includes(sp.kind ?? "") ? sp.kind! : "";
  const from = sp.from && iso.test(sp.from) ? sp.from : "";
  const to = sp.to && iso.test(sp.to) ? sp.to : "";
  const supabase = await createClient();

  // deleted_items_safe only returns this organization's rows, and only depot records to a sales manager.
  let q = supabase.from("deleted_items_safe").select("*").order("deleted_at", { ascending: false }).limit(500);
  if (kind) q = q.eq("kind", kind);
  if (from) q = q.gte("deleted_at", `${from}T00:00:00+03:00`);
  if (to) q = q.lt("deleted_at", `${addDays(to, 1)}T00:00:00+03:00`);
  const [{ data, error }, { data: staff }] = await Promise.all([q, supabase.from("profiles").select("id, full_name")]);

  return (
    <>
      <PageHeader
        title="Deleted items"
        description={
          profile.role === "owner"
            ? "Nothing is erased. Deleted records are kept here with who deleted them and why, and you can restore them."
            : "Nothing is erased. Deleted records are kept here with who deleted them and why. Only the owner can restore them."
        }
      />
      <DeletedClient
        rows={(data ?? []) as DeletedRow[]}
        staff={staff ?? []}
        isOwner={profile.role === "owner"}
        filter={{ kind, from, to }}
        unavailable={!!error}
      />
    </>
  );
}
