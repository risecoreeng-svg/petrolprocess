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
  MoreHorizontal,
  PackagePlus,
  Receipt,
  ScrollText,
  Settings,
  TriangleAlert,
  Truck,
  Navigation,
  Droplet,
  IdCard,
  Wrench,
  FileBadge,
  Handshake,
  TrendingUp,
  Route,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { describeRate, type MoneyContextValue } from "@/lib/currency";
import { MoneyProvider } from "@/components/money-provider";

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
  Settings,
  TriangleAlert,
  Truck,
  Navigation,
  Droplet,
  IdCard,
  Wrench,
  FileBadge,
  Handshake,
  TrendingUp,
  Route,
  UserCog,
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manager: "Sales manager",
  fleet_manager: "Fleet manager",
  attendant: "Attendant",
  driver: "Driver",
};

/** Black rounded square with a fuel drop: the PetroTrack mark. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("grid size-9 flex-none place-items-center rounded-[12px] bg-black text-yellow", className)}>
      <Fuel className="size-[18px]" strokeWidth={2.2} />
    </div>
  );
}

export function AppShell({
  role,
  name,
  orgName,
  money,
  children,
}: {
  role: Role;
  name: string;
  orgName: string;
  money: MoneyContextValue;
  children: React.ReactNode;
}) {
  const staleRates = Object.entries(money.rates).filter(([, r]) => r.stale);
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
    <div className="min-h-dvh nav:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-nav nav:flex">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-5">
          <BrandMark />
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight tracking-[-0.02em]">PetroTrack</p>
            <p className="truncate text-[13px] text-muted" title={orgName}>
              {orgName}
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {items.map((item, i) => {
            const Icon = ICONS[item.icon];
            const on = isActive(item.href);
            const heading = item.group && item.group !== items[i - 1]?.group ? item.group : null;
            return (
              <div key={item.href}>
              {heading ? <p className="px-4 pb-1 pt-4 text-xs font-medium uppercase tracking-[0.06em] text-faint">{heading}</p> : null}
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-full px-4 text-[15px] transition-colors",
                  on ? "bg-surface-3 font-medium text-fg shadow-[var(--shadow-soft)]" : "text-fg/80 hover:bg-black/[.05]",
                )}
              >
                <Icon className="size-[18px]" strokeWidth={on ? 2.1 : 1.8} />
                {item.label}
              </Link>
              </div>
            );
          })}
        </nav>
        <div className="m-3 rounded-[var(--radius-tile)] bg-surface/70 p-3">
          <div className="flex items-center gap-2.5 px-1 pb-2">
            <div className="grid size-9 flex-none place-items-center rounded-full bg-black text-sm font-semibold text-white">
              {name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="text-[13px] text-muted">{ROLE_LABEL[role]}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-full text-sm text-muted hover:bg-black/[.05] hover:text-fg"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-background/85 px-4 py-3 backdrop-blur nav:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark className="size-8 rounded-[10px]" />
          <span className="truncate font-semibold tracking-[-0.01em]">{orgName || "PetroTrack"}</span>
        </div>
        <span className="shrink-0 rounded-full bg-surface-3 px-3 py-1 text-[13px] text-muted shadow-[var(--shadow-soft)]">
          {ROLE_LABEL[role]}
        </span>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-32 pt-3 nav:px-10 nav:pb-16 nav:pt-9">
        {staleRates.length > 0 && role !== "attendant" ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-tile)] bg-yellow px-4 py-3 text-[15px] text-[#1c1c1a]">
            <TriangleAlert className="size-[18px] shrink-0" />
            <p className="min-w-0 flex-1">
              {staleRates.map(([code, r]) => `${describeRate(money.base, code, r.perBase)}${r.placeholder ? " (example rate)" : ` (from ${r.date})`}`).join(" · ")}
              . {role === "owner" ? "Update to the rate you actually use today." : "Ask the owner to update today's rate."}
            </p>
            {role === "owner" ? (
              <Link href="/settings" className="inline-flex h-10 items-center rounded-full bg-black px-4 text-sm font-medium text-white">
                Update rates
              </Link>
            ) : null}
          </div>
        ) : null}
        <MoneyProvider value={money}>{children}</MoneyProvider>
      </main>

      {/* Phone bottom tabs */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-nav/95 pb-[env(safe-area-inset-bottom)] backdrop-blur nav:hidden"
      >
        <div className="flex">
          {primary.map((item) => {
            const Icon = ICONS[item.icon];
            const on = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[12px]",
                  on ? "font-semibold text-fg" : "text-muted",
                )}
              >
                <span className={cn("grid h-8 w-14 place-items-center rounded-full", on && "bg-surface-3 shadow-[var(--shadow-soft)]")}>
                  <Icon className="size-5" strokeWidth={on ? 2.1 : 1.8} />
                </span>
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[12px] text-muted"
          >
            <span className="grid h-8 w-14 place-items-center rounded-full">
              <MoreHorizontal className="size-5" />
            </span>
            {hasMore ? "More" : "Account"}
          </button>
        </div>
      </nav>

      {/* Phone "More" sheet */}
      {moreOpen ? (
        <div className="fixed inset-0 z-50 nav:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/30" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[var(--radius-card)] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lift)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="card-title">{name}</p>
                <p className="text-[13px] text-muted">
                  {ROLE_LABEL[role]} · {orgName}
                </p>
              </div>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="grid size-10 place-items-center rounded-full border border-line-strong"
              >
                <X className="size-[18px]" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {items
                .filter((i) => !primary.includes(i))
                .map((item) => {
                  const Icon = ICONS[item.icon];
                  const on = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] bg-surface-3 p-3 text-[13px] font-medium shadow-[var(--shadow-soft)]",
                        on && "bg-black text-white",
                      )}
                    >
                      <Icon className="size-6" strokeWidth={1.8} />
                      {item.label}
                    </Link>
                  );
                })}
            </div>
            <button
              onClick={signOut}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line-strong text-[15px]"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
