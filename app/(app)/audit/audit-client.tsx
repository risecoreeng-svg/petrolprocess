"use client";

import { Fragment, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ScrollText } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { labelize } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type AuditRow = {
  id: string;
  user_id: string | null;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "SOFT_DELETE" | "RESTORE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

const TABLES = [
  "sales",
  "purchases",
  "expenses",
  "credit_payments",
  "stock_adjustments",
  "shifts",
  "customers",
  "tanks",
  "fuel_types",
  "trucks",
  "drivers",
  "suppliers",
  "profiles",
];
const ACTION_VARIANT = { INSERT: "default", UPDATE: "info", SOFT_DELETE: "destructive", RESTORE: "warning" } as const;
const IGNORED = new Set(["updated_at"]);

function changes(row: AuditRow) {
  if (row.action === "INSERT" || !row.old_data || !row.new_data) return [];
  return Object.keys(row.new_data)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(row.old_data![k]) !== JSON.stringify(row.new_data![k]))
    .map((k) => ({ field: k, from: row.old_data![k], to: row.new_data![k] }));
}

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function AuditClient({
  rows,
  staff,
  filter,
  page,
  pages,
  total,
}: {
  rows: AuditRow[];
  staff: { id: string; full_name: string }[];
  filter: { table: string; action: string; user: string };
  page: number;
  pages: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const who = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? "Unknown user" : "System");

  function go(patch: Record<string, string>) {
    const params = new URLSearchParams({ ...filter, page: "1", ...patch });
    for (const [k, v] of [...params.entries()]) if (!v || (k === "page" && v === "1")) params.delete(k);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  return (
    <>
      <PageHeader title="Audit log" description={`${total} entries · every change, who made it and when`} />
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select aria-label="Table" value={filter.table} onChange={(e) => go({ table: e.target.value })}>
          <option value="">All tables</option>
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {labelize(t)}
            </option>
          ))}
        </Select>
        <Select aria-label="Action" value={filter.action} onChange={(e) => go({ action: e.target.value })}>
          <option value="">All actions</option>
          <option value="INSERT">Created</option>
          <option value="UPDATE">Edited</option>
          <option value="SOFT_DELETE">Voided / deleted</option>
        </Select>
        <Select aria-label="User" value={filter.user} onChange={(e) => go({ user: e.target.value })}>
          <option value="">All users</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No matching entries" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>Table</TH>
              <TH>Action</TH>
              <TH>Changes</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const diff = changes(r);
              return (
                <Fragment key={r.id}>
                  <TR className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <TD>{formatDateTime(r.created_at)}</TD>
                    <TD>{who(r.user_id)}</TD>
                    <TD>{labelize(r.table_name)}</TD>
                    <TD>
                      <Badge variant={ACTION_VARIANT[r.action]}>{labelize(r.action.toLowerCase())}</Badge>
                    </TD>
                    <TD className="max-w-80 truncate text-muted-foreground">
                      {r.action === "INSERT"
                        ? "New record"
                        : diff.map((d) => `${d.field}: ${show(d.from)} → ${show(d.to)}`).join(", ") || "No field changes"}
                    </TD>
                  </TR>
                  {open === r.id ? (
                    <tr>
                      <td colSpan={5} className="bg-muted/40 p-3">
                        <div className="grid gap-3 text-xs md:grid-cols-2">
                          <div>
                            <p className="mb-1 font-semibold">Before</p>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-card p-2">
                              {r.old_data ? JSON.stringify(r.old_data, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 font-semibold">After</p>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-card p-2">
                              {r.new_data ? JSON.stringify(r.new_data, null, 2) : "—"}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      )}

      <div className="mt-3 flex items-center justify-between text-sm">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
          Previous
        </Button>
        <span className="text-muted-foreground">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>
          Next
        </Button>
      </div>
    </>
  );
}
