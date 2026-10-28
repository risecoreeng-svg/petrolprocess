-- PetroTrack: multi-currency, add-stock flow, scheduled deliveries, mobile money.
--
-- Money model
--   * Every organization has a base (reporting) currency, default USD, and a list of enabled
--     currencies. Supported currencies live in public.currencies (add a row to support more).
--   * exchange_rates: per org, typed by the owner. per_base = how many units of the currency
--     buy 1 unit of the base currency (e.g. 1 USD = 2,600 SDG -> per_base 2600).
--   * Sales, purchases, expenses and credit payments store the original currency, the original
--     amount, the rate used at that moment (fx_rate) and the base-currency amount. The existing
--     money columns (total, price_per_litre, cost_per_litre, trip_cost, amount) ARE the base
--     amounts, so profit, stock cost and weighted-average cost stay in base currency.
--   * Old transactions are never recomputed: fx_rate is captured on insert and never changes.
--
-- This migration is additive so it can be pushed onto a project that already has data.

-- ===== Currencies =====
create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  decimals int not null check (decimals between 0 and 4),
  symbol text not null
);
insert into public.currencies(code, name, decimals, symbol) values
  ('USD', 'US dollar', 2, '$'),
  ('SDG', 'Sudanese pound', 0, 'SDG'),
  ('SSP', 'South Sudanese pound', 0, 'SSP');
-- To support another currency later, e.g. Kenya:
--   insert into public.currencies values ('KES', 'Kenyan shilling', 2, 'KES');

alter table public.currencies enable row level security;
grant select on public.currencies to authenticated;
create policy currencies_read on public.currencies for select using (auth.uid() is not null);

-- ===== Organization currency settings =====
alter table public.organizations
  add column base_currency text not null default 'USD' references public.currencies(code),
  add column enabled_currencies text[] not null default array['USD','SDG','SSP'];

create function public.org_currency_guard() returns trigger language plpgsql security definer
set search_path = '' as $$
declare v_code text;
begin
  if not (new.base_currency = any(new.enabled_currencies)) then
    raise exception 'The base currency must be one of the enabled currencies';
  end if;
  foreach v_code in array new.enabled_currencies loop
    if not exists (select 1 from public.currencies where code = v_code) then
      raise exception 'Unknown currency %', v_code;
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.base_currency <> old.base_currency and (
       exists (select 1 from public.sales where org_id = new.id)
    or exists (select 1 from public.purchases where org_id = new.id)
    or exists (select 1 from public.expenses where org_id = new.id)
    or exists (select 1 from public.credit_payments where org_id = new.id)) then
    raise exception 'The base currency cannot change once money has been recorded';
  end if;
  return new;
end $$;
create trigger trg_org_currency before insert or update on public.organizations
  for each row execute function public.org_currency_guard();

grant update (base_currency, enabled_currencies) on public.organizations to authenticated;

-- ===== Exchange rates =====
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  currency text not null references public.currencies(code),
  per_base numeric(20,8) not null check (per_base > 0),
  effective_date date not null default public.nairobi_today(),
  is_placeholder boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, currency, effective_date),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);
create index exchange_rates_lookup_idx on public.exchange_rates(org_id, currency, effective_date desc);

create trigger trg_00_exchange_rates_org before insert or update on public.exchange_rates
  for each row execute function public.enforce_org();
create trigger trg_exchange_rates_updated before update on public.exchange_rates
  for each row execute function public.set_updated_at();
create trigger trg_exchange_rates_nodelete before delete on public.exchange_rates
  for each row execute function public.block_hard_delete();
create trigger trg_exchange_rates_audit after insert or update on public.exchange_rates
  for each row execute function public.audit_row();

alter table public.exchange_rates enable row level security;
grant select on public.exchange_rates to authenticated;
create policy exchange_rates_read on public.exchange_rates for select
  using (org_id = public.current_org_id());
-- Writes go through set_exchange_rate() (owner only).

