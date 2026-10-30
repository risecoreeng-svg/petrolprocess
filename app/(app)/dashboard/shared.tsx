import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";

/** Query the drill-down pages read: the dashboard's period, currency and view. */
export type DrillParams = { range?: string; from?: string; to?: string; cur?: string; view?: string };

/** Keeps the period, currency and view when moving between the dashboard and its detail pages. */
export function keepQuery(sp: DrillParams, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  for (const k of ["range", "from", "to", "cur", "view"] as const) if (typeof sp[k] === "string" && sp[k]) q.set(k, sp[k]!);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function periodLabel(from: string, to: string) {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

export function BackToDashboard({ sp, href = "/", label = "Dashboard" }: { sp: DrillParams; href?: string; label?: string }) {
  return (
    <Link
      href={`${href}${keepQuery(sp)}`}
      className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}

/** Shown when the database hasn't been updated with the views these pages read. */
export function NeedsUpdate() {
  return (
    <p className="rounded-[var(--radius-tile)] border border-dashed border-line-strong bg-surface/60 p-5 text-[15px] text-muted">
      This page needs the latest database update. Ask the owner to apply it, then reload.
    </p>
  );
}
