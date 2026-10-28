import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditClient, type AuditRow } from "./audit-client";

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; user?: string; page?: string }>;
}) {
  await requireRole("owner");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase.from("audit_log").select("*", { count: "exact" });
  if (sp.table) q = q.eq("table_name", sp.table);
  if (sp.action) q = q.eq("action", sp.action);
  if (sp.user) q = q.eq("user_id", sp.user);

  const [{ data, count }, { data: staff }] = await Promise.all([
    q.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("profiles").select("id, full_name"),
  ]);

  return (
    <AuditClient
      rows={(data ?? []) as AuditRow[]}
      staff={staff ?? []}
      filter={{ table: sp.table ?? "", action: sp.action ?? "", user: sp.user ?? "" }}
      page={page}
      pages={Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))}
      total={count ?? 0}
    />
  );
}