-- Rate in force for an org/currency on a date. Base currency is always 1.
create function public.rate_for(p_org uuid, p_currency text, p_date date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_base text; v_rate numeric;
begin
  select base_currency into v_base from public.organizations where id = p_org;
  if p_currency = v_base then return 1; end if;
  select per_base into v_rate from public.exchange_rates
   where org_id = p_org and currency = p_currency and effective_date <= p_date and deleted_at is null
   order by effective_date desc, created_at desc limit 1;
  if v_rate is null then
    raise exception 'No exchange rate for % yet. The owner can set one in Settings.', p_currency;
  end if;
  return v_rate;
end $$;

create function public.set_exchange_rate(p_currency text, p_per_base numeric, p_date date default null)
returns public.exchange_rates language plpgsql security definer set search_path = '' as $$
declare o public.organizations; r public.exchange_rates; v_date date := coalesce(p_date, public.nairobi_today());
begin
  if not public.is_owner() then raise exception 'Only the owner can set exchange rates'; end if;
  select * into o from public.organizations where id = public.current_org_id();
  if p_currency = o.base_currency then raise exception '% is your base currency; its rate is always 1', p_currency; end if;
  if not (p_currency = any(o.enabled_currencies)) then raise exception '% is not enabled', p_currency; end if;
  if p_per_base is null or p_per_base <= 0 then raise exception 'Enter a rate above 0'; end if;
  if v_date > public.nairobi_today() then raise exception 'The rate date cannot be in the future'; end if;
  insert into public.exchange_rates(org_id, currency, per_base, effective_date, is_placeholder, created_by)
  values (o.id, p_currency, p_per_base, v_date, false, auth.uid())
  on conflict (org_id, currency, effective_date) do update
    set per_base = excluded.per_base, is_placeholder = false, created_by = excluded.created_by
  returning * into r;
  return r;
end $$;

-- Existing organizations get placeholder rates the owner must replace.
insert into public.exchange_rates(org_id, currency, per_base, effective_date, is_placeholder)
select o.id, c.code, case c.code when 'SDG' then 2600 when 'SSP' then 4600 end, date '2000-01-01', true
from public.organizations o cross join public.currencies c
where c.code in ('SDG','SSP');

-- ===== Views are rebuilt at the end; drop them while columns change =====
drop view public.monthly_summary;
drop view public.daily_summary;
drop view public.daily_sales_summary;
drop view public.customer_balances;
drop view public.sales_safe;
drop view public.purchases_safe;
drop view public.truck_performance;
drop view public.stock_value;

-- ===== Higher precision for base-currency unit prices (USD needs more than 2 decimals per litre) =====
alter table public.fuel_types alter column current_selling_price type numeric(16,6);
alter table public.tank_costing alter column avg_cost_per_litre type numeric(16,6);

-- ===== Purchases =====
alter table public.purchases drop column fuel_cost, drop column landed_cost_per_litre;
alter table public.purchases alter column cost_per_litre type numeric(18,8),
                             alter column trip_cost type numeric(16,4);
alter table public.purchases
  add column fuel_cost numeric(16,2) generated always as (round(litres * cost_per_litre, 2)) stored,
  add column landed_cost_per_litre numeric(16,6) generated always as
    (round((litres * cost_per_litre + trip_cost) / litres, 6)) stored,
  add column currency text references public.currencies(code),
  add column fx_rate numeric(20,8),
  add column original_cost_per_litre numeric(18,6),
  add column original_fuel_cost numeric(18,2),
  add column original_trip_cost numeric(18,2),
  add column original_total numeric(18,2);
update public.purchases p set currency = o.base_currency, fx_rate = 1,
  original_cost_per_litre = p.cost_per_litre, original_fuel_cost = p.fuel_cost,
  original_trip_cost = p.trip_cost, original_total = p.fuel_cost + p.trip_cost
from public.organizations o where o.id = p.org_id;
alter table public.purchases alter column currency set not null, alter column fx_rate set not null,
  alter column original_cost_per_litre set not null, alter column original_total set not null;

-- ===== Sales =====
alter type public.payment_type rename value 'mpesa' to 'mobile';
do $$ declare v_name text; begin
  -- The old rule "M-Pesa needs a reference" goes: the mobile money reference is optional.
  select conname into v_name from pg_constraint
   where conrelid = 'public.sales'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%mpesa_ref%';
  if v_name is not null then execute format('alter table public.sales drop constraint %I', v_name); end if;
end $$;
drop index public.sales_mpesa_ref_uq;
alter table public.sales rename column mpesa_ref to payment_ref;
create unique index sales_payment_ref_uq on public.sales(org_id, payment_ref)
  where payment_ref is not null and deleted_at is null;

create type public.delivery_status as enum ('scheduled', 'delivered');

alter table public.sales alter column total drop expression;
alter table public.sales drop column cost_total;
alter table public.sales alter column price_per_litre type numeric(16,6),
                         alter column cost_per_litre type numeric(16,6);
alter table public.sales
  add column cost_total numeric(16,2) generated always as (round(litres * cost_per_litre, 2)) stored,
  add column currency text references public.currencies(code),
  add column fx_rate numeric(20,8),
  add column original_price_per_litre numeric(18,6),
  add column original_total numeric(18,2),
  add column delivery_date date,
  add column delivery_status public.delivery_status not null default 'delivered',
  add column delivered_at timestamptz,
  add column void_reason text;
update public.sales s set currency = o.base_currency, fx_rate = 1,
  original_price_per_litre = s.price_per_litre, original_total = s.total,
  delivery_date = s.date, delivered_at = s.created_at
from public.organizations o where o.id = s.org_id;
alter table public.sales alter column currency set not null, alter column fx_rate set not null,
  alter column original_price_per_litre set not null, alter column original_total set not null,
  alter column delivery_date set not null;
create index sales_scheduled_idx on public.sales(org_id, delivery_date)
  where delivery_status = 'scheduled' and deleted_at is null;

-- ===== Expenses and credit payments =====
alter table public.expenses
  add column currency text references public.currencies(code),
  add column fx_rate numeric(20,8),
  add column original_amount numeric(18,2);
update public.expenses e set currency = o.base_currency, fx_rate = 1, original_amount = e.amount
from public.organizations o where o.id = e.org_id;
alter table public.expenses alter column currency set not null, alter column fx_rate set not null,
  alter column original_amount set not null;

alter table public.credit_payments drop constraint credit_payments_method_check;
update public.credit_payments set method = 'mobile' where method = 'mpesa';
alter table public.credit_payments add constraint credit_payments_method_check check (method in ('cash', 'mobile'));

alter table public.credit_payments
  add column currency text references public.currencies(code),
  add column fx_rate numeric(20,8),
  add column original_amount numeric(18,2);
update public.credit_payments p set currency = o.base_currency, fx_rate = 1, original_amount = p.amount
from public.organizations o where o.id = p.org_id;
alter table public.credit_payments alter column currency set not null, alter column fx_rate set not null,
  alter column original_amount set not null;

-- ===== Shared: pick currency + snapshot rate =====
-- Sets new.currency (default: org base) and returns the rate in force today. Rejects disabled currencies.
create function public.money_currency(p_org uuid, p_currency text, out currency text, out fx numeric, out decimals int)
language plpgsql stable security definer set search_path = '' as $$
declare o public.organizations;
begin
  select * into o from public.organizations where id = p_org;
  currency := coalesce(nullif(p_currency, ''), o.base_currency);
  if not (currency = any(o.enabled_currencies)) then
    raise exception '% is not enabled for this business', currency;
  end if;
  select c.decimals into decimals from public.currencies c where c.code = currency;
  fx := public.rate_for(p_org, currency, public.nairobi_today());
end $$;

-- ===== Sign-up: also seed placeholder rates =====
create or replace function public.handle_new_user() returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  v_org uuid;
  v_role public.user_role;
  v_name text := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                               split_part(new.email, '@', 1)), 120);
  v_business text := left(trim(coalesce(new.raw_user_meta_data->>'business_name', '')), 120);
