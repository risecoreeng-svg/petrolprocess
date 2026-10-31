import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, nairobiToday, startOfMonth } from "@/lib/utils";
import type { Truck } from "@/lib/types";
import { getPriceRefs } from "@/lib/price-refs-server";
import { ExpensesClient, type ExpenseRow } from "./expenses-client";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; truck?: string }>;
}) {
  const sp = await searchParams;
  await requireRole("owner", "manager");
  const supabase = await createClient();
  const today = nairobiToday();
  const from = sp.from ?? startOfMonth(today);
  const to = sp.to ?? today;

  let q = supabase
    .from("expenses")
    .select("id, date, category, amount, currency, original_amount, truck_id, description, created_by, created_at")
    .is("deleted_at", null)
    .gte("date", from)
    .lte("date", to);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.truck) q = q.eq("truck_id", sp.truck);

  const [{ data: rows }, { data: trucks }, priceRefs] = await Promise.all([
    q.order("date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("trucks").select("*").is("deleted_at", null).order("plate_number"),
    getPriceRefs({ expenses: true }),
  ]);

  return (
    <ExpensesClient
      rows={(rows ?? []) as ExpenseRow[]}
      trucks={(trucks ?? []) as Truck[]}
      filter={{ from, to, category: sp.category ?? "", truck: sp.truck ?? "" }}
      defaults={{ monthStart: startOfMonth(today), weekStart: addDays(today, -6), today }}
      lastAmounts={priceRefs.expense}
    />
  );
}
