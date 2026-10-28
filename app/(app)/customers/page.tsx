import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { CustomersClient, type BalanceRow, type PaymentRow } from "./customers-client";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ cur?: string }> }) {
  const disp = displayCurrency(await getMoneyContext(), (await searchParams).cur);
  const profile = await requireRole("owner", "manager");
  const supabase = await createClient();

  const [{ data: balances }, { data: payments }, { data: staff }] = await Promise.all([
    supabase.from("customer_balances").select("*").order("balance", { ascending: false }),
    supabase
      .from("credit_payments")
      .select("id, customer_id, amount, currency, original_amount, method, date, received_by, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("id, full_name"),
  ]);

  return (
    <CustomersClient
      display={{ code: disp.code, rate: disp.rate }}
      balances={(balances ?? []) as BalanceRow[]}
      payments={(payments ?? []) as PaymentRow[]}
      staff={staff ?? []}
      isOwner={profile.role === "owner"}
    />
  );
}
