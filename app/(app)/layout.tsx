import { AppShell } from "@/components/app-shell";
import { getProfile } from "@/lib/auth";
import { getMoneyContext } from "@/lib/money-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, money] = await Promise.all([getProfile(), getMoneyContext()]);
  return (
    <AppShell role={profile.role} name={profile.full_name} orgName={profile.org_name} money={money}>
      {children}
    </AppShell>
  );
}
