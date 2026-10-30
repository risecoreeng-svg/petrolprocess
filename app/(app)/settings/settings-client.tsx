"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { toNum, useSubmit } from "@/lib/use-submit";
import { cn, errorMessage, formatDate } from "@/lib/utils";
import { describeRate, type RateInfo } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type RateRow = { id: string; currency: string; per_base: number; effective_date: string; is_placeholder: boolean };

const rateSchema = z.object({ per_base: z.number({ error: "Enter the rate" }).positive("Must be more than 0") });

export function SettingsClient({
  base,
  enabled,
  rates,
  currencies,
  history,
  baseLocked,
  tolerance,
  deleteWindow,
}: {
  base: string;
  enabled: string[];
  rates: Record<string, RateInfo>;
  currencies: { code: string; name: string }[];
  history: RateRow[];
  baseLocked: boolean;
  tolerance: number;
  deleteWindow: number;
}) {
  const router = useRouter();
  const [baseCode, setBaseCode] = useState(base);
  const [on, setOn] = useState<string[]>(enabled);
  const [saving, setSaving] = useState(false);
  const foreign = enabled.filter((c) => c !== base);

  async function saveCurrencies() {
    const list = Array.from(new Set([baseCode, ...on]));
    setSaving(true);
    const { error } = await createClient()
      .from("organizations")
      .update({ base_currency: baseCode, enabled_currencies: list })
      .not("id", "is", null);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Currency settings saved");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Today&apos;s exchange rates
            <InfoTip>
              Type the rate you actually use, official or market. Each sale, delivery and expense keeps the rate from
              the moment it was recorded, so changing the rate never changes old figures.
            </InfoTip>
          </CardTitle>
          <CardDescription>Your reports are kept in {base}. Update these whenever the rate moves (at least daily).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {foreign.length === 0 ? (
            <p className="text-[15px] text-muted">Only {base} is turned on. Turn on another currency below to set its rate.</p>
          ) : (
            foreign.map((code) => <RateForm key={code} base={base} code={code} current={rates[code]} />)
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Currencies</CardTitle>
          <CardDescription>Which money you accept, and which one your reports are kept in.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field
            label="Report in (base currency)"
            htmlFor="base"
            hint={baseLocked ? "Locked because money has already been recorded in it." : "Profit, stock value and balances are kept in this currency."}
          >
            <Select id="base" value={baseCode} disabled={baseLocked} onChange={(e) => setBaseCode(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Accept payments in</legend>
            {currencies.map((c) => {
              const checked = on.includes(c.code) || c.code === baseCode;
              return (
                <label
                  key={c.code}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-inner)] bg-surface-3 px-4 shadow-[var(--shadow-soft)]",
                    c.code === baseCode && "opacity-70",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-5 accent-black"
                    checked={checked}
                    disabled={c.code === baseCode}
                    onChange={(e) => setOn(e.target.checked ? [...on, c.code] : on.filter((x) => x !== c.code))}
                  />
                  <span className="font-medium">{c.code}</span>
                  <span className="text-muted">{c.name}</span>
                </label>
              );
            })}
          </fieldset>
          <Button onClick={saveCurrencies} disabled={saving}>
            Save currencies
          </Button>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Fuel shortage tolerance
            <InfoTip>When a truck delivers fewer litres than it loaded by more than this %, the trip is flagged Disputed as a possible loss or theft.</InfoTip>
          </CardTitle>
          <CardDescription>For fuel your trucks carry.</CardDescription>
        </CardHeader>
        <CardContent>
          <ToleranceForm current={tolerance} />
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Deleting mistakes
            <InfoTip>
              Sales managers and fleet managers can delete or edit only what they entered themselves, and only for this many hours. You can
              always delete, edit and restore anything.
            </InfoTip>
          </CardTitle>
          <CardDescription>How long staff can fix their own entries.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteWindowForm current={deleteWindow} />
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <h2 className="card-title mb-3">Rate history</h2>
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Rate</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {history.map((r) => (
              <TR key={r.id}>
                <TD>{r.is_placeholder ? "—" : formatDate(r.effective_date)}</TD>
                <TD>{describeRate(base, r.currency, Number(r.per_base))}</TD>
                <TD>{r.is_placeholder ? <Badge variant="warning">Example rate, update me</Badge> : null}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function RateForm({ base, code, current }: { base: string; code: string; current?: RateInfo }) {
  const { submit, pending, errors } = useSubmit();
  const [value, setValue] = useState(current && !current.placeholder ? String(current.perBase) : "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(
      rateSchema,
      { per_base: toNum(value) },
      (d) => createClient().rpc("set_exchange_rate", { p_currency: code, p_per_base: d.per_base }),
      `${code} rate saved for today`,
    );
  }

  return (
    <form onSubmit={onSubmit} className="inner-box grid gap-3" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{code}</span>
        {current ? (
          current.placeholder ? (
            <Badge variant="warning">Example rate, update me</Badge>
          ) : current.stale ? (
            <Badge variant="warning">Last set {formatDate(current.date)}</Badge>
          ) : (
            <Badge>Up to date</Badge>
          )
        ) : (
          <Badge variant="destructive">No rate yet</Badge>
        )}
      </div>
      <Field label={`How many ${code} for 1 ${base}?`} htmlFor={`rate-${code}`} error={errors.per_base}>
        <div className="flex gap-2">
          <Input
            id={`rate-${code}`}
            inputMode="decimal"
            placeholder={current ? String(current.perBase) : "0"}
            className="min-w-0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" disabled={pending} className="h-12 shrink-0">
            Save
          </Button>
        </div>
      </Field>
      {current ? <p className="text-[13px] text-muted">Now: {describeRate(base, code, current.perBase)}</p> : null}
    </form>
  );
}

function ToleranceForm({ current }: { current: number }) {
  const { submit, pending, errors } = useSubmit();
  const [value, setValue] = useState(String(current));
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(
      z.object({ pct: z.number({ error: "Enter a %" }).min(0, "0 or more").max(100, "At most 100") }),
      { pct: toNum(value) },
      (d) => createClient().from("organizations").update({ haulage_tolerance_pct: d.pct }).not("id", "is", null),
      "Tolerance saved",
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2" noValidate>
      <Field label="Allowed shortage (%)" htmlFor="tol" error={errors.pct} className="flex-1">
        <Input id="tol" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0" />
      </Field>
      <Button type="submit" disabled={pending} className="h-12">
        Save
      </Button>
    </form>
  );
}

function DeleteWindowForm({ current }: { current: number }) {
  const { submit, pending, errors } = useSubmit();
  const [value, setValue] = useState(String(current));
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit(
      z.object({ hours: z.number({ error: "Enter the hours" }).int("Whole hours").min(0, "0 or more").max(168, "At most 168 (a week)") }),
      { hours: toNum(value) },
      (d) => createClient().from("organizations").update({ delete_window_hours: d.hours }).not("id", "is", null),
      "Saved",
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2" noValidate>
      <Field label="Hours after entering" htmlFor="delwin" error={errors.hours} hint="0 means only you can delete." className="flex-1">
        <Input id="delwin" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0" />
      </Field>
      <Button type="submit" disabled={pending} className="h-12">
        Save
      </Button>
    </form>
  );
}
