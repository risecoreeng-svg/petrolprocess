import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, litres, num } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { labelize, TRUCK_STATUS_LABEL, type Truck } from "@/lib/types";
import { Badge, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { InfoTip } from "@/components/ui/info-tip";

type Delivery = {
  id: string;
  date: string;
  supplier_id: string;
  litres: number;
  cost_per_litre?: number;
  fuel_cost?: number;
  trip_cost?: number;
  landed_cost_per_litre?: number;
};

export default async function TruckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireRole("owner", "manager");
  const isOwner = profile.role === "owner";
  const money = (v: number | string | null | undefined) => formatMoney(v, profile.base_currency);
  const supabase = await createClient();

  const { data: truck } = await supabase.from("trucks").select("*").eq("id", id).maybeSingle();
  if (!truck) notFound();

  const [deliveriesRes, { data: suppliers }, { data: expenses }, { data: driver }, perfRes] = await Promise.all([
    isOwner
      ? supabase
          .from("purchases")
          .select("id, date, supplier_id, litres, cost_per_litre, fuel_cost, trip_cost, landed_cost_per_litre")
          .eq("truck_id", id)
          .is("deleted_at", null)
          .order("date", { ascending: false })
      : supabase.from("purchases_safe").select("id, date, supplier_id, litres").eq("truck_id", id).order("date", { ascending: false }),
    supabase.from("suppliers").select("id, name"),
    supabase
      .from("expenses")
      .select("id, date, category, amount, description")
      .eq("truck_id", id)
      .is("deleted_at", null)
      .order("date", { ascending: false }),
    truck.driver_id
      ? supabase.from("drivers").select("name, phone").eq("id", truck.driver_id).maybeSingle()
      : Promise.resolve({ data: null }),
    isOwner
      ? supabase.from("truck_performance").select("*").eq("truck_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const deliveries = (deliveriesRes.data ?? []) as Delivery[];
  const supplierName = (sid: string) => suppliers?.find((s) => s.id === sid)?.name ?? "—";
  const perf = perfRes.data as Record<string, number> | null;
  const t = truck as Truck;
  const totalLitres = deliveries.reduce((s, d) => s + Number(d.litres), 0);
  const repairs = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0);

  return (
    <>
      <Link href="/trucks" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Trucks
      </Link>
      <PageHeader
        title={t.plate_number}
        description={`${driver ? `${driver.name}${driver.phone ? ` · ${driver.phone}` : ""}` : "No driver"} · capacity ${litres(t.capacity_litres)}`}
        actions={<Badge>{TRUCK_STATUS_LABEL[t.status]}</Badge>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Deliveries" value={deliveries.length} />
        <Stat label="Litres brought" value={litres(totalLitres)} />
        {isOwner && perf ? (
          <>
            <Stat label="Fuel + trip cost" value={money(Number(perf.fuel_cost) + Number(perf.trip_cost))} sub={`Trip costs ${money(perf.trip_cost)}`} />
            <Stat
              label="Profit"
              value={money(perf.profit)}
              sub={`Fuel margin ${money(perf.margin)} − repairs ${money(perf.repair_costs)} − other ${money(perf.other_truck_costs)}`}
              tip={<InfoTip>Estimate. Fuel margin = litres this truck brought × (today&apos;s pump price − what each litre really cost). Then repairs and other costs tagged to this truck are taken off.</InfoTip>}
              tone={Number(perf.profit) >= 0 ? "positive" : "negative"}
            />
          </>
        ) : (
          <Stat label="Truck expenses" value={money(repairs)} />
        )}
      </div>

      <h2 className="card-title mb-3">Deliveries</h2>
      {deliveries.length === 0 ? (
        <EmptyState title="No deliveries yet" description="Deliveries recorded with this truck will show here." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Supplier</TH>
              <TH className="text-right">Litres</TH>
              {isOwner ? (
                <>
                  <TH className="text-right">Cost / L</TH>
                  <TH className="text-right">What the fuel cost</TH>
                  <TH className="text-right">Trip cost</TH>
                  <TH className="text-right">Real cost / L</TH>
                </>
              ) : null}
            </tr>
          </THead>
          <TBody>
            {deliveries.map((d) => (
              <TR key={d.id}>
                <TD>{formatDate(d.date)}</TD>
                <TD>{supplierName(d.supplier_id)}</TD>
                <TD className="text-right tabular-nums">{num(d.litres)}</TD>
                {isOwner ? (
                  <>
                    <TD className="text-right tabular-nums">{num(d.cost_per_litre, 4)}</TD>
                    <TD className="text-right tabular-nums">{money(d.fuel_cost)}</TD>
                    <TD className="text-right tabular-nums">{money(d.trip_cost)}</TD>
                    <TD className="text-right tabular-nums">{num(d.landed_cost_per_litre, 4)}</TD>
                  </>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <h2 className="card-title mb-3 mt-8">Repairs and other costs</h2>
      {(expenses ?? []).length === 0 ? (
        <EmptyState title="No truck expenses" description="Tag an expense with this truck to see it here." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Category</TH>
              <TH>Description</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </THead>
          <TBody>
            {expenses!.map((e) => (
              <TR key={e.id}>
                <TD>{formatDate(e.date)}</TD>
                <TD>{labelize(e.category)}</TD>
                <TD className="whitespace-normal">{e.description}</TD>
                <TD className="text-right tabular-nums">{money(e.amount)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
