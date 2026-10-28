import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Pills: green = good, yellow = needs a look, orange = problem, white = neutral, black = strong.
const badgeVariants = cva("inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-[11px] text-[13px] font-medium", {
  variants: {
    variant: {
      default: "bg-green text-white",
      secondary: "bg-surface-2 text-fg",
      warning: "bg-yellow text-[#1c1c1a]",
      destructive: "bg-orange text-white",
      info: "bg-surface-3 text-fg shadow-[var(--shadow-soft)]",
      dark: "bg-black text-white",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-[var(--radius-inner)] bg-black/[.06]", className)} {...props} />;
}

export function Progress({ value, className, tone }: { value: number; className?: string; tone?: "ok" | "low" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-3 w-full overflow-hidden rounded-full bg-surface-2", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-all", tone === "low" ? "bg-orange" : "bg-green")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      {icon ? (
        <div className="mb-1 grid size-[52px] place-items-center rounded-full bg-surface-3 text-muted shadow-[var(--shadow-soft)] [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="text-[17px] font-medium">{title}</p>
      {description ? <p className="max-w-sm text-[15px] text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 nav:mb-7">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description ? <p className="mt-1.5 text-[15px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small number tile used inside pages (e.g. a truck's totals). */
export function Stat({
  label,
  value,
  sub,
  tone,
  tip,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "positive" | "negative";
  tip?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-tile)] bg-surface-3 p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        {label}
        {tip}
      </div>
      <p
        className={cn(
          "mt-1 truncate text-[22px] font-semibold tracking-[-0.02em] tabular-nums sm:text-[26px]",
          tone === "positive" && "text-green",
          tone === "negative" && "text-orange",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[13px] text-muted">{sub}</p> : null}
    </div>
  );
}

/**
 * Headline number with a plain-English caption ("Money in") and an optional change against
 * the previous period. `costly` flips the colour: for expenses, going up is bad.
 */
export function StatCard({
  label,
  caption,
  value,
  change,
  changeLabel,
  costly,
  tone,
  tip,
}: {
  label: string;
  caption: string;
  value: React.ReactNode;
  /** Percent change vs previous period, or null when there is nothing to compare */
  change?: number | null;
  changeLabel?: string;
  costly?: boolean;
  tone?: "positive" | "negative";
  tip?: React.ReactNode;
}) {
  const good = change === null || change === undefined ? null : costly ? change <= 0 : change >= 0;
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-tile)] bg-surface-3 p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-1.5">
        <span className="text-[15px] font-medium">{label}</span>
        {tip}
      </div>
      <span className="text-[13px] text-muted">{caption}</span>
      <p
        className={cn(
          "mt-3 truncate text-[28px] font-semibold leading-tight tracking-[-0.02em] tabular-nums nav:text-[30px]",
          tone === "positive" && "text-green",
          tone === "negative" && "text-orange",
        )}
      >
        {value}
      </p>
      {change !== undefined ? (
        <p className="mt-1.5 flex items-center gap-1 text-[13px] text-muted">
          {change === null ? (
            <span>No earlier data to compare</span>
          ) : (
            <>
              <span className={cn("inline-flex items-center font-medium", good ? "text-green" : "text-orange")}>
                {change >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                {change > 0 ? "+" : ""}
                {change}%
              </span>
              <span>{changeLabel ?? "vs last period"}</span>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
