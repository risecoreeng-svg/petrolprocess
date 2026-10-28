"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import type { Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { toNum } from "@/lib/use-submit";
import { cn, errorMessage, formatDateTime, kes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type ShiftRow = {
  id: string;
  attendant_id: string;
  started_at: string;
  ended_at: string | null;
  expected_cash: number | null;
  cash_handed_in: number | null;
  variance: number | null;
};

const endSchema = z.object({ cash: z.number({ error: "Enter the cash you are handing in" }).min(0) });

function VarianceBadge({ v }: { v: number | null }) {
  if (v === null) return <Badge variant="info">Open</Badge>;
  if (Number(v) === 0) return <Badge>Balanced</Badge>;
  return Number(v) < 0 ? (
    <Badge variant="destructive">Short {kes(Math.abs(Number(v)))}</Badge>
  ) : (
    <Badge variant="warning">Over {kes(v)}</Badge>
  );
}

export function ShiftsClient({
  userId,
  role,
  shifts,
  openShift,
  openShiftSales,
  staff,
}: {
  userId: string;
  role: Role;
  shifts: ShiftRow[];
  openShift: ShiftRow | null;
  openShiftSales: { count: number; total: number };
  staff: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cash, setCash] = useState("");
  const [cashError, setCashError] = useState<string>();
  const [result, setResult] = useState<ShiftRow | null>(null);
  const staffName = (id: string) => staff.find((s) => s.id === id)?.full_name ?? "";

  async function start() {
    setBusy(true);
    const { error } = await createClient().rpc("start_shift");
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Shift started");
    router.refresh();
  }

  async function end(e: React.FormEvent) {
    e.preventDefault();
    const parsed = endSchema.safeParse({ cash: toNum(cash) });
    if (!parsed.success) return setCashError(parsed.error.issues[0].message);
    setCashError(undefined);
    if (!confirm(`Hand in ${kes(parsed.data.cash)} and close your shift?`)) return;
    setBusy(true);
    const { data, error } = await createClient()
      .rpc("end_shift", { p_shift: openShift!.id, p_cash_handed_in: parsed.data.cash })
      .single();
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    setResult(data as ShiftRow);
    setCash("");
    toast.success("Shift closed");
    router.refresh();
  }

  return (
    <>
      <PageHeader title="Shifts" description={role === "attendant" ? "Your shifts and cash hand-over" : "All attendants' shifts"} />

      <Card className="mb-6 max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-5" /> {openShift ? "Shift in progress" : "No open shift"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openShift ? (
            <form onSubmit={end} className="grid gap-4" noValidate>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Started</p>
                  <p className="font-medium">{formatDateTime(openShift.started_at)}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Sales this shift</p>
                  <p className="font-medium">
                    {openShiftSales.count} · {kes(openShiftSales.total)}
                  </p>
                </div>
              </div>
              <Field label="Cash handed in (KES)" htmlFor="cash" error={cashError} hint="Count the cash in your hand. M-Pesa and credit sales are not cash.">
                <Input
                  id="cash"
                  inputMode="decimal"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  className="h-14 text-2xl font-bold"
                />
              </Field>
              <Button type="submit" size="xl" variant="destructive" disabled={busy}>
                End shift
              </Button>
            </form>
          ) : (
            <Button size="xl" className="w-full" onClick={start} disabled={busy}>
              Start shift
            </Button>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-2 font-semibold">History</h2>
      {shifts.length === 0 ? (
        <EmptyState icon={<Clock />} title="No shifts yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              {role !== "attendant" ? <TH>Attendant</TH> : null}
              <TH>Start</TH>
              <TH>End</TH>
              <TH className="text-right">Expected cash</TH>
              <TH className="text-right">Handed in</TH>
              <TH>Variance</TH>
            </tr>
          </THead>
          <TBody>
            {shifts.map((s) => (
              <TR key={s.id} className={cn(s.attendant_id === userId && !s.ended_at && "bg-accent/50")}>
                {role !== "attendant" ? <TD className="font-medium">{staffName(s.attendant_id)}</TD> : null}
                <TD>{formatDateTime(s.started_at)}</TD>
                <TD>{s.ended_at ? formatDateTime(s.ended_at) : "—"}</TD>
                <TD className="text-right tabular-nums">{s.expected_cash !== null ? kes(s.expected_cash) : "—"}</TD>
                <TD className="text-right tabular-nums">{s.cash_handed_in !== null ? kes(s.cash_handed_in) : "—"}</TD>
                <TD>
                  <VarianceBadge v={s.ended_at ? s.variance : null} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal open={!!result} onClose={() => setResult(null)} title="Shift closed">
        {result ? (
          <div className="grid gap-3">
            <Row label="Expected cash" value={kes(result.expected_cash)} />
            <Row label="Cash handed in" value={kes(result.cash_handed_in)} />
            <div
              className={cn(
                "flex items-center justify-between rounded-xl p-4 text-lg font-bold",
                Number(result.variance) < 0 ? "bg-red-50 text-destructive" : Number(result.variance) > 0 ? "bg-amber-50 text-amber-800" : "bg-accent text-accent-foreground",
              )}
            >
              <span>Variance</span>
              <span className="tabular-nums">{kes(result.variance)}</span>
            </div>
            <Button size="lg" onClick={() => setResult(null)}>
              Done
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between rounded-lg bg-muted p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
