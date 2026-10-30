import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { describeRate, formatMoney } from "@/lib/currency";
import { getMoneyContext } from "@/lib/money-server";
import { createClient } from "@/lib/supabase/server";
import { PAYMENT_LABEL, type PaymentType } from "@/lib/types";
import { formatDate, formatDateTime, num } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, PageHeader } from "@/components/ui/misc";
import { DeleteButton } from "@/components/delete-record";
import { BackToDashboard, NeedsUpdate, type DrillParams } from "../../shared";

type Change = { action: string; changed_at: string; changed_by: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };

// Columns worth showing in the edit history, in plain words.
const FIELD_LABEL: Record<string, string> = {
  litres: "Litres",
  price_per_litre: "Price per litre",
  original_price_per_litre: "Price per litre (as charged)",
  total: "Amount",
  original_total: "Amount (as charged)",
  currency: "Currency",
  fx_rate: "Exchange rate",
  payment_type: "Payment",
  payment_ref: "Payment reference",
  customer_id: "Customer",
  fuel_type_id: "Fuel",
  tank_id: "Tank",
  delivery_status: "Delivery",
  delivery_date: "Delivery date",
  delivered_at: "Delivered at",
  deleted_at: "Deleted at",
  void_reason: "Reason",
  delete_reason: "Reason",
  delete_note: "Note",
  cost_per_litre: "Cost per litre",
  cost_total: "Cost",
  date: "Date",
};

const ACTION_LABEL: Record<string, string> = { INSERT: "Recorded", UPDATE: "Edited", SOFT_DELETE: "Deleted", RESTORE: "Restored" };

