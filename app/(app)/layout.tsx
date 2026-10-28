import { AppShell } from "@/components/app-shell";
import { getProfile } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  return (
    <AppShell role={profile.role} name={profile.full_name}>
      {children}
    </AppShell>
  );
}
