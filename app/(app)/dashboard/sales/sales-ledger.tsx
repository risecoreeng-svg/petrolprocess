"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { PAYMENT_LABEL, type PaymentType } from "@/lib/types";
import { cn, downloadFile, formatDate, formatDateTime, num, toCsv } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type LedgerRow = {
  id: string;
  date: string;
  created_at: string;
  fuel: string;
  litres: number;
  /** Base currency */
  price: number;
  original_price: number;
  /** Base currency */
  total: number;
  original_total: number;
  currency: string;
  payment_type: PaymentType;
  payment_ref: string | null;
  customer: string;
  attendant: string;
  shift: string;
  delivery_status: string | null;
  delivery_date: string | null;
  delivered_at: string | null;
  voided: boolean;
  void_reason: string | null;
};

export type TripIncomeRow = {
  id: string;
  trip_no: number;
  date: string;
  truck: string;
  client: string;
  cargo: string;
  currency: string;
  fee_original: number;
  /** Base currency */
  income: number;
};

type Display = { code: string; rate: number };
type SortKey = "created_at" | "fuel" | "litres" | "price" | "total" | "payment_type" | "customer" | "attendant";

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function deliveryText(r: LedgerRow) {
  if (r.delivery_status === "scheduled") return `Scheduled ${formatDate(r.delivery_date)}`;
  if (r.delivery_status === "delivered") return `Delivered ${formatDate(r.delivered_at ?? r.delivery_date)}`;
  return "At the pump";
}