export default async function SaleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<DrillParams> }) {
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getMoneyContext();
  const supabase = await createClient();

  const [{ data: sale, error }, historyRes, costRes] = await Promise.all([
    supabase.from("sales_ledger").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("sale_history", { p_sale: id }),
    // Cost and profit are for the owner only (the database refuses these columns to anyone else).
    isOwner ? supabase.from("sales").select("cost_per_litre, cost_total").eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) return (<><BackToDashboard sp={sp} href="/dashboard/sales" label="All sales" /><NeedsUpdate /></>);
  if (!sale) notFound();

  const ids = [sale.fuel_type_id, sale.tank_id, sale.customer_id, sale.attendant_id].filter(Boolean);
  const [{ data: fuel }, { data: tank }, { data: customer }, { data: people }, { data: shift }] = await Promise.all([
    supabase.from("fuel_types").select("id, name").in("id", ids),
    supabase.from("tanks").select("id, name").in("id", ids),
    supabase.from("customers").select("id, name, phone").in("id", ids),
    supabase.from("profiles").select("id, full_name"),
    sale.shift_id ? supabase.from("shifts").select("started_at, ended_at").eq("id", sale.shift_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const personName = (pid: string | null) => people?.find((p) => p.id === pid)?.full_name ?? "";
  const nameOfId = (field: string, v: unknown) => {
    if (typeof v !== "string") return v;
    if (field === "customer_id") return customer?.find((c) => c.id === v)?.name ?? v;
    if (field === "fuel_type_id") return fuel?.find((f) => f.id === v)?.name ?? v;
    if (field === "tank_id") return tank?.find((t) => t.id === v)?.name ?? v;
    if (field === "payment_type") return PAYMENT_LABEL[v as PaymentType] ?? v;
    return v;
  };

  const base = ctx.base;
  const cur = sale.currency ?? base;
  const fx = Number(sale.fx_rate ?? 1);
  const total = Number(sale.total);
  const cost = costRes.data ? Number(costRes.data.cost_total) : null;
  const voided = !!sale.deleted_at;
  const history = (historyRes.data ?? []) as Change[];

  const rows: [string, React.ReactNode][] = [
    ["Date and time", formatDateTime(sale.created_at)],
    ["Fuel", fuel?.find((f) => f.id === sale.fuel_type_id)?.name ?? ""],
    ["Tank", tank?.find((t) => t.id === sale.tank_id)?.name ?? ""],
    ["Litres", `${num(sale.litres)} L`],
    ["Price per litre", <Both key="p" original={sale.original_price_per_litre ?? sale.price_per_litre} base={sale.price_per_litre} cur={cur} baseCode={base} />],
    ["Amount", <Both key="a" original={sale.original_total ?? sale.total} base={sale.total} cur={cur} baseCode={base} />],
    ["Exchange rate used", cur === base ? `None (paid in ${base})` : describeRate(base, cur, fx)],
    ["Payment", `${PAYMENT_LABEL[sale.payment_type as PaymentType] ?? sale.payment_type}${sale.payment_ref ? ` · ref ${sale.payment_ref}` : ""}`],
    ["Customer", customer?.find((c) => c.id === sale.customer_id)?.name ?? "Walk-in"],
    ["Attendant", personName(sale.attendant_id) || "—"],
    ["Shift", shift ? `${formatDateTime(shift.started_at)} – ${shift.ended_at ? formatDateTime(shift.ended_at) : "still open"}` : "—"],
    [
      "Delivery",
      sale.delivery_status === "scheduled"
        ? `Scheduled for ${formatDate(sale.delivery_date)}`
        : sale.delivery_status === "delivered"
          ? `Delivered ${formatDateTime(sale.delivered_at) || formatDate(sale.delivery_date)}`
          : "Collected at the pump",
    ],
  ];

  return (
    <>
      <BackToDashboard sp={sp} href="/dashboard/sales" label="All sales" />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Sale of {num(sale.litres)} L
            {voided ? <Badge variant="destructive">Deleted</Badge> : <Badge variant="secondary">Active</Badge>}
          </span>
        }
        actions={
          voided ? null : (
            <DeleteButton kind="sale" id={sale.id} createdBy={sale.created_by} createdAt={sale.created_at} what={`the sale of ${num(sale.litres)} L`} full />
          )
        }
        description={`${formatMoney(total, base)} · ${formatDate(sale.date)}${voided && sale.void_reason ? ` · deleted: ${sale.void_reason}` : ""}`}
      />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-line">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 py-2.5 text-[15px]">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-5">
          {isOwner && cost !== null ? (
            <Card>
              <CardHeader>
                <CardTitle>Cost and profit</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-line text-[15px]">
                  <Line k="Sold for" v={formatMoney(total, base)} />
                  <Line k={`Cost of fuel (${num(sale.litres)} L × ${formatMoney(costRes.data!.cost_per_litre, base)})`} v={`− ${formatMoney(cost, base)}`} />
                  <Line k="Profit on this sale" v={formatMoney(total - cost, base)} strong tone={total - cost < 0 ? "text-orange" : "text-green"} />
                </dl>
                <p className="mt-3 text-[13px] text-muted">
                  Cost is the tank&apos;s average cost per litre (price plus transport) at the moment of the sale.
                  {voided ? " This sale is deleted, so it isn't counted in profit." : ""}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {historyRes.error ? (
                <p className="text-[15px] text-muted">History isn&apos;t available yet.</p>
              ) : history.length === 0 ? (
                <p className="text-[15px] text-muted">No changes recorded.</p>
              ) : (
                <ol className="space-y-4">
                  {history.map((h, i) => {
                    const changed =
                      h.old_data && h.new_data
                        ? Object.keys(FIELD_LABEL).filter((f) => JSON.stringify(h.old_data?.[f]) !== JSON.stringify(h.new_data?.[f]))
                        : [];
                    return (
                      <li key={i} className="border-l-2 border-line-strong pl-3.5">
                        <p className="font-medium">
                          {ACTION_LABEL[h.action] ?? h.action} <span className="font-normal text-muted">by {h.changed_by}</span>
                        </p>
                        <p className="text-[13px] text-muted">{formatDateTime(h.changed_at)}</p>
                        {changed.length ? (
                          <ul className="mt-1.5 space-y-0.5 text-[14px]">
                            {changed.map((f) => (
                              <li key={f} className="[overflow-wrap:anywhere]">
                                {FIELD_LABEL[f]}: <span className="text-muted line-through">{show(nameOfId(f, h.old_data?.[f]))}</span> →{" "}
                                {show(nameOfId(f, h.new_data?.[f]))}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v);
  return String(v);
}

function Both({ original, base, cur, baseCode }: { original: number | string; base: number | string; cur: string; baseCode: string }) {
  return (
    <span className="tabular-nums">
      {formatMoney(original, cur)}
      {cur !== baseCode ? <span className="text-muted"> = {formatMoney(base, baseCode)}</span> : null}
    </span>
  );
}

function Line({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className={strong ? "font-medium" : "text-muted"}>{k}</dt>
      <dd className={`shrink-0 tabular-nums [overflow-wrap:anywhere] ${strong ? `font-semibold ${tone ?? ""}` : ""}`}>{v}</dd>
    </div>
  );
}
