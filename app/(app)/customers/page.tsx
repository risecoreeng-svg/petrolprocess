import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomersClient, type BalanceRow, type PaymentRow } from "./customers-client";

export default async function CustomersPage() {
  const profile = await requireRole("owner", "manager");
  const supabase = await createClient();

  const [{ data: balances }, { data: payments }, { data: staff }] = await Promise.all([
    supabase.from("customer_balances").select("*").order("balance", { ascending: false }),
    supabase
      .from("credit_payments")
      .select("id, customer_id, amount, method, date, received_by, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("id, full_name"),
  ]);

  return (
    <CustomersClient
      balances={(balances ?? []) as BalanceRow[]}
      payments={(payments ?? []) as PaymentRow[]}
      staff={staff ?? []}
      isOwner={profile.role === "owner"}
    />
  );
}
