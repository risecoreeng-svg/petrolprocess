import * as React from "react";
import Link from "next/link";
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


/**
 * Font size for a headline amount that never needs "...": long values step down in size and
 * may wrap at a natural break instead of being cut off. The full value is also in the title.
 */
export function amountClass(value: React.ReactNode, size: "card" | "tile" = "card") {
  const n = typeof value === "string" || typeof value === "number" ? String(value).length : 8;
  if (size === "tile") {
    return n <= 10 ? "text-[22px] sm:text-[26px]" : n <= 14 ? "text-[19px] sm:text-[22px]" : n <= 18 ? "text-[16px] sm:text-[19px]" : "text-[14px] sm:text-[16px]";
  }
  return n <= 9
    ? "text-[26px] nav:text-[30px]"
    : n <= 12
      ? "text-[22px] nav:text-[26px]"
      : n <= 15
        ? "text-[18px] nav:text-[22px]"
        : n <= 19
          ? "text-[16px] nav:text-[19px]"
          : "text-[14px] nav:text-[16px]";
}

const amountBase = "mt-1 font-semibold leading-tight tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere]";

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
        title={typeof value === "string" ? value : undefined}
        className={cn(amountBase, amountClass(value, "tile"), tone === "positive" && "text-green", tone === "negative" && "text-orange")}
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
 * With `href` the whole card opens a detail page.
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
  href,
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
  href?: string;
}) {
  const good = change === null || change === undefined ? null : costly ? change <= 0 : change >= 0;
  const body = (
    <>
      <div className="flex items-start gap-1.5">
        <span className="text-[15px] font-medium">{label}</span>
        {tip}
        {href ? (
          <span className="ml-auto grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition-colors group-hover:border-black group-hover:bg-black group-hover:text-white">
            <ArrowUpRight className="size-3.5" />
          </span>
        ) : null}
      </div>
      <span className="text-[13px] text-muted">{caption}</span>
      <p
        title={typeof value === "string" ? value : undefined}
        className={cn(amountBase, "mt-3", amountClass(value), tone === "positive" && "text-green", tone === "negative" && "text-orange")}
      >
        {value}
      </p>
      {change !== undefined ? (
        <p className="mt-auto flex flex-wrap items-center gap-x-1 pt-1.5 text-[13px] text-muted">
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
    </>
  );
  const box = "flex min-w-0 flex-col rounded-[var(--radius-tile)] bg-surface-3 p-4 shadow-[var(--shadow-soft)] sm:p-5";
  if (!href) return <div className={box}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        box,
        "group transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30",
      )}
      aria-label={`${label}: ${typeof value === "string" ? value : ""}. Open details`}
    >
      {body}
    </Link>
  );
}