/** Every sale in the period, with filters, sorting, search and CSV export. Rows open the full sale. */
export function SalesLedger({
  rows,
  base,
  display,
  detailQuery,
  fileSuffix,
}: {
  rows: LedgerRow[];
  base: string;
  display: Display;
  detailQuery: string;
  fileSuffix: string;
}) {
  const router = useRouter();
  const [fuel, setFuel] = useState("");
  const [pay, setPay] = useState("");
  const [attendant, setAttendant] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "created_at", desc: true });

  const options = useMemo(
    () => ({ fuel: uniq(rows.map((r) => r.fuel)), attendant: uniq(rows.map((r) => r.attendant)), customer: uniq(rows.map((r) => r.customer)) }),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!fuel || r.fuel === fuel) &&
        (!pay || r.payment_type === pay) &&
        (!attendant || r.attendant === attendant) &&
        (!customer || r.customer === customer) &&
        (!status || (status === "voided" ? r.voided : !r.voided)) &&
        (!needle ||
          [r.fuel, r.customer, r.attendant, r.payment_ref ?? "", r.currency, PAYMENT_LABEL[r.payment_type], String(r.litres)]
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    );
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, fuel, pay, attendant, customer, status, q, sort]);

  const shownActive = shown.filter((r) => !r.voided);
  const shownTotal = shownActive.reduce((x, r) => x + r.total, 0);
  const shownLitres = shownActive.reduce((x, r) => x + r.litres, 0);
  const filtered = !!(fuel || pay || attendant || customer || status || q);

  function exportCsv() {
    downloadFile(
      `petrotrack_sales_${fileSuffix}.csv`,
      toCsv(
        shown.map((r) => ({
          date_time: r.created_at,
          fuel: r.fuel,
          litres: r.litres,
          currency: r.currency,
          price_per_litre: r.original_price,
          amount: r.original_total,
          [`price_per_litre_${base}`]: r.price,
          [`amount_${base}`]: r.total,
          payment: PAYMENT_LABEL[r.payment_type],
          payment_ref: r.payment_ref ?? "",
          customer: r.customer,
          attendant: r.attendant,
          shift: r.shift,
          delivery: deliveryText(r),
          status: r.voided ? "Deleted" : "Active",
          delete_reason: r.void_reason ?? "",
        })),
      ),
    );
  }

  const head = (key: SortKey, label: string, right?: boolean) => (
    <TH className={cn(right && "text-right")} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        className={cn("inline-flex items-center gap-1 hover:text-fg", sort.key === key && "text-fg")}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === "created_at" || key === "total" || key === "litres" }))}
      >
        {label}
        {sort.key === key ? sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : null}
      </button>
    </TH>
  );
  const open = (id: string) => router.push(`/dashboard/sales/${id}${detailQuery}`);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <div className="relative col-span-2 sm:col-span-3 xl:col-span-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search sales" className="pl-10" />
        </div>
        <Select value={fuel} onChange={(e) => setFuel(e.target.value)} aria-label="Fuel type">
          <option value="">All fuel</option>
          {options.fuel.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </Select>
        <Select value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Payment type">
          <option value="">All payments</option>
          {(Object.keys(PAYMENT_LABEL) as PaymentType[]).map((p) => (
            <option key={p} value={p}>
              {PAYMENT_LABEL[p]}
            </option>
          ))}
        </Select>
        <Select value={attendant} onChange={(e) => setAttendant(e.target.value)} aria-label="Attendant">
          <option value="">All attendants</option>
          {options.attendant.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
        <Select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer">
          <option value="">All customers</option>
          {options.customer.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Active and deleted</option>
          <option value="active">Active only</option>
          <option value="voided">Deleted only</option>
        </Select>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[14px] text-muted">
        <span>
          {filtered ? `${shown.length} of ${rows.length} sales · ` : `${rows.length} sales · `}
          <span className="font-medium text-fg tabular-nums">{formatMoney(shownTotal * display.rate, display.code)}</span> ·{" "}
          {num(shownLitres)} L
        </span>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
          <Download /> CSV
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={rows.length ? "No sales match these filters" : "No sales in this period"} description="Try another period or clear the filters." />
      ) : (
        <Table>
          <THead>
            <tr>
              {head("created_at", "Date and time")}
              {head("fuel", "Fuel")}
              {head("litres", "Litres", true)}
              {head("price", "Price / L", true)}
              {head("total", "Amount", true)}
              {head("payment_type", "Payment")}
              {head("customer", "Customer")}
              {head("attendant", "Attendant")}
              <TH>Shift</TH>
              <TH>Delivery</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {shown.map((r) => (
              <TR
                key={r.id}
                tabIndex={0}
                role="link"
                aria-label={`Open sale of ${num(r.litres)} L ${r.fuel}`}
                onClick={() => open(r.id)}
                onKeyDown={(e) => e.key === "Enter" && open(r.id)}
                className={cn("cursor-pointer", r.voided && "text-muted")}
              >
                <TD>
                  <Link href={`/dashboard/sales/${r.id}${detailQuery}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {formatDateTime(r.created_at)}
                  </Link>
                </TD>
                <TD>{r.fuel}</TD>
                <TD className="text-right tabular-nums">{num(r.litres)}</TD>
                <TD className="text-right tabular-nums">
                  {formatMoney(r.original_price, r.currency)}
                  {r.currency !== base ? <span className="block text-[13px] text-muted">{formatMoney(r.price, base)}</span> : null}
                </TD>
                <TD className={cn("text-right font-medium tabular-nums", r.voided && "line-through")}>
                  {formatMoney(r.original_total, r.currency)}
                  {r.currency !== base ? <span className="block text-[13px] font-normal text-muted">{formatMoney(r.total, base)}</span> : null}
                </TD>
                <TD>{PAYMENT_LABEL[r.payment_type]}</TD>
                <TD>{r.customer}</TD>
                <TD>{r.attendant}</TD>
                <TD className="text-[14px] text-muted">{r.shift || "—"}</TD>
                <TD className="text-[14px]">{deliveryText(r)}</TD>
                <TD>{r.voided ? <Badge variant="destructive">Deleted</Badge> : <Badge variant="secondary">Active</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

/** Delivered trips that earned income in the period (owner only). */
export function TripIncomeTable({ rows, base, display }: { rows: TripIncomeRow[]; base: string; display: Display }) {
  const total = rows.reduce((x, r) => x + r.income, 0);
  if (rows.length === 0) return <EmptyState title="No trips delivered in this period" description="Trip income is counted on the day a trip is delivered." />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[14px] text-muted">
        <span>
          {rows.length} trips · <span className="font-medium text-fg tabular-nums">{formatMoney(total * display.rate, display.code)}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadFile(
              "petrotrack_trip_income.csv",
              toCsv(rows.map((r) => ({ trip: r.trip_no, delivered: r.date, truck: r.truck, client: r.client, cargo: r.cargo, currency: r.currency, fee: r.fee_original, [`income_${base}`]: r.income }))),
            )
          }
        >
          <Download /> CSV
        </Button>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Trip</TH>
            <TH>Delivered</TH>
            <TH>Truck</TH>
            <TH>Client</TH>
            <TH>Cargo</TH>
            <TH className="text-right">Income</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/trips/${r.id}`} className="font-medium hover:underline">
                  #{r.trip_no}
                </Link>
              </TD>
              <TD>{formatDate(r.date)}</TD>
              <TD>{r.truck}</TD>
              <TD>{r.client}</TD>
              <TD className="capitalize">{r.cargo}</TD>
              <TD className="text-right font-medium tabular-nums">
                {formatMoney(r.income, base)}
                {r.currency !== base ? <span className="block text-[13px] font-normal text-muted">fee {formatMoney(r.fee_original, r.currency)}</span> : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
