import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowUpRight, CalendarClock, Check, Droplets, FileBadge, HandCoins, IdCard, Wrench } from "lucide-react";
import { getFleetAlerts } from "@/lib/fleet-attention";
import { cn } from "@/lib/utils";
import { getProfile } from "@/lib/auth";
import { homeFor } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { eachDay, pctChange, previousRange, resolveRange } from "@/lib/range";
import { formatDate, litres, nairobiToday, num } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import type { Tank } from "@/lib/types";
import { DateRangeFilter } from "@/components/date-range-filter";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { displayCurrency, getMoneyContext } from "@/lib/money-server";
import { SalesExpensesChart } from "@/components/sales-expenses-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Badge, Progress, StatCard } from "@/components/ui/misc";

type Day = { date: string; sales: number; litres?: number; cost_of_fuel?: number; gross_profit?: number; expenses?: number; net_profit?: number };

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "numeric", hour12: false }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; cur?: string; view?: string }>;
}) {
  const profile = await getProfile();
  if (profile.role === "attendant" || profile.role === "driver") redirect(homeFor(profile.role));
  const isOwner = profile.role === "owner";
  const isFleet = profile.role === "fleet_manager";
  const sp = await searchParams;
  // Owner sees the fuel depot, the trucks, or both together.
  const view = isOwner && (sp.view === "depot" || sp.view === "trucks") ? sp.view : "combined";
  const { range, from, to } = resolveRange(sp);
  // Everything is stored in base currency; the switcher converts at today's rate for display.
  const disp = displayCurrency(await getMoneyContext(), sp.cur);
  const money = (v: number | string | null | undefined) => formatMoney(Number(v ?? 0) * disp.rate, disp.code);
  const prev = previousRange(range, from, to);
  const supabase = await createClient();

  const [summaryRes, expensesRes, { data: trucks }, { data: tanks }, { data: fuelTypes }, { data: balances }, stockRes] =
    await Promise.all([
      // Owner: full P&L per day. Manager: sales only (no cost or profit columns).
      isOwner
        ? supabase.from("daily_summary").select("date, sales, litres, cost_of_fuel, gross_profit, expenses, net_profit").gte("date", prev.from).lte("date", to)
        : supabase.from("daily_sales_summary").select("date, sales, litres").gte("date", prev.from).lte("date", to),
      isOwner
        ? Promise.resolve({ data: null })
        : supabase.from("expenses").select("date, amount").is("deleted_at", null).gte("date", prev.from).lte("date", to),
      supabase.from("trucks").select("id, plate_number, status, notes, odometer_km").is("deleted_at", null).order("plate_number"),
      supabase.from("tanks").select("*").is("deleted_at", null).order("name"),
      supabase.from("fuel_types").select("id, name"),
      supabase.from("customer_balances").select("customer_id, name, phone, balance, overdue").order("balance", { ascending: false }),
      isOwner ? supabase.from("stock_value").select("value") : Promise.resolve({ data: null }),
    ]);

  const today = nairobiToday();
  const [{ data: dueSales }, setup, truckDaysRes, fleetAlerts, fleetTrips, tripOwedRes] = await Promise.all([
    supabase
      .from("sales_safe")
      .select("id, fuel_type_id, litres, delivery_date, customer_id")
      .eq("delivery_status", "scheduled")
      .lte("delivery_date", today)
      .order("delivery_date")
      .limit(20),
    // First-run checklist (owner only): what has been set up so far
    isOwner
      ? Promise.all([
          supabase.from("purchases").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("sales_safe").select("id", { count: "exact", head: true }),
        ])
      : Promise.resolve(null),
    // Trucks P&L per day (owner only)
    isOwner
      ? supabase.from("truck_daily_summary").select("date, income, trip_expenses, payouts, truck_expenses, net_profit").gte("date", prev.from).lte("date", to)
      : Promise.resolve({ data: null }),
    getFleetAlerts(),
    isFleet ? supabase.from("trips").select("status, date, delivered_at, litres_delivered, cargo_type").is("deleted_at", null) : Promise.resolve({ data: null }),
    isOwner || isFleet ? supabase.from("trip_client_balances").select("owed, overdue") : Promise.resolve({ data: null }),
  ]);

  const days = (summaryRes.data ?? []) as Day[];
  const expByDay: Record<string, number> = {};
  if (isOwner) for (const d of days) expByDay[d.date] = Number(d.expenses ?? 0);
  else for (const e of expensesRes.data ?? []) expByDay[e.date] = (expByDay[e.date] ?? 0) + Number(e.amount);

  const inRange = (d: string, a: string, b: string) => d >= a && d <= b;
  const total = (k: keyof Day, a: string, b: string) => days.filter((d) => inRange(d.date, a, b)).reduce((s, d) => s + Number(d[k] ?? 0), 0);
  const expTotal = (a: string, b: string) => Object.entries(expByDay).filter(([d]) => inRange(d, a, b)).reduce((s, [, v]) => s + v, 0);

  const now = { sales: total("sales", from, to), litres: total("litres", from, to), profit: total("gross_profit", from, to), net: total("net_profit", from, to), cogs: total("cost_of_fuel", from, to), expenses: expTotal(from, to) };
  const before = { sales: total("sales", prev.from, prev.to), litres: total("litres", prev.from, prev.to), profit: total("gross_profit", prev.from, prev.to), net: total("net_profit", prev.from, prev.to), expenses: expTotal(prev.from, prev.to) };

  type TDay = { date: string; income: number; trip_expenses: number; payouts: number; truck_expenses: number; net_profit: number };
  const tdays = (truckDaysRes.data ?? []) as TDay[];
  const tsum = (k: keyof TDay, a: string, b: string) => tdays.filter((d) => inRange(d.date, a, b)).reduce((x, d) => x + Number(d[k] ?? 0), 0);
  const trucksFor = (a: string, b: string) => ({
    sales: tsum("income", a, b),
    profit: tsum("income", a, b) - tsum("trip_expenses", a, b) - tsum("payouts", a, b),
    expenses: tsum("truck_expenses", a, b),
    net: tsum("net_profit", a, b),
  });
  if (isOwner && view !== "depot") {
    const tn = trucksFor(from, to);
    const tb = trucksFor(prev.from, prev.to);
    const keep = view === "combined" ? 1 : 0;
    for (const [target, add] of [
      [now, tn],
      [before, tb],
    ] as const) {
      target.sales = target.sales * keep + add.sales;
      target.profit = target.profit * keep + add.profit;
      target.expenses = target.expenses * keep + add.expenses;
      target.net = target.net * keep + add.net;
    }
  }
  const truckOutByDay: Record<string, number> = {};
  const truckInByDay: Record<string, number> = {};
  for (const d of tdays) {
    truckInByDay[d.date] = Number(d.income);
    truckOutByDay[d.date] = Number(d.trip_expenses) + Number(d.payouts) + Number(d.truck_expenses);
  }
  const salesByDay = Object.fromEntries(days.map((d) => [d.date, Number(d.sales)]));
  const depotIn = view !== "trucks";
  const trucksIn = isOwner && view !== "depot";
  const chart = eachDay(from, to).map((date) => ({
    date,
    sales: ((depotIn ? salesByDay[date] ?? 0 : 0) + (trucksIn ? truckInByDay[date] ?? 0 : 0)) * disp.rate,
    expenses: ((depotIn ? expByDay[date] ?? 0 : 0) + (trucksIn ? truckOutByDay[date] ?? 0 : 0)) * disp.rate,
  }));
  // Fleet manager numbers (no money beyond what clients owe)
  const ft = (fleetTrips.data ?? []) as { status: string; date: string; delivered_at: string | null; litres_delivered: number | null; cargo_type: string }[];
  const deliveredIn = ft.filter((t) => t.status === "delivered" && t.delivered_at && inRange(t.delivered_at.slice(0, 10), from, to));
  const fleet = {
    onRoad: ft.filter((t) => t.status === "on_road").length,
    planned: ft.filter((t) => t.status === "planned").length,
    delivered: deliveredIn.length,
    litres: deliveredIn.filter((t) => t.cargo_type === "fuel").reduce((x, t) => x + Number(t.litres_delivered ?? 0), 0),
  };
  const tripOwed = (tripOwedRes.data ?? []).reduce((x, b) => x + Math.max(0, Number(b.owed)), 0);
  const tripOverdue = (tripOwedRes.data ?? []).reduce((x, b) => x + Number(b.overdue), 0);

  const allTrucks = trucks ?? [];
  const activeTrucks = allTrucks.filter((t) => t.status === "active").length;
  const onTrip = allTrucks.filter((t) => t.status === "on_trip").length;
  const inMaintenance = allTrucks.filter((t) => t.status === "maintenance");
  const allTanks = (tanks ?? []) as Tank[];
  const lowTanks = allTanks.filter((t) => Number(t.current_litres) <= Number(t.low_stock_level));
  const fuelName = (id: string) => fuelTypes?.find((f) => f.id === id)?.name ?? "";
  const owing = (balances ?? []).filter((b) => Number(b.balance) > 0);
  const owed = owing.reduce((s, b) => s + Number(b.balance), 0);
  const overdueCustomers = (balances ?? []).filter((b) => Number(b.overdue) > 0);
  const overdue = overdueCustomers.reduce((s, b) => s + Number(b.overdue), 0);
  const stockValue = (stockRes.data ?? []).reduce((s, v) => s + Number(v.value), 0);

  const customerName = (id: string | null) => (balances ?? []).find((b) => b.customer_id === id)?.name;
  const attention = [
    ...(dueSales ?? []).map((d) => ({
      key: `due-${d.id}`,
      icon: <CalendarClock className="size-[18px]" />,
      tone: d.delivery_date < today ? "bg-orange text-white" : "bg-yellow text-[#1c1c1a]",
      title: `${d.delivery_date < today ? "Late delivery" : "Deliver today"}: ${num(d.litres)} L ${fuelName(d.fuel_type_id)}`,
      sub: `${customerName(d.customer_id) ?? "Walk-in customer"} · due ${formatDate(d.delivery_date)}`,
      action: { href: "/sales", label: "Open deliveries" },
    })),
    ...lowTanks.map((t) => ({
      key: `tank-${t.id}`,
      icon: <Droplets className="size-[18px]" />,
      tone: "bg-yellow text-[#1c1c1a]",
      title: Number(t.current_litres) <= 0 ? `${t.name} is empty` : `${t.name} is running low`,
      sub: `${litres(t.current_litres)} of ${fuelName(t.fuel_type_id)} left · alert at ${litres(t.low_stock_level)}`,
      action: { href: "/purchases", label: "Record delivery" },
    })),
    ...overdueCustomers.map((c) => ({
      key: `cust-${c.customer_id}`,
      icon: <HandCoins className="size-[18px]" />,
      tone: "bg-orange text-white",
      title: `${c.name} is late paying`,
      sub: `${money(c.overdue)} overdue · owes ${money(c.balance)} in total`,
      action: { href: "/customers", label: "Record payment" },
    })),
    ...fleetAlerts.map((a) => ({
      key: a.key,
      icon: a.kind === "service" ? <Wrench className="size-[18px]" /> : a.kind === "licence" ? <IdCard className="size-[18px]" /> : <FileBadge className="size-[18px]" />,
      tone: a.severity === "expired" ? "bg-orange text-white" : "bg-yellow text-[#1c1c1a]",
      title: a.title,
      sub: a.sub,
      action: { href: a.href, label: a.action },
    })),
    ...(tripOverdue > 0.005
      ? [
          {
            key: "trip-overdue",
            icon: <HandCoins className="size-[18px]" />,
            tone: "bg-orange text-white",
            title: "Trip clients are late paying",
            sub: `${money(tripOverdue)} overdue for delivered trips`,
            action: { href: "/trip-clients", label: "See who" },
          },
        ]
      : []),
    ...inMaintenance.map((t) => ({
      key: `truck-${t.id}`,
      icon: <Wrench className="size-[18px]" />,
      tone: "bg-surface-2 text-fg",
      title: `${t.plate_number} is in the garage`,
      sub: t.notes ? t.notes : "Marked as in maintenance",
      action: { href: `/trucks/${t.id}`, label: "View truck" },
    })),
  ];

  const firstName = profile.full_name.split(" ")[0];
  const periodLabel = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  return (
    <>
      <div className="mb-5 nav:mb-7">
        <h1 className="page-title">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">Here&apos;s how {profile.org_name || "your business"} is doing · {periodLabel}</p>
      </div>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Suspense>
          <DateRangeFilter range={range} from={from} to={to} />
          <CurrencySwitcher current={disp.code} />
        </Suspense>
      </div>

      {isOwner ? (
        <div className="seg mb-5 w-fit" role="tablist" aria-label="Show">
          {(["combined", "depot", "trucks"] as const).map((v) => {
            const q = new URLSearchParams(Object.entries(sp).filter(([, x]) => typeof x === "string") as [string, string][]);
            if (v === "combined") q.delete("view");
            else q.set("view", v);
            return (
              <Link key={v} href={`/?${q}`} scroll={false} role="tab" aria-selected={view === v} className={cn(view === v && "on")}>
                {v === "combined" ? "Combined" : v === "depot" ? "Depot" : "Trucks"}
              </Link>
            );
          })}
        </div>
      ) : null}

      {setup ? <SetupChecklist steps={[
        { done: allTanks.length > 0, label: "Add your fuel and a tank", href: "/purchases", hint: "Petrol, Diesel and Kerosene are ready; a tank is created the first time you add stock." },
        { done: (setup[0].count ?? 0) > 0, label: "Add stock", href: "/purchases", hint: "Record the fuel that arrived and its selling price." },
        { done: (setup[1].count ?? 0) > 1, label: "Add your staff", href: "/users", hint: "Give attendants and sales managers their own login." },
        { done: (setup[2].count ?? 0) > 0, label: "Record your first sale", href: "/sales", hint: "Sell fuel from the Sales screen." },
      ]} /> : null}

      {/* Headline numbers */}
      {isFleet ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="On the road" caption="Trips under way now" value={String(fleet.onRoad)} />
          <StatCard label="Planned" caption="Trips not started yet" value={String(fleet.planned)} />
          <StatCard label="Delivered" caption="Trips finished in this period" value={String(fleet.delivered)} />
          <StatCard label="Fuel hauled" caption="Litres delivered in this period" value={litres(fleet.litres)} />
        </div>
      ) : (
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={view === "trucks" ? "Trip income" : "Sales"}
          caption={view === "depot" ? "Money in from fuel sold" : view === "trucks" ? "Money in from trips delivered" : "Fuel sold plus trips delivered"}
          value={money(now.sales)}
          change={pctChange(now.sales, before.sales)}
          changeLabel={prev.label}
        />
        {isOwner ? (
          <StatCard
            label="Profit"
            caption={view === "depot" ? "Sales minus what the fuel cost you" : view === "trucks" ? "Trip income minus trip costs" : "Fuel and trip profit together"}
            value={money(now.profit)}
            change={pctChange(now.profit, before.profit)}
            changeLabel={prev.label}
            tone={now.profit < 0 ? "negative" : undefined}
            tip={
              <InfoTip>
                Sales minus the cost of fuel sold. Cost of fuel sold = litres sold × what each litre cost you to buy and
                bring to the depot (price plus transport). This period: {money(now.cogs)}.
              </InfoTip>
            }
          />
        ) : (
          <StatCard
            label="Fuel sold"
            caption="Litres that left the pumps"
            value={litres(now.litres)}
            change={pctChange(now.litres, before.litres)}
            changeLabel={prev.label}
          />
        )}
        <StatCard
          label="Expenses"
          caption={view === "trucks" ? "Truck costs not tied to one trip" : view === "combined" && isOwner ? "Depot running costs plus truck costs" : "Money out on running costs"}
          value={money(now.expenses)}
          change={pctChange(now.expenses, before.expenses)}
          changeLabel={prev.label}
          costly
          tip={<InfoTip>Rent, salaries, electricity, repairs and other running costs. Buying fuel is not counted here.</InfoTip>}
        />
        {isOwner ? (
          <StatCard
            label="Net profit"
            caption="What you keep after all costs"
            value={money(now.net)}
            change={pctChange(now.net, before.net)}
            changeLabel={prev.label}
            tone={now.net < 0 ? "negative" : "positive"}
            tip={<InfoTip>Profit minus expenses. If this is negative, the business spent more than it made in this period.</InfoTip>}
          />
        ) : (
          <StatCard label="Money owed" caption="Customers who bought on credit" value={money(owed)} />
        )}
      </div>
      )}
      {isOwner && view !== "depot" && tripOwed > 0.005 ? (
        <p className="-mt-2 mb-5 text-[13px] text-muted">
          Trip clients also owe you {money(tripOwed)}.{" "}
          <Link href="/trip-clients" className="underline underline-offset-2">
            See trip clients
          </Link>
        </p>
      ) : null}

      {/* Needs your attention */}
      <Card className="mb-5">
        <CardHeader className="flex-row items-center gap-2.5">
          <CardTitle>Needs your attention</CardTitle>
          {attention.length > 0 ? <Badge variant="destructive" className="ml-auto">{attention.length}</Badge> : null}
        </CardHeader>
        <CardContent className="pt-1">
          {attention.length === 0 ? (
            <p className="py-2 text-[15px] text-muted">All good. No low tanks, late payers, expiring documents or trucks in the garage.</p>
          ) : (
            <ul>
              {attention.map((a, i) => (
                <li key={a.key} className={`flex flex-wrap items-center gap-3.5 py-3.5 ${i ? "border-t border-line" : ""}`}>
                  <div className={`grid size-10 flex-none place-items-center rounded-full ${a.tone}`}>{a.icon}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-sm text-muted">{a.sub}</p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="h-10 w-full sm:w-auto">
                    <Link href={a.action.href}>{a.action.label}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Chart (depot money is not shown to fleet managers) */}
      {!isFleet ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Money in vs money out{isOwner && view !== "combined" ? (view === "depot" ? " · depot" : " · trucks") : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesExpensesChart data={chart} currency={disp.code} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr_1fr]">
        {/* Trucks */}
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle>Trucks</CardTitle>
            <CornerLink href="/trucks" label="Open trucks" />
          </CardHeader>
          <CardContent>
            <p className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{allTrucks.length}</p>
            <p className="mt-1 text-[15px] text-muted">trucks in total</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <MiniCount label="Ready" value={activeTrucks} />
              <MiniCount label="On a trip" value={onTrip} />
              <MiniCount label="In garage" value={inMaintenance.length} />
            </div>
          </CardContent>
        </Card>

        {/* Stock by tank */}
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="flex items-center gap-1.5">
              Fuel left in tanks
              {isOwner ? (
                <InfoTip>
                  Stock value = litres in each tank × what that fuel cost you on average (price plus transport). It&apos;s
                  what your fuel is worth at cost, not at the pump price.
                </InfoTip>
              ) : null}
            </CardTitle>
            <CornerLink href="/stock" label="Open stock" />
          </CardHeader>
          <CardContent className="space-y-4">
            {isOwner ? (
              <p className="text-[15px] text-muted">
                Worth <span className="font-semibold text-fg">{money(stockValue)}</span> at cost
              </p>
            ) : null}
            {allTanks.length === 0 ? (
              <p className="text-[15px] text-muted">No tanks yet. Add one in Stock.</p>
            ) : (
              allTanks.map((t) => {
                const pct = (Number(t.current_litres) / Number(t.capacity_litres)) * 100;
                const low = Number(t.current_litres) <= Number(t.low_stock_level);
                return (
                  <div key={t.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[15px]">
                      <span className="truncate font-medium">{t.name}</span>
                      <span className={`shrink-0 tabular-nums ${low ? "font-medium text-orange" : "text-muted"}`}>
                        {litres(t.current_litres)} · {num(pct, 0)}%
                      </span>
                    </div>
                    <Progress value={pct} tone={low ? "low" : "ok"} />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {!isFleet ? (
        <>
        {/* Money owed */}
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="flex items-center gap-1.5">
              Money owed to you
              <InfoTip>Fuel customers took on credit and haven&apos;t paid for yet. &quot;Late&quot; means past the days you gave them to pay.</InfoTip>
            </CardTitle>
            <CornerLink href="/customers" label="Open customers" />
          </CardHeader>
          <CardContent>
            <p className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{money(owed)}</p>
            <p className="mt-1 text-[15px] text-muted">
              {overdue > 0 ? <span className="font-medium text-orange">{money(overdue)} is late</span> : "Nothing is late"}
            </p>
            {owing.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {owing.slice(0, 4).map((b) => (
                  <li key={b.customer_id} className="inner-box flex items-center justify-between gap-2 py-2.5 text-[15px]">
                    <span className="truncate">{b.name}</span>
                    <span className="shrink-0 font-medium tabular-nums">{money(b.balance)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
        </>
        ) : (
          <TripOwedCard owed={money(tripOwed)} overdue={tripOverdue > 0.005 ? money(tripOverdue) : null} />
        )}
      </div>
    </>
  );
}

function CornerLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="ml-auto grid size-10 place-items-center rounded-full border border-line-strong text-fg hover:bg-surface-3"
    >
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="inner-box px-2 py-3">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}

function SetupChecklist({ steps }: { steps: { done: boolean; label: string; href: string; hint: string }[] }) {
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;
  return (
    <Card className="mb-5">
      <CardHeader className="flex-row items-center gap-2.5">
        <CardTitle>Get started</CardTitle>
        <Badge variant="info" className="ml-auto">
          {done} of {steps.length} done
        </Badge>
      </CardHeader>
      <CardContent className="pt-1">
        <ol>
          {steps.map((step, i) => (
            <li key={step.label} className={`flex flex-wrap items-center gap-3.5 py-3.5 ${i ? "border-t border-line" : ""}`}>
              <div
                className={`grid size-9 flex-none place-items-center rounded-full text-sm font-semibold ${step.done ? "bg-green text-white" : "bg-surface-2 text-fg"}`}
              >
                {step.done ? <Check className="size-[18px]" /> : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${step.done ? "text-muted line-through" : ""}`}>{step.label}</p>
                {!step.done ? <p className="text-sm text-muted">{step.hint}</p> : null}
              </div>
              {!step.done ? (
                <Button asChild variant="outline" size="sm" className="h-10 w-full sm:w-auto">
                  <Link href={step.href}>Do it</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function TripOwedCard({ owed, overdue }: { owed: string; overdue: string | null }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle>Trip clients owe</CardTitle>
        <CornerLink href="/trip-clients" label="Open trip clients" />
      </CardHeader>
      <CardContent>
        <p className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{owed}</p>
        <p className="mt-1 text-[15px] text-muted">{overdue ? <span className="font-medium text-orange">{overdue} is late</span> : "Nothing is late"}</p>
      </CardContent>
    </Card>
  );
}
