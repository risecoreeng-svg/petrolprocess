"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { cn, downloadFile, formatDate, kes, num, toCsv } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type Column = { key: string; label: string; type: "text" | "date" | "number" | "kes" };
export type Report = {
  key: string;
  title: string;
  note?: string;
  columns: readonly Column[];
  rows: Record<string, string | number>[];
  emphasise?: string[];
};

function fmt(value: string | number | undefined, type: Column["type"]) {
  if (value === undefined || value === null) return "";
  if (type === "kes") return kes(value);
  if (type === "number") return num(value);
  if (type === "date") return formatDate(String(value));
  return String(value);
}

export function ReportsClient({ reports, period, fileSuffix }: { reports: Report[]; period: string; fileSuffix: string }) {
  const [active, setActive] = useState(reports[0].key);
  const report = reports.find((r) => r.key === active)!;
  const numeric = report.columns.filter((c) => c.type === "kes" || c.type === "number");
  const showTotals = report.key !== "pl" && report.rows.length > 1;
  const totals = Object.fromEntries(
    numeric.map((c) => [c.key, report.rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0)]),
  );
  // Averages don't sum meaningfully.
  for (const k of ["avg_price", "margin_per_litre"]) delete totals[k];

  function exportCsv() {
    const rows = report.rows.map((r) => Object.fromEntries(report.columns.map((c) => [c.label || c.key, r[c.key]])));
    downloadFile(`petrotrack_${report.key}_${fileSuffix}.csv`, toCsv(rows));
  }

  async function exportPdf() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const doc = new jsPDF({ orientation: report.columns.length > 6 ? "landscape" : "portrait" });
    doc.setFontSize(14);
    doc.text(`PetroTrack - ${report.title}`, 14, 16);
    doc.setFontSize(10);
    doc.text(period, 14, 22);
    const body = report.rows.map((r) => report.columns.map((c) => fmt(r[c.key], c.type)));
    if (showTotals) body.push(report.columns.map((c, i) => (i === 0 ? "Total" : c.key in totals ? fmt(totals[c.key], c.type) : "")));
    autoTable(doc, {
      startY: 27,
      head: [report.columns.map((c) => c.label)],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [31, 41, 55] },
      columnStyles: Object.fromEntries(
        report.columns.map((c, i) => [i, { halign: c.type === "kes" || c.type === "number" ? "right" : "left" }]),
      ),
    });
    if (report.note) doc.text(report.note, 14, doc.internal.pageSize.getHeight() - 10);
    doc.save(`petrotrack_${report.key}_${fileSuffix}.pdf`);
  }

  return (
    <>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {reports.map((r) => (
          <button
            key={r.key}
            onClick={() => setActive(r.key)}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-sm",
              active === r.key ? "bg-card font-medium shadow-xs" : "text-muted-foreground",
            )}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{report.title}</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={report.rows.length === 0}>
            <Download /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={report.rows.length === 0}>
            <FileText /> PDF
          </Button>
        </div>
      </div>
      {report.note ? <p className="mb-2 text-xs text-muted-foreground">{report.note}</p> : null}

      {report.rows.length === 0 ? (
        <EmptyState title="No data for this period" description="Try a wider date range." />
      ) : (
        <Table>
          <THead>
            <tr>
              {report.columns.map((c) => (
                <TH key={c.key} className={cn((c.type === "kes" || c.type === "number") && "text-right")}>
                  {c.label}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {report.rows.map((r, i) => {
              const strong = report.emphasise?.includes(String(r.line));
              return (
                <TR key={i} className={cn(strong && "bg-muted/50 font-semibold")}>
                  {report.columns.map((c) => (
                    <TD
                      key={c.key}
                      className={cn(
                        (c.type === "kes" || c.type === "number") && "text-right tabular-nums",
                        c.type === "kes" && Number(r[c.key]) < 0 && "text-destructive",
                      )}
                    >
                      {fmt(r[c.key], c.type)}
                    </TD>
                  ))}
                </TR>
              );
            })}
            {showTotals ? (
              <TR className="bg-muted/60 font-semibold">
                {report.columns.map((c, i) => (
                  <TD key={c.key} className={cn((c.type === "kes" || c.type === "number") && "text-right tabular-nums")}>
                    {i === 0 ? "Total" : c.key in totals ? fmt(totals[c.key], c.type) : ""}
                  </TD>
                ))}
              </TR>
            ) : null}
          </TBody>
        </Table>
      )}
    </>
  );
}
