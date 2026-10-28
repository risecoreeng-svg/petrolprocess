"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { cn, downloadFile, formatDate, num, toCsv } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { useMoney } from "@/components/money-provider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type Column = { key: string; label: string; type: "text" | "date" | "number" | "money" };
export type Report = {
  key: string;
  title: string;
  note?: string;
  columns: readonly Column[];
  /** Money values are in base currency */
  rows: Record<string, string | number>[];
  emphasise?: string[];
};

type Display = { code: string; rate: number };

const isNumeric = (c: Column) => c.type === "money" || c.type === "number";

export function ReportsClient({
  reports,
  period,
  fileSuffix,
  display,
}: {
  reports: Report[];
  period: string;
  fileSuffix: string;
  /** Currency to show amounts in, and its rate per 1 base unit (1 for base) */
  display: Display;
}) {
  const { base } = useMoney();
  const [active, setActive] = useState(reports[0].key);
  const report = reports.find((r) => r.key === active)!;
  const numeric = report.columns.filter(isNumeric);
  const showTotals = report.key !== "pl" && report.rows.length > 1;
  const totals = Object.fromEntries(
    numeric.map((c) => [c.key, report.rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0)]),
  );
  // Averages don't sum meaningfully.
  for (const k of ["avg_price", "margin_per_litre"]) delete totals[k];

  const fmtIn = (d: Display) => (value: string | number | undefined, type: Column["type"]) => {
    if (value === undefined || value === null) return "";
    if (type === "money") return formatMoney(Number(value) * d.rate, d.code);
    if (type === "number") return num(value);
    if (type === "date") return formatDate(String(value));
    return String(value);
  };
  const fmt = fmtIn(display);
  const baseDisplay: Display = { code: base, rate: 1 };

  function exportCsv(d: Display) {
    const rows = report.rows.map((r) =>
      Object.fromEntries(
        report.columns.map((c) => [
          c.type === "money" ? `${c.label || c.key} (${d.code})` : c.label || c.key,
          c.type === "money" ? Math.round(Number(r[c.key] ?? 0) * d.rate * 100) / 100 : r[c.key],
        ]),
      ),
    );
    downloadFile(`petrotrack_${report.key}_${fileSuffix}_${d.code}.csv`, toCsv(rows));
  }

  async function exportPdf(d: Display) {
    const f = fmtIn(d);
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const doc = new jsPDF({ orientation: report.columns.length > 6 ? "landscape" : "portrait" });
    doc.setFontSize(14);
    doc.text(`PetroTrack - ${report.title}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`${period} · amounts in ${d.code}${d.code !== base ? " (converted at today's rate)" : ""}`, 14, 22);
    const body = report.rows.map((r) => report.columns.map((c) => f(r[c.key], c.type)));
    if (showTotals) body.push(report.columns.map((c, i) => (i === 0 ? "Total" : c.key in totals ? f(totals[c.key], c.type) : "")));
    autoTable(doc, {
      startY: 27,
      head: [report.columns.map((c) => c.label)],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 30, 28] },
      columnStyles: Object.fromEntries(report.columns.map((c, i) => [i, { halign: isNumeric(c) ? "right" : "left" }])),
    });
    if (report.note) doc.text(report.note, 14, doc.internal.pageSize.getHeight() - 10);
    doc.save(`petrotrack_${report.key}_${fileSuffix}_${d.code}.pdf`);
  }

  return (
    <>
      <div className="seg no-scrollbar mb-5 w-fit max-w-full overflow-x-auto">
        {reports.map((r) => (
          <button
            key={r.key}
            onClick={() => setActive(r.key)}
            className={cn(
              active === r.key && "on",
            )}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">{report.title}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCsv(display)} disabled={report.rows.length === 0}>
            <Download /> CSV{display.code !== base ? ` (${display.code})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportPdf(display)} disabled={report.rows.length === 0}>
            <FileText /> PDF{display.code !== base ? ` (${display.code})` : ""}
          </Button>
          {display.code !== base ? (
            <>
              <Button variant="outline" size="sm" onClick={() => exportCsv(baseDisplay)} disabled={report.rows.length === 0}>
                <Download /> CSV ({base})
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportPdf(baseDisplay)} disabled={report.rows.length === 0}>
                <FileText /> PDF ({base})
              </Button>
            </>
          ) : null}
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
                <TH key={c.key} className={cn((isNumeric(c)) && "text-right")}>
                  {c.label}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {report.rows.map((r, i) => {
              const strong = report.emphasise?.includes(String(r.line));
              return (
                <TR key={i} className={cn(strong && "bg-surface-2 font-semibold")}>
                  {report.columns.map((c) => (
                    <TD
                      key={c.key}
                      className={cn(
                        (isNumeric(c)) && "text-right tabular-nums",
                        c.type === "money" && Number(r[c.key]) < 0 && "text-orange",
                      )}
                    >
                      {fmt(r[c.key], c.type)}
                    </TD>
                  ))}
                </TR>
              );
            })}
            {showTotals ? (
              <TR className="bg-surface-2 font-semibold">
                {report.columns.map((c, i) => (
                  <TD key={c.key} className={cn((isNumeric(c)) && "text-right tabular-nums")}>
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
