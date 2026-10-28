"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ChartColumn,
  Clock,
  Fuel,
  Gauge,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Receipt,
  ScrollText,
  Truck,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  ChartColumn,
  Clock,
  Fuel,
  Gauge,
  HandCoins,
  LayoutDashboard,
  PackagePlus,
  Receipt,
  ScrollText,
  Truck,
  UserCog,
};

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", attendant: "Attendant" };

export function AppShell({
  role,
  name,
  children,
}: {
  role: Role;
  name: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = navFor(role);
  const primary = items.filter((i) => i.primary).slice(0, 4);
  const hasMore = items.length > primary.length;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Fuel className="size-5" />
          </div>
          <div>
            <p className="font-bold leading-tight">PetroTrack</p>
            <p className="text-xs text-muted-foreground">Fuel depot manager</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                  isActive(item.href) && "bg-accent text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <div className="px-3 pb-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</p>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-card/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Fuel className="size-4" />
          </div>
          <span className="font-bold">PetroTrack</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {name} · {ROLE_LABEL[role]}
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
          {primary.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground",
                  isActive(item.href) && "text-primary",
                )}
              >
                <Icon className="size-6" />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"
          >
            <Menu className="size-6" />
            {hasMore ? "More" : "Account"}
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">Menu</p>
              <button onClick={() => setMoreOpen(false)} aria-label="Close" className="p-2">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {items
                .filter((i) => !primary.includes(i))
                .map((item) => {
                  const Icon = ICONS[item.icon];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border p-4 text-xs font-medium",
                        isActive(item.href) && "border-primary text-primary",
                      )}
                    >
                      <Icon className="size-6" />
                      {item.label}
                    </Link>
                  );
                })}
            </div>
            <button
              onClick={signOut}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