begin
  v_org := nullif(new.raw_app_meta_data->>'org_id', '')::uuid;

  if v_org is not null then
    v_role := coalesce(nullif(new.raw_app_meta_data->>'role', '')::public.user_role, 'attendant');
    if v_role = 'owner' then
      raise exception 'Staff accounts can only be managers or attendants';
    end if;
    if not exists (select 1 from public.organizations where id = v_org) then
      raise exception 'Organization not found';
    end if;
    insert into public.profiles(id, org_id, full_name, role) values (new.id, v_org, v_name, v_role);
  else
    if length(v_business) < 2 then
      v_business := split_part(new.email, '@', 1) || '''s business';
    end if;
    insert into public.organizations(name) values (v_business) returning id into v_org;
    insert into public.profiles(id, org_id, full_name, role) values (new.id, v_org, v_name, 'owner');
    insert into public.fuel_types(org_id, name, current_selling_price)
    values (v_org, 'Petrol', 0), (v_org, 'Diesel', 0), (v_org, 'Kerosene', 0);
    -- Placeholder rates (dated long ago, flagged) so the app works on day one but asks the owner
    -- to type the rate they actually use.
    insert into public.exchange_rates(org_id, currency, per_base, effective_date, is_placeholder)
    values (v_org, 'SDG', 2600, date '2000-01-01', true), (v_org, 'SSP', 4600, date '2000-01-01', true);
  end if;
  return new;
end $$;

-- ===== Purchases trigger: currency conversion =====
create or replace function public.purchase_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks; m record;
begin
  perform public.assert_same_org('trucks', new.truck_id, new.org_id, 'Truck');
  perform public.assert_same_org('suppliers', new.supplier_id, new.org_id, 'Supplier');
  select * into t from public.tanks
   where id = new.tank_id and org_id = new.org_id and deleted_at is null for update;
  if not found then raise exception 'Tank not found'; end if;
  new.fuel_type_id := t.fuel_type_id;
  new.created_by := coalesce(auth.uid(), new.created_by);

  select * into m from public.money_currency(new.org_id, new.currency);
  new.currency := m.currency;
  new.fx_rate := m.fx;
  -- Cost can be given per litre or as a total; legacy callers pass base-currency cost_per_litre.
  if new.original_cost_per_litre is null then
    if new.original_fuel_cost is not null then
      new.original_cost_per_litre := new.original_fuel_cost / new.litres;
    elsif new.cost_per_litre is not null then
      new.original_cost_per_litre := new.cost_per_litre * m.fx;
    else
      raise exception 'Enter the cost per litre or the total cost';
    end if;
  end if;
  if new.original_cost_per_litre <= 0 then raise exception 'Cost must be more than 0'; end if;
  new.original_fuel_cost := coalesce(new.original_fuel_cost, round(new.litres * new.original_cost_per_litre, 2));
  new.original_trip_cost := coalesce(new.original_trip_cost, new.trip_cost * m.fx, 0);
  new.original_total := new.original_fuel_cost + new.original_trip_cost;
  -- Base-currency amounts used by every profit and stock calculation
  new.cost_per_litre := new.original_cost_per_litre / m.fx;
  new.trip_cost := new.original_trip_cost / m.fx;

  if t.current_litres + new.litres > t.capacity_litres then
    raise exception 'Delivery of % L exceeds tank capacity (% L free)',
      new.litres, t.capacity_litres - t.current_litres;
  end if;
  return new;
end $$;

-- ===== Sales trigger: currency, price, delivery =====
create or replace function public.sale_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks; ft public.fuel_types; c public.customers; m record; v_avg numeric;
        v_today date := public.nairobi_today();
begin
  select * into t from public.tanks
   where id = new.tank_id and org_id = new.org_id and deleted_at is null for update;
  if not found then raise exception 'Tank not found'; end if;
  select * into ft from public.fuel_types where id = t.fuel_type_id;
  new.fuel_type_id := t.fuel_type_id;

  if public.app_role() = 'attendant' then
    -- attendants record for themselves, today, on their open shift
    new.attendant_id := auth.uid();
    new.date := v_today;
    new.shift_id := null;
  else
    new.attendant_id := coalesce(new.attendant_id, auth.uid());
  end if;
  perform public.assert_same_org('profiles', new.attendant_id, new.org_id, 'Attendant');
  perform public.assert_same_org('shifts', new.shift_id, new.org_id, 'Shift');

  if new.shift_id is null then
    select id into new.shift_id from public.shifts
     where attendant_id = new.attendant_id and org_id = new.org_id
       and ended_at is null and deleted_at is null;
    if new.shift_id is null and public.app_role() = 'attendant' then
      raise exception 'Start a shift before recording sales';
    end if;
  end if;

  if new.litres > t.current_litres then
    raise exception 'Not enough fuel: % L asked for, only % L left in %',
      new.litres, t.current_litres, t.name;
  end if;

  -- Money: amount (or price per litre) in the chosen currency, converted at today's rate
  select * into m from public.money_currency(new.org_id, new.currency);
  new.currency := m.currency;
  new.fx_rate := m.fx;
  if new.original_total is not null then
    new.original_price_per_litre := new.original_total / new.litres;
  else
    new.original_price_per_litre := coalesce(new.original_price_per_litre,
                                             new.price_per_litre * m.fx,        -- legacy: base price given
                                             ft.current_selling_price * m.fx);  -- default: pump price
    new.original_total := round(new.litres * new.original_price_per_litre, m.decimals);
  end if;
  if new.original_total is null or new.original_total <= 0 then
    raise exception 'Enter the amount the fuel was sold for';
  end if;
  new.price_per_litre := new.original_price_per_litre / m.fx;
  new.total := round(new.original_total / m.fx, 2);

  new.payment_ref := nullif(trim(new.payment_ref), '');
  new.delivery_date := coalesce(new.delivery_date, new.date);
  new.delivered_at := case when new.delivery_status = 'delivered' then now() end;

  select avg_cost_per_litre into v_avg from public.tank_costing where tank_id = new.tank_id;
  if v_avg is null then raise exception 'This tank has no cost yet; add stock first'; end if;
  new.cost_per_litre := v_avg;

  if new.payment_type = 'credit' then
    if new.customer_id is null then raise exception 'Credit sales need a customer'; end if;
    select * into c from public.customers
     where id = new.customer_id and org_id = new.org_id and deleted_at is null for update;
    if not found then raise exception 'Customer not found'; end if;
    if c.balance + new.total > c.credit_limit then
      raise exception 'Credit limit exceeded: balance %, limit %, this sale % (in %)',
        c.balance, c.credit_limit, new.total, (select base_currency from public.organizations where id = new.org_id);
    end if;
  elsif new.customer_id is not null then
    perform public.assert_same_org('customers', new.customer_id, new.org_id, 'Customer');
  end if;
  return new;
end $$;

-- A void must say why.
create function public.sale_before_update() returns trigger language plpgsql
set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and coalesce(trim(new.void_reason), '') = '' then
    raise exception 'Give a reason for cancelling this sale';
  end if;
  return new;
end $$;
create trigger trg_sale_before_update before update on public.sales
  for each row execute function public.sale_before_update();

-- ===== Expenses and payments: currency =====
create or replace function public.expense_before_write() returns trigger language plpgsql security definer
set search_path = '' as $$
declare m record;
begin
  perform public.assert_same_org('trucks', new.truck_id, new.org_id, 'Truck');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    select * into m from public.money_currency(new.org_id, new.currency);
    new.currency := m.currency;
    new.fx_rate := m.fx;
    if new.original_amount is null then
      if new.amount is null then raise exception 'Enter the amount'; end if;
      new.original_amount := round(new.amount * m.fx, m.decimals);   -- legacy: base amount given
    end if;
    new.amount := round(new.original_amount / m.fx, 2);
  elsif new.original_amount is distinct from old.original_amount then
    -- an edit keeps the rate from when the expense was first recorded
    new.amount := round(new.original_amount / old.fx_rate, 2);
  end if;
  return new;
end $$;
drop trigger trg_expense_before on public.expenses;
create trigger trg_expense_before before insert or update of truck_id, original_amount on public.expenses
  for each row execute function public.expense_before_write();

create or replace function public.payment_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare c public.customers; m record;
begin
  select * into m from public.money_currency(new.org_id, new.currency);
  new.currency := m.currency;
  new.fx_rate := m.fx;
  if new.original_amount is null then
    if new.amount is null then raise exception 'Enter the amount'; end if;
    new.original_amount := round(new.amount * m.fx, m.decimals);
  end if;
  new.amount := round(new.original_amount / m.fx, 2);

  select * into c from public.customers
   where id = new.customer_id and org_id = new.org_id and deleted_at is null for update;
  if not found then raise exception 'Customer not found'; end if;
  -- Allow rounding of up to 1 base cent when a customer pays off the whole balance in another currency.
  if new.amount > c.balance + 0.01 then
    raise exception 'Payment % exceeds balance owed %', new.amount, c.balance;
  end if;
  new.amount := least(new.amount, c.balance);
  new.received_by := coalesce(auth.uid(), new.received_by);
  return new;
end $$;

-- ===== RPC: add stock (owner and sales manager) =====
-- One atomic step: optional new tank, optional new supplier/truck, the delivery itself and the
-- new selling price. The litres are sellable as soon as this returns.
create function public.add_stock(
  p_fuel_type_id uuid,
  p_litres numeric,
  p_currency text default null,
  p_cost_per_litre numeric default null,
  p_cost_total numeric default null,
  p_selling_price numeric default null,
  p_tank_id uuid default null,
  p_new_tank_name text default null,
  p_new_tank_capacity numeric default null,
  p_supplier_id uuid default null,
  p_new_supplier_name text default null,
  p_truck_id uuid default null,
  p_new_truck_plate text default null,
  p_trip_cost numeric default 0,
  p_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.current_org_id();
  v_tank uuid := p_tank_id;
  v_supplier uuid := p_supplier_id;
  v_truck uuid := p_truck_id;
  v_purchase uuid;
  m record;
  t public.tanks;
begin
  if not public.is_manager_up() then raise exception 'Only the owner or a sales manager can add stock'; end if;
  perform public.assert_same_org('fuel_types', p_fuel_type_id, v_org, 'Fuel type');
  if p_litres is null or p_litres <= 0 then raise exception 'Enter how many litres arrived'; end if;
  if coalesce(p_date, public.nairobi_today()) > public.nairobi_today() then
    raise exception 'The delivery date cannot be in the future';
  end if;

  if v_tank is null then
    if coalesce(trim(p_new_tank_name), '') = '' or p_new_tank_capacity is null or p_new_tank_capacity <= 0 then
      raise exception 'Give the new tank a name and capacity';
    end if;
    insert into public.tanks(org_id, name, fuel_type_id, capacity_litres, low_stock_level)
    values (v_org, trim(p_new_tank_name), p_fuel_type_id, p_new_tank_capacity, round(p_new_tank_capacity * 0.15))
    returning id into v_tank;
  else
    select * into t from public.tanks where id = v_tank and org_id = v_org and deleted_at is null;
    if not found then raise exception 'Tank not found'; end if;
    if t.fuel_type_id <> p_fuel_type_id then raise exception '% holds a different fuel', t.name; end if;
  end if;

  if v_supplier is null then
    if coalesce(trim(p_new_supplier_name), '') = '' then raise exception 'Choose or add a supplier'; end if;
    insert into public.suppliers(org_id, name) values (v_org, trim(p_new_supplier_name)) returning id into v_supplier;
  end if;
  if v_truck is null then
    if coalesce(trim(p_new_truck_plate), '') = '' then raise exception 'Choose or add a truck'; end if;
    insert into public.trucks(org_id, plate_number, capacity_litres)
    values (v_org, upper(regexp_replace(trim(p_new_truck_plate), '\s+', ' ', 'g')), greatest(p_litres, 1))
    returning id into v_truck;
  end if;

  if p_cost_per_litre is null and p_cost_total is null then raise exception 'Enter the cost per litre or the total cost'; end if;

  insert into public.purchases(org_id, date, supplier_id, truck_id, tank_id, litres, currency,
    original_cost_per_litre, original_fuel_cost, original_trip_cost, cost_per_litre)
  values (v_org, coalesce(p_date, public.nairobi_today()), v_supplier, v_truck, v_tank, p_litres, p_currency,
    p_cost_per_litre, p_cost_total, coalesce(p_trip_cost, 0), 0)
  returning id into v_purchase;

  if p_selling_price is not null then
    if p_selling_price <= 0 then raise exception 'Selling price must be more than 0'; end if;
    select * into m from public.money_currency(v_org, p_currency);
    update public.fuel_types set current_selling_price = p_selling_price / m.fx where id = p_fuel_type_id;
  end if;
  return v_purchase;
end $$;

-- ===== RPC: cancel (void) a sale with a reason; mark a scheduled sale delivered =====
create function public.void_sale(p_sale uuid, p_reason text) returns void language plpgsql
security definer set search_path = '' as $$
begin
  if not public.is_manager_up() then raise exception 'Only the owner or a sales manager can cancel a sale'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling this sale'; end if;
  update public.sales set deleted_at = now(), void_reason = trim(p_reason)
   where id = p_sale and org_id = public.current_org_id() and deleted_at is null;
  if not found then raise exception 'Sale not found'; end if;
end $$;

create function public.mark_sale_delivered(p_sale uuid) returns void language plpgsql
security definer set search_path = '' as $$
begin
  update public.sales set delivery_status = 'delivered', delivered_at = now()
   where id = p_sale and org_id = public.current_org_id() and deleted_at is null
     and delivery_status = 'scheduled'
     and (public.is_manager_up() or attendant_id = auth.uid());
  if not found then raise exception 'Scheduled sale not found'; end if;
end $$;

-- ===== Grants =====
revoke execute on function public.rate_for(uuid, text, date), public.money_currency(uuid, text),
  public.org_currency_guard(), public.sale_before_update() from public, anon, authenticated;
revoke execute on function public.set_exchange_rate(text, numeric, date),
  public.add_stock(uuid, numeric, text, numeric, numeric, numeric, uuid, text, numeric, uuid, text, uuid, text, numeric, date),
  public.void_sale(uuid, text), public.mark_sale_delivered(uuid) from public, anon;
grant execute on function public.set_exchange_rate(text, numeric, date),
  public.add_stock(uuid, numeric, text, numeric, numeric, numeric, uuid, text, numeric, uuid, text, uuid, text, numeric, date),
  public.void_sale(uuid, text), public.mark_sale_delivered(uuid) to authenticated;

-- Deliveries now go through add_stock() only.
revoke insert on public.purchases from authenticated;

revoke insert on public.sales from authenticated;
grant insert (date, tank_id, fuel_type_id, litres, payment_type, customer_id, payment_ref, attendant_id,
  shift_id, currency, original_price_per_litre, original_total, delivery_date, delivery_status)
  on public.sales to authenticated;
grant update (void_reason) on public.sales to authenticated;

revoke insert, update on public.expenses from authenticated;
grant insert (date, category, truck_id, description, currency, original_amount, amount) on public.expenses to authenticated;
grant update (date, category, truck_id, description, original_amount, deleted_at) on public.expenses to authenticated;

revoke insert on public.credit_payments from authenticated;
grant insert (customer_id, method, date, currency, original_amount, amount) on public.credit_payments to authenticated;

-- Sales managers can now see what they paid for stock (still never sale cost, profit or margins).
drop policy purchases_read on public.purchases;
create policy purchases_read on public.purchases for select
  using (org_id = public.current_org_id() and public.is_manager_up());

-- ===== Views (rebuilt with the new columns) =====
create view public.purchases_safe as
  select id, org_id, date, supplier_id, truck_id, tank_id, fuel_type_id, litres, created_by, created_at,
         currency, fx_rate, original_cost_per_litre, original_total
  from public.purchases
  where deleted_at is null and org_id = public.current_org_id() and public.is_manager_up();

create view public.sales_safe as
  select id, org_id, date, created_at, tank_id, fuel_type_id, litres, price_per_litre, total,
         payment_type, customer_id, payment_ref, attendant_id, shift_id,
         currency, fx_rate, original_price_per_litre, original_total,
         delivery_date, delivery_status, delivered_at
  from public.sales
  where deleted_at is null
    and org_id = public.current_org_id()
    and (public.is_manager_up()
         or (public.app_role() = 'attendant' and attendant_id = auth.uid()));

-- All money in the reports is base currency.
create view public.daily_summary with (security_invoker = true) as
with s as (
  select date,
         sum(total) as sales,
         sum(litres) as litres,
         sum(total) filter (where payment_type = 'cash') as cash_sales,
         sum(total) filter (where payment_type = 'mobile') as mobile_sales,
         sum(total) filter (where payment_type = 'credit') as credit_sales,
         sum(cost_total) as cost_of_fuel
  from public.sales
  where deleted_at is null and org_id = public.current_org_id()
  group by date),
e as (
  select date, sum(amount) as expenses
  from public.expenses
  where deleted_at is null and org_id = public.current_org_id()
  group by date)
select date,
  coalesce(s.sales, 0) as sales,
  coalesce(s.litres, 0) as litres,
  coalesce(s.cash_sales, 0) as cash_sales,
  coalesce(s.mobile_sales, 0) as mobile_sales,
  coalesce(s.credit_sales, 0) as credit_sales,
  coalesce(s.cost_of_fuel, 0) as cost_of_fuel,
  coalesce(s.sales, 0) - coalesce(s.cost_of_fuel, 0) as gross_profit,
  coalesce(e.expenses, 0) as expenses,
  coalesce(s.sales, 0) - coalesce(s.cost_of_fuel, 0) - coalesce(e.expenses, 0) as net_profit
from s full join e using (date)
where public.is_owner();

create view public.monthly_summary with (security_invoker = true) as
select date_trunc('month', date)::date as month,
  sum(sales) as sales, sum(litres) as litres,
  sum(cash_sales) as cash_sales, sum(mobile_sales) as mobile_sales, sum(credit_sales) as credit_sales,
  sum(cost_of_fuel) as cost_of_fuel, sum(gross_profit) as gross_profit,
  sum(expenses) as expenses, sum(net_profit) as net_profit
from public.daily_summary
group by 1;

create view public.truck_performance with (security_invoker = true) as
with p as (
  select pu.truck_id,
         count(*) as deliveries,
         sum(pu.litres) as litres_brought,
         sum(pu.fuel_cost) as fuel_cost,
         sum(pu.trip_cost) as trip_cost,
         sum(round(pu.litres * (ft.current_selling_price - pu.landed_cost_per_litre), 2)) as margin
  from public.purchases pu
  join public.fuel_types ft on ft.id = pu.fuel_type_id and ft.org_id = pu.org_id
  where pu.deleted_at is null and pu.org_id = public.current_org_id()
  group by pu.truck_id),
x as (
  select truck_id,
    sum(amount) filter (where category in ('truck_repairs','maintenance')) as repair_costs,
    sum(amount) filter (where category not in ('truck_repairs','maintenance')) as other_truck_costs
  from public.expenses
  where truck_id is not null and deleted_at is null and org_id = public.current_org_id()
  group by truck_id)
select t.id as truck_id, t.org_id, t.plate_number, t.status,
  coalesce(p.deliveries, 0) as deliveries,
  coalesce(p.litres_brought, 0) as litres_brought,
  coalesce(p.fuel_cost, 0) as fuel_cost,
  coalesce(p.trip_cost, 0) as trip_cost,
  coalesce(p.margin, 0) as margin,
  coalesce(x.repair_costs, 0) as repair_costs,
  coalesce(x.other_truck_costs, 0) as other_truck_costs,
  coalesce(p.margin, 0) - coalesce(x.repair_costs, 0) - coalesce(x.other_truck_costs, 0) as profit
from public.trucks t
left join p on p.truck_id = t.id
left join x on x.truck_id = t.id
where t.deleted_at is null and t.org_id = public.current_org_id() and public.is_owner();

create view public.stock_value with (security_invoker = true) as
select tk.id as tank_id, tk.org_id, tk.name, tk.fuel_type_id, tk.current_litres, tc.avg_cost_per_litre,
       round(tk.current_litres * tc.avg_cost_per_litre, 2) as value
from public.tanks tk
join public.tank_costing tc on tc.tank_id = tk.id and tc.org_id = tk.org_id
where tk.deleted_at is null and tk.org_id = public.current_org_id() and public.is_owner();

create view public.customer_balances as
select c.id as customer_id, c.org_id, c.name, c.phone, c.credit_limit, c.credit_terms_days, c.balance,
  coalesce((select sum(s.total) from public.sales s
             where s.customer_id = c.id and s.org_id = c.org_id and s.deleted_at is null), 0)
    as total_credit_sales,
  coalesce((select sum(p.amount) from public.credit_payments p
             where p.customer_id = c.id and p.org_id = c.org_id and p.deleted_at is null), 0)
    as total_paid,
  greatest(0, c.balance - coalesce((select sum(s.total) from public.sales s
             where s.customer_id = c.id and s.org_id = c.org_id and s.deleted_at is null
               and s.date > public.nairobi_today() - c.credit_terms_days), 0)) as overdue
from public.customers c
where c.deleted_at is null and c.org_id = public.current_org_id() and public.is_manager_up();

create view public.daily_sales_summary as
select date,
  sum(total) as sales,
  sum(litres) as litres,
  coalesce(sum(total) filter (where payment_type = 'cash'), 0) as cash_sales,
  coalesce(sum(total) filter (where payment_type = 'mobile'), 0) as mobile_sales,
  coalesce(sum(total) filter (where payment_type = 'credit'), 0) as credit_sales
from public.sales
where deleted_at is null and org_id = public.current_org_id() and public.is_manager_up()
group by date;

revoke all on public.purchases_safe, public.sales_safe, public.daily_summary,
  public.monthly_summary, public.truck_performance, public.stock_value,
  public.customer_balances, public.daily_sales_summary from anon, public;
grant select on public.purchases_safe, public.sales_safe, public.daily_summary,
  public.monthly_summary, public.truck_performance, public.stock_value,
  public.customer_balances, public.daily_sales_summary to authenticated;
