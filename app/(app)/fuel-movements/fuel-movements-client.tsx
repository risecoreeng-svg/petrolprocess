"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Droplet } from "lucide-react";
import { cn, downloadFile, formatDate, num, toCsv } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type Movement = {
  id: string;
  trip_no: number;
  date: string;
  truck_id: string;
  driver_id: string | null;
  customer_id: string | null;
  for_own_depot: boolean;
  route_from: string;
  route_to: string;
  fuel_type_id: string | null;
  litres_loaded: number | null;
  litres_delivered: number | null;
  shortage_litres: number | null;
  shortage_pct: number | null;
  haulage_status: "ok" | "disputed" | "resolved" | null;
  loading_ticket: string | null;
  loaded_from: string | null;
  status: string;
};

type Named = { id: string; name?: string; plate_number?: string };

export function FuelMovementsClient({
  rows,
  trucks,
  drivers,
  customers,
  fuelTypes,
  filter,
  fileSuffix,
}: {
  rows: Movement[];
  trucks: Named[];
  drivers: Named[];
  customers: Named[];
  fuelTypes: Named[];
  filter: { truck: string; client: string; fuel: string };
  fileSuffix: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const find = (list: Named[], id: string | null) => list.find((x) => x.id === id);
  const clientName = (m: Movement) => (m.for_own_depot ? "Our depot" : find(customers, m.customer_id)?.name ?? "—");

  function go(patch: Partial<typeof filter>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}?${next}`);
  }

  const loaded = rows.reduce((s, r) => s + Number(r.litres_loaded ?? 0), 0);
  const deliveredRows = rows.filter((r) => r.litres_delivered != null);
  const delivered = deliveredRows.reduce((s, r) => s + Number(r.litres_delivered), 0);
  const loadedOfDelivered = deliveredRows.reduce((s, r) => s + Number(r.litres_loaded ?? 0), 0);
  const shortage = loadedOfDelivered - delivered;
  const pct = loadedOfDelivered ? (shortage / loadedOfDelivered) * 100 : 0;

  function exportCsv() {
    downloadFile(
      `fuel_movements_${fileSuffix}.csv`,
      toCsv(
        rows.map((r) => ({
          Date: r.date,
          Trip: r.trip_no,
          Truck: find(trucks, r.truck_id)?.plate_number ?? "",
          Driver: find(drivers, r.driver_id)?.name ?? "",
          Client: clientName(r),
          Fuel: find(fuelTypes, r.fuel_type_id)?.name ?? "",
          From: r.route_from,
          To: r.route_to,
          "Loading ticket": r.loading_ticket ?? "",
          "Litres loaded": r.litres_loaded ?? "",
          "Litres delivered": r.litres_delivered ?? "",
          "Shortage L": r.shortage_litres ?? "",
          "Shortage %": r.shortage_pct ?? "",
          Status: r.haulage_status ?? r.status,
        })),
      ),
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <Select aria-label="Truck" value={filter.truck} onChange={(e) => go({ truck: e.target.value })}>
          <option value="">All trucks</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.plate_number}
            </option>
          ))}
        </Select>
        <Select aria-label="Client" value={filter.client} onChange={(e) => go({ client: e.target.value })}>
          <option value="">All clients</option>
          <option value="own">Our own depot</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Fuel" value={filter.fuel} onChange={(e) => go({ fuel: e.target.value })}>
          <option value="">All fuels</option>
          {fuelTypes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
          <Download /> CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Droplet />} title="No fuel carried in this period" description="Fuel trips appear here with loaded and delivered litres." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Truck</TH>
              <TH>Driver</TH>
              <TH>Client</TH>
              <TH>From</TH>
              <TH>To</TH>
              <TH className="text-right">Loaded (L)</TH>
              <TH className="text-right">Delivered (L)</TH>
              <TH className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  Shortage
                  <InfoTip>Loaded minus delivered. Red means above your allowed tolerance.</InfoTip>
                </span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/trips/${r.id}`} className="underline-offset-2 hover:underline">
                    {formatDate(r.date)}
                  </Link>
                  <span className="block text-[13px] text-muted">
                    #{r.trip_no} · {find(fuelTypes, r.fuel_type_id)?.name}
                  </span>
                </TD>
                <TD className="font-medium">{find(trucks, r.truck_id)?.plate_number}</TD>
                <TD>{find(drivers, r.driver_id)?.name ?? "—"}</TD>
                <TD>{clientName(r)}</TD>
                <TD>{r.route_from}</TD>
                <TD>{r.route_to}</TD>
                <TD className="text-right tabular-nums">{num(r.litres_loaded)}</TD>
                <TD className="text-right tabular-nums">{r.litres_delivered != null ? num(r.litres_delivered) : <span className="text-muted">On the way</span>}</TD>
                <TD className="text-right tabular-nums">
                  {r.shortage_litres != null ? (
                    <span className={cn(r.haulage_status === "disputed" && "font-semibold text-orange")}>
                      {num(r.shortage_litres)} · {num(r.shortage_pct, 2)}%
                    </span>
                  ) : (
                    "—"
                  )}
                  {r.haulage_status === "disputed" ? <Badge variant="destructive" className="ml-2">Disputed</Badge> : null}
                  {r.haulage_status === "resolved" ? <Badge variant="info" className="ml-2">Resolved</Badge> : null}
                </TD>
              </TR>
            ))}
            <TR className="bg-surface-2 font-semibold">
              <TD colSpan={6}>Total · {rows.length} trips</TD>
              <TD className="text-right tabular-nums">{num(loaded)}</TD>
              <TD className="text-right tabular-nums">{num(delivered)}</TD>
              <TD className="text-right tabular-nums">
                {num(shortage)} · {num(pct, 2)}%
              </TD>
            </TR>
          </TBody>
        </Table>
      )}
    </>
  );
}
