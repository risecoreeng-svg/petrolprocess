"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { KIND_LABEL, type DeleteKind } from "@/lib/delete-rules";
import { errorMessage, formatDate, formatDateTime } from "@/lib/utils";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type DeletedRow = {
  kind: DeleteKind;
  id: string;
  date: string;
  created_at: string;
  created_by: string | null;
  deleted_at: string;
  deleted_by: string | null;
  delete_reason: string | null;
  delete_note: string | null;
  title: string;
  /** Base currency; null when the viewer may not see it (a delivery's cost for a sales manager) */
  amount: number | null;
  litres: number | null;
  /** Deleted together with its trip: restore the trip instead */
  linked: boolean;
};

export function DeletedClient({
  rows,
  staff,
  isOwner,
  filter,
  unavailable,
}: {
  rows: DeletedRow[];
  staff: { id: string; full_name: string }[];
  isOwner: boolean;
  filter: { kind: string; from: string; to: string };
  unavailable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { money } = useMoney();
  const [restoring, setRestoring] = useState<DeletedRow | null>(null);
  const who = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.full_name ?? "Someone") : "System");
  const kinds = (Object.keys(KIND_LABEL) as DeleteKind[]).filter((k) => isOwner || ["purchase", "sale", "expense", "credit_payment"].includes(k));

  function setFilter(patch: Partial<typeof filter>) {
    const params = new URLSearchParams({ ...filter, ...patch });
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  if (unavailable) {
    return (
      <p className="rounded-[var(--radius-tile)] border border-dashed border-line-strong bg-surface/60 p-5 text-[15px] text-muted">
        This page needs the latest database update. Ask the owner to apply it, then reload.
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,11rem)_minmax(0,11rem)]">
        <Select className="col-span-2 sm:col-span-1" aria-label="Type" value={filter.kind} onChange={(e) => setFilter({ kind: e.target.value })}>
          <option value="">Everything</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label="Deleted from" value={filter.from} onChange={(e) => setFilter({ from: e.target.value })} />
        <Input type="date" aria-label="Deleted until" value={filter.to} onChange={(e) => setFilter({ to: e.target.value })} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Trash2 />} title="Nothing deleted" description={filter.kind || filter.from || filter.to ? "Nothing matches these filters." : "Deleted records will show up here."} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Type</TH>
              <TH>What it was</TH>
              <TH className="text-right">Amount</TH>
              <TH>Entered</TH>
              <TH>Deleted</TH>
              <TH>Reason</TH>
              {isOwner ? <TH /> : null}
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.kind}-${r.id}`}>
                <TD>
                  <Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge>
                </TD>
                <TD className="min-w-56 whitespace-normal">
                  <p className="font-medium">{r.title}</p>
                  <p className="text-[13px] text-muted">Dated {formatDate(r.date)}</p>
                </TD>
                <TD className="text-right tabular-nums">{r.amount === null ? <span className="text-muted">—</span> : money(r.amount)}</TD>
                <TD className="text-[14px]">
                  {who(r.created_by)}
                  <span className="block text-[13px] text-muted">{formatDateTime(r.created_at)}</span>
                </TD>
                <TD className="text-[14px]">
                  {who(r.deleted_by)}
                  <span className="block text-[13px] text-muted">{formatDateTime(r.deleted_at)}</span>
                </TD>
                <TD className="max-w-64 whitespace-normal text-[14px]">
                  {r.delete_reason ?? "—"}
                  {r.delete_note ? <span className="block text-[13px] text-muted">{r.delete_note}</span> : null}
                  {isOwner && r.delete_reason === "Wrong amount" && (r.kind === "expense" || r.kind === "purchase") ? (
                    <span className="block text-[13px] text-muted">Tip: restore it and edit the amount, so its history stays in one place.</span>
                  ) : null}
                </TD>
                {isOwner ? (
                  <TD className="py-2">
                    {r.linked ? (
                      <span className="text-[13px] text-muted">{r.kind === "trip_line" ? "Restore its trip first" : "Restore the trip instead"}</span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setRestoring(r)}>
                        <RotateCcw /> Restore
                      </Button>
                    )}
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {restoring ? <RestoreDialog row={restoring} onClose={() => setRestoring(null)} /> : null}
    </>
  );
}

const RESTORE_EFFECT: Record<DeleteKind, string> = {
  purchase: "Its litres go back into the tank and its cost back into the tank's average cost. The tank must have room for it.",
  sale: "Its litres come out of the tank again and, for a credit sale, the customer owes it again. There must be enough fuel in the tank and room under their credit limit.",
  expense: "It counts in your expenses and net profit again.",
  credit_payment: "It comes off what the customer owes again. They must still owe at least this much.",
  trip: "It counts in your reports again, with any fuel it delivered back in the tank.",
  trip_line: "It counts on its trip again.",
  truck_expense: "It counts in your truck costs and net profit again.",
};

function RestoreDialog({ row, onClose }: { row: DeletedRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function onRestore() {
    setPending(true);
    const { error } = await createClient().rpc("restore_record", { p_kind: row.kind, p_id: row.id });
    setPending(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Restored");
    onClose();
    router.refresh();
  }
  return (
    <Modal open onClose={onClose} title="Restore this record?">
      <div className="space-y-4">
        <p className="font-medium">{row.title}</p>
        <p className="text-[15px]">{RESTORE_EFFECT[row.kind]}</p>
        <p className="text-[13px] text-muted">If something has changed since it was deleted and it can&apos;t be restored, you&apos;ll be told why.</p>
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onRestore} disabled={pending}>
            <RotateCcw /> {pending ? "Restoring…" : "Restore"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
