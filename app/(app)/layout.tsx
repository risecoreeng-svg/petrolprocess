import { AppShell } from "@/components/app-shell";
import { DeleteRulesProvider } from "@/components/delete-record";
import { getProfile } from "@/lib/auth";
import { getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, money, org] = await Promise.all([
    getProfile(),
    getMoneyContext(),
    // How long managers may delete or edit their own records (owner setting; 24 h by default).
    createClient().then((s) => s.from("organizations").select("delete_window_hours").maybeSingle()),
  ]);
  const rules = { userId: profile.id, role: profile.role, windowHours: Number(org.data?.delete_window_hours ?? 24) };
  return (
    <DeleteRulesProvider value={rules}>
      <AppShell role={profile.role} name={profile.full_name} orgName={profile.org_name} money={money}>
        {children}
      </AppShell>
    </DeleteRulesProvider>
  );
}
