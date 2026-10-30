-- PetroTrack: Truck Business module.
--
--   * Trucks earn money on hired trips and also haul fuel to our own depot.
--   * trips: one truck, optional driver, a client (customers) unless it's for our own depot,
--     route, cargo, agreed fee (multi-currency), status Planned -> On the road -> Delivered
--     (or Cancelled). Voids need a reason; nothing is deleted.
--   * trip_lines: extra income (waiting time, extra drops) and trip expenses, any currency.
--   * Fuel haulage on the trip: litres loaded vs delivered, shortage, tolerance flag.
--     Own-depot fuel becomes a stock purchase exactly once when the trip is delivered.
--   * truck_expenses (+ repeating ones), truck_documents, service_reminders,
--     trip_payments (client receivables), driver_advances.
--   * Roles: owner sees all; fleet_manager runs trips but never sees profit or staff pay;
--     driver sees only their own trips (no fee) and can add expenses and delivered litres.
--   * All money: original currency + amount + rate used + base (USD) amount, never recomputed.

-- ===== Settings and profile extensions =====
alter table public.organizations
  add column haulage_tolerance_pct numeric(6,3) not null default 0.5
    check (haulage_tolerance_pct >= 0 and haulage_tolerance_pct <= 100);
grant update (haulage_tolerance_pct) on public.organizations to authenticated;

alter table public.trucks
  add column make_model text,
  add column year int check (year between 1950 and 2100),
  add column truck_type text not null default 'tanker' check (truck_type in ('tanker', 'flatbed', 'other')),
  add column capacity_unit text not null default 'litres' check (capacity_unit in ('litres', 'tonnes')),
  add column odometer_km numeric(12,1) not null default 0 check (odometer_km >= 0),
  add column ownership text not null default 'own' check (ownership in ('own', 'third_party')),
  add column third_party_owner text,
  -- fixed_per_trip: payout_value is a base-currency amount; percent_of_fee: payout_value is a %
  add column payout_type text check (payout_type in ('fixed_per_trip', 'percent_of_fee')),
  add column payout_value numeric(14,4) check (payout_value >= 0),
  add constraint trucks_third_party_chk check (
    ownership = 'own' or (third_party_owner is not null and payout_type is not null and payout_value is not null));

alter table public.drivers
  add column licence_expiry date,
  add column profile_id uuid,
  add constraint drivers_profile_uq unique (profile_id),
  add constraint drivers_profile_fk foreign key (org_id, profile_id) references public.profiles(org_id, id);

-- ===== Role helpers =====
create function public.is_fleet_up() returns boolean language sql stable
set search_path = '' as $$ select coalesce(public.app_role() in ('owner', 'fleet_manager'), false) $$;

create function public.can_manage_assets() returns boolean language sql stable
set search_path = '' as $$ select coalesce(public.app_role() in ('owner', 'manager', 'fleet_manager'), false) $$;

create function public.current_driver_id() returns uuid language sql stable security definer
set search_path = '' as $$
  select id from public.drivers
  where profile_id = auth.uid() and org_id = public.current_org_id() and deleted_at is null
  limit 1
$$;

grant execute on function public.is_fleet_up(), public.can_manage_assets(), public.current_driver_id() to authenticated;

-- ===== Sign-up / staff creation: allow the new roles; link driver logins =====
create or replace function public.handle_new_user() returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  v_org uuid;
  v_role public.user_role;
  v_driver uuid;
  v_name text := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                               split_part(new.email, '@', 1)), 120);
  v_business text := left(trim(coalesce(new.raw_user_meta_data->>'business_name', '')), 120);
begin
  v_org := nullif(new.raw_app_meta_data->>'org_id', '')::uuid;

  if v_org is not null then
    v_role := coalesce(nullif(new.raw_app_meta_data->>'role', '')::public.user_role, 'attendant');
    if v_role = 'owner' then
      raise exception 'Staff accounts can only be sales managers, fleet managers, attendants or drivers';
    end if;
    if not exists (select 1 from public.organizations where id = v_org) then
      raise exception 'Organization not found';
    end if;
    insert into public.profiles(id, org_id, full_name, role) values (new.id, v_org, v_name, v_role);
    v_driver := nullif(new.raw_app_meta_data->>'driver_id', '')::uuid;
    if v_driver is not null then
      if v_role::text <> 'driver' then raise exception 'Only driver accounts can be linked to a driver'; end if;
      update public.drivers set profile_id = new.id
       where id = v_driver and org_id = v_org and profile_id is null and deleted_at is null;
      if not found then raise exception 'Driver not found or already has a login'; end if;
    end if;
  else
    if length(v_business) < 2 then
      v_business := split_part(new.email, '@', 1) || '''s business';
    end if;
    insert into public.organizations(name) values (v_business) returning id into v_org;
    insert into public.profiles(id, org_id, full_name, role) values (new.id, v_org, v_name, 'owner');
    insert into public.fuel_types(org_id, name, current_selling_price)
    values (v_org, 'Petrol', 0), (v_org, 'Diesel', 0), (v_org, 'Kerosene', 0);
    insert into public.exchange_rates(org_id, currency, per_base, effective_date, is_placeholder)
    values (v_org, 'SDG', 2600, date '2000-01-01', true), (v_org, 'SSP', 4600, date '2000-01-01', true);
  end if;
  return new;
end $$;

-- ===== Reference data: fleet managers can manage trucks, drivers, suppliers and clients =====
drop policy trucks_insert on public.trucks;
drop policy trucks_update on public.trucks;
drop policy drivers_insert on public.drivers;
drop policy drivers_update on public.drivers;
drop policy suppliers_insert on public.suppliers;
drop policy suppliers_update on public.suppliers;
drop policy customers_insert on public.customers;
drop policy customers_update on public.customers;
drop policy customers_read on public.customers;
drop policy profiles_read on public.profiles;

do $$ declare t text; begin
  foreach t in array array['trucks','drivers','suppliers','customers'] loop
    execute format('create policy %1$s_insert on public.%1$s for insert
      with check (org_id = public.current_org_id() and public.can_manage_assets())', t);
    execute format('create policy %1$s_update on public.%1$s for update
      using (org_id = public.current_org_id() and public.can_manage_assets())
      with check (org_id = public.current_org_id() and public.can_manage_assets())', t);
  end loop;
end $$;
-- Drivers don't need the customer list (or its credit balances).
create policy customers_read on public.customers for select
  using (org_id = public.current_org_id() and public.app_role() is not null and public.app_role() <> 'driver'
         and (deleted_at is null or public.is_owner()));
create policy profiles_read on public.profiles for select
  using (org_id = public.current_org_id() and (id = auth.uid() or public.is_manager_up() or public.is_fleet_up()));

grant insert (make_model, year, truck_type, capacity_unit, odometer_km, ownership, third_party_owner, payout_type, payout_value)
  on public.trucks to authenticated;
grant update (make_model, year, truck_type, capacity_unit, odometer_km, ownership, third_party_owner, payout_type, payout_value)
  on public.trucks to authenticated;
grant insert (licence_expiry) on public.drivers to authenticated;
grant update (licence_expiry) on public.drivers to authenticated;

-- ===== Trips =====
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  trip_no int not null,
  date date not null default public.nairobi_today(),
  truck_id uuid not null,
  driver_id uuid,
  customer_id uuid,
  for_own_depot boolean not null default false,
  route_from text not null check (length(trim(route_from)) > 0),
  route_to text not null check (length(trim(route_to)) > 0),
  cargo_type text not null default 'goods' check (cargo_type in ('fuel', 'goods', 'other')),
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null,
  fee_original numeric(18,2) not null default 0 check (fee_original >= 0),
  fee numeric(16,2) not null default 0,                       -- base currency
  status text not null default 'planned' check (status in ('planned', 'on_road', 'delivered', 'cancelled')),
  started_at timestamptz,
  delivered_at timestamptz,
  cancel_reason text,
  start_odometer numeric(12,1) check (start_odometer >= 0),
  end_odometer numeric(12,1) check (end_odometer >= 0),
  notes text,
  start_override_reason text,
  start_override_by uuid,
  -- fuel haulage
  fuel_type_id uuid,
  litres_loaded numeric(12,2) check (litres_loaded >= 0),
  loaded_from text,
  loading_ticket text,
  supplier_id uuid,
  litres_delivered numeric(12,2) check (litres_delivered >= 0),
  shortage_litres numeric(12,2) generated always as (
    case when litres_loaded is not null and litres_delivered is not null then litres_loaded - litres_delivered end) stored,
  shortage_pct numeric(9,3) generated always as (
    case when coalesce(litres_loaded, 0) > 0 and litres_delivered is not null
         then round((litres_loaded - litres_delivered) / litres_loaded * 100, 3) end) stored,
  haulage_status text check (haulage_status in ('ok', 'disputed', 'resolved')),
  dispute_note text,
  tank_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  void_reason text,
  unique (org_id, id),
  unique (org_id, trip_no),
  check (for_own_depot or customer_id is not null),
  check (not for_own_depot or cargo_type = 'fuel'),
  check (end_odometer is null or start_odometer is null or end_odometer >= start_odometer),
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, driver_id) references public.drivers(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, fuel_type_id) references public.fuel_types(org_id, id),
  foreign key (org_id, supplier_id) references public.suppliers(org_id, id),
  foreign key (org_id, tank_id) references public.tanks(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);
create index trips_org_date_idx on public.trips(org_id, date desc);
create index trips_truck_idx on public.trips(truck_id);
create index trips_customer_idx on public.trips(customer_id);
create index trips_driver_idx on public.trips(driver_id);

-- A delivery into our own tank links back to its trip; at most one per trip.
alter table public.purchases add column trip_id uuid;
alter table public.purchases add constraint purchases_trip_fk foreign key (org_id, trip_id) references public.trips(org_id, id);
create unique index purchases_trip_uq on public.purchases(trip_id) where trip_id is not null and deleted_at is null;

create function public.trip_before_write() returns trigger language plpgsql security definer
set search_path = '' as $$
declare m record;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('trip_no:' || new.org_id::text));
    select coalesce(max(trip_no), 0) + 1 into new.trip_no from public.trips where org_id = new.org_id;
    new.status := 'planned';
    new.created_by := coalesce(auth.uid(), new.created_by);
    select * into m from public.money_currency(new.org_id, new.currency);
    new.currency := m.currency;
    new.fx_rate := m.fx;
    new.fee := round(new.fee_original / m.fx, 2);
  else
    if new.fee_original is distinct from old.fee_original then
      new.fee := round(new.fee_original / old.fx_rate, 2);   -- keeps the rate from when the trip was entered
    end if;
    if old.status in ('delivered', 'cancelled') and (
         new.fee_original is distinct from old.fee_original or new.truck_id is distinct from old.truck_id
      or new.driver_id is distinct from old.driver_id or new.customer_id is distinct from old.customer_id
      or new.for_own_depot is distinct from old.for_own_depot or new.cargo_type is distinct from old.cargo_type
      or new.fuel_type_id is distinct from old.fuel_type_id or new.litres_loaded is distinct from old.litres_loaded
      or new.route_from is distinct from old.route_from or new.route_to is distinct from old.route_to
      or new.date is distinct from old.date) then
      raise exception 'This trip is %; its details are locked. Void it and record it again if it''s wrong.', old.status;
    end if;
    if old.deleted_at is null and new.deleted_at is not null and coalesce(trim(new.void_reason), '') = '' then
      raise exception 'Give a reason for voiding this trip';
    end if;
    if old.deleted_at is not null and new.deleted_at is null then
      raise exception 'Voided trips cannot be restored';
    end if;
  end if;
  -- Same-org checks on anything new or changed (later archiving of a client mustn't lock old trips).
  if tg_op = 'INSERT' or new.truck_id is distinct from old.truck_id then
    perform public.assert_same_org('trucks', new.truck_id, new.org_id, 'Truck'); end if;
  if tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id then
    perform public.assert_same_org('drivers', new.driver_id, new.org_id, 'Driver'); end if;
  if tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id then
    perform public.assert_same_org('customers', new.customer_id, new.org_id, 'Client'); end if;
  if tg_op = 'INSERT' or new.fuel_type_id is distinct from old.fuel_type_id then
    perform public.assert_same_org('fuel_types', new.fuel_type_id, new.org_id, 'Fuel type'); end if;
  if tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id then
    perform public.assert_same_org('suppliers', new.supplier_id, new.org_id, 'Supplier'); end if;
  if tg_op = 'INSERT' or new.tank_id is distinct from old.tank_id then
    perform public.assert_same_org('tanks', new.tank_id, new.org_id, 'Tank'); end if;
  if new.for_own_depot then new.customer_id := null; end if;
  if new.cargo_type = 'fuel' and new.fuel_type_id is null then
    raise exception 'Pick the fuel type for a fuel trip';
  end if;
  return new;
end $$;

-- ===== Trip lines: extra income and trip expenses =====
create table public.trip_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  trip_id uuid not null,
  kind text not null check (kind in ('income', 'expense')),
  category text not null,
  description text,
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null,
  original_amount numeric(18,2) not null check (original_amount > 0),
  amount numeric(16,2) not null,                               -- base currency
  litres numeric(12,2) check (litres >= 0),
  driver_id uuid,
  paid_from_advance boolean not null default false,
  receipt_path text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((kind = 'income' and category in ('waiting_time', 'extra_drop', 'other_income'))
      or (kind = 'expense' and category in ('fuel', 'driver_pay', 'tolls_border', 'loading', 'checkpoint',
                                            'meals', 'road_repairs', 'other'))),
  foreign key (org_id, trip_id) references public.trips(org_id, id),
  foreign key (org_id, driver_id) references public.drivers(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);
create index trip_lines_trip_idx on public.trip_lines(trip_id);

-- ===== Truck expenses (not tied to a trip) and repeating ones =====
create table public.truck_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  truck_id uuid not null,
  category text not null check (category in ('truck_fuel', 'driver_salary', 'licence', 'permit', 'insurance',
                                               'inspection', 'tyres', 'repairs', 'parking', 'fines', 'other')),
  description text,
  driver_id uuid,
  currency text not null references public.currencies(code),
  original_amount numeric(18,2) not null check (original_amount > 0),
  next_due date not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, driver_id) references public.drivers(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);

create table public.truck_expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  truck_id uuid not null,
  date date not null default public.nairobi_today(),
  category text not null check (category in ('truck_fuel', 'driver_salary', 'licence', 'permit', 'insurance',
                                               'inspection', 'tyres', 'repairs', 'parking', 'fines', 'other')),
  description text,
  litres numeric(12,2) check (litres >= 0),
  odometer_km numeric(12,1) check (odometer_km >= 0),
  workshop text,
  driver_id uuid,
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null,
  original_amount numeric(18,2) not null check (original_amount > 0),
  amount numeric(16,2) not null,                               -- base currency
  receipt_path text,
  recurring_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, driver_id) references public.drivers(org_id, id),
  foreign key (org_id, recurring_id) references public.truck_recurring_expenses(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);
create index truck_expenses_org_date_idx on public.truck_expenses(org_id, date desc);
create index truck_expenses_truck_idx on public.truck_expenses(truck_id);

-- ===== Documents and service reminders =====
create table public.truck_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  truck_id uuid not null,
  doc_type text not null check (doc_type in ('licence', 'insurance', 'inspection', 'permit', 'other')),
  reference text,
  expires_on date not null,
  notes text,
  file_path text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);
create index truck_documents_truck_idx on public.truck_documents(truck_id, doc_type, expires_on desc);

create table public.service_reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  truck_id uuid not null,
  name text not null check (length(trim(name)) > 1),
  every_km numeric(12,1) check (every_km > 0),
  every_days int check (every_days > 0),
  last_done_km numeric(12,1) check (last_done_km >= 0),
  last_done_on date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (every_km is not null or every_days is not null),
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);

-- ===== Client payments for trips, and driver cash advances =====
create table public.trip_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  customer_id uuid not null,
  trip_id uuid,
  date date not null default public.nairobi_today(),
  method text not null check (method in ('cash', 'mobile', 'bank')),
  reference text,
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null,
  original_amount numeric(18,2) not null check (original_amount > 0),
  amount numeric(16,2) not null,                               -- base currency
  received_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, trip_id) references public.trips(org_id, id),
  foreign key (org_id, received_by) references public.profiles(org_id, id)
);
create index trip_payments_customer_idx on public.trip_payments(customer_id);

create table public.driver_advances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  trip_id uuid not null,
  driver_id uuid not null,
  kind text not null check (kind in ('given', 'returned')),
  date date not null default public.nairobi_today(),
  currency text not null references public.currencies(code),
  fx_rate numeric(20,8) not null,
  original_amount numeric(18,2) not null check (original_amount > 0),
  amount numeric(16,2) not null,                               -- base currency
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, trip_id) references public.trips(org_id, id),
  foreign key (org_id, driver_id) references public.drivers(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);

-- ===== Standard triggers on every new table: org stamp, updated_at, no hard delete, audit =====
do $$ declare t text; begin
  foreach t in array array['trips','trip_lines','truck_recurring_expenses','truck_expenses','truck_documents',
                           'service_reminders','trip_payments','driver_advances'] loop
    execute format('create trigger trg_00_%1$s_org before insert or update on public.%1$s
                    for each row execute function public.enforce_org()', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
    execute format('create trigger trg_%1$s_nodelete before delete on public.%1$s
                    for each row execute function public.block_hard_delete()', t);
    execute format('create trigger trg_%1$s_audit after insert or update on public.%1$s
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

create trigger trg_trip_before before insert or update on public.trips
  for each row execute function public.trip_before_write();

-- Is this trip assigned to the signed-in driver?
create function public.is_my_trip(p_trip uuid) returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (select 1 from public.trips
                 where id = p_trip and org_id = public.current_org_id() and deleted_at is null
                   and driver_id is not null and driver_id = public.current_driver_id())
$$;
grant execute on function public.is_my_trip(uuid) to authenticated;

-- Money on lines, expenses, payments and advances: currency (default: the trip's or base),
-- the rate in force when recorded, and the base amount. Edits keep the original rate.
create function public.money_line_before_write() returns trigger language plpgsql security definer
set search_path = '' as $$
declare m record; v_trip public.trips; v_default text;
begin
  if tg_table_name in ('trip_lines', 'driver_advances') then
    select * into v_trip from public.trips where id = new.trip_id and org_id = new.org_id;
    if not found then raise exception 'Trip not found'; end if;
    if tg_op = 'INSERT' and (v_trip.deleted_at is not null or v_trip.status = 'cancelled') then
      raise exception 'This trip is cancelled or voided';
    end if;
    v_default := v_trip.currency;
  end if;
  if tg_op = 'INSERT' then
    select * into m from public.money_currency(new.org_id, coalesce(new.currency, v_default));
    new.currency := m.currency;
    new.fx_rate := m.fx;
    new.amount := round(new.original_amount / m.fx, 2);
  elsif new.original_amount is distinct from old.original_amount then
    new.amount := round(new.original_amount / old.fx_rate, 2);
  end if;
  return new;
end $$;

create trigger trg_trip_lines_money before insert or update on public.trip_lines
  for each row execute function public.money_line_before_write();
create trigger trg_truck_expenses_money before insert or update on public.truck_expenses
  for each row execute function public.money_line_before_write();
create trigger trg_trip_payments_money before insert or update on public.trip_payments
  for each row execute function public.money_line_before_write();
create trigger trg_driver_advances_money before insert or update on public.driver_advances
  for each row execute function public.money_line_before_write();

-- Who did it, and cross-org checks with friendly messages (composite FKs are the backstop).
create function public.fleet_row_before_insert() returns trigger language plpgsql security definer
set search_path = '' as $$
declare v jsonb := to_jsonb(new);
begin
  if v ? 'created_by' then new := jsonb_populate_record(new, jsonb_build_object('created_by', coalesce(auth.uid(), (v->>'created_by')::uuid))); end if;
  if v ? 'received_by' then new := jsonb_populate_record(new, jsonb_build_object('received_by', coalesce(auth.uid(), (v->>'received_by')::uuid))); end if;
  if v ? 'truck_id' then perform public.assert_same_org('trucks', (v->>'truck_id')::uuid, new.org_id, 'Truck'); end if;
  if v ? 'driver_id' then perform public.assert_same_org('drivers', (v->>'driver_id')::uuid, new.org_id, 'Driver'); end if;
  if v ? 'customer_id' then perform public.assert_same_org('customers', (v->>'customer_id')::uuid, new.org_id, 'Client'); end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['trip_lines','truck_recurring_expenses','truck_expenses','truck_documents',
                           'service_reminders','trip_payments','driver_advances'] loop
    execute format('create trigger trg_%1$s_who before insert on public.%1$s
                    for each row execute function public.fleet_row_before_insert()', t);
  end loop;
end $$;

-- Only the owner records staff pay (driver pay lines, driver salary).
create function public.pay_guard() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.category in ('driver_pay', 'driver_salary') and auth.uid() is not null and not public.is_owner() then
    raise exception 'Only the owner can record staff pay';
  end if;
  -- (to_jsonb: truck expense tables have no "kind" column)
  if to_jsonb(new)->>'kind' = 'income' and auth.uid() is not null and not public.is_fleet_up() then
    raise exception 'Only the owner or a fleet manager can add trip income';
  end if;
  return new;
end $$;
create trigger trg_trip_lines_pay before insert or update of category on public.trip_lines
  for each row execute function public.pay_guard();
create trigger trg_truck_expenses_pay before insert or update of category on public.truck_expenses
  for each row execute function public.pay_guard();
create trigger trg_truck_recurring_pay before insert or update of category on public.truck_recurring_expenses
  for each row execute function public.pay_guard();

-- A truck expense with an odometer reading moves the truck's odometer forward.
create function public.truck_expense_after_insert() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.odometer_km is not null then
    update public.trucks set odometer_km = greatest(odometer_km, new.odometer_km) where id = new.truck_id;
  end if;
  return new;
end $$;
create trigger trg_truck_expenses_odo after insert on public.truck_expenses
  for each row execute function public.truck_expense_after_insert();

-- Client payments can't exceed what the client owes for delivered trips.
create function public.trip_client_owed(p_org uuid, p_customer uuid) returns numeric language sql stable security definer
set search_path = '' as $$
  select coalesce((select sum(t.fee + coalesce((select sum(l.amount) from public.trip_lines l
                                                 where l.trip_id = t.id and l.kind = 'income' and l.deleted_at is null), 0))
                   from public.trips t
                   where t.org_id = p_org and t.customer_id = p_customer and t.status = 'delivered'
                     and t.deleted_at is null and not t.for_own_depot), 0)
       - coalesce((select sum(p.amount) from public.trip_payments p
                   where p.org_id = p_org and p.customer_id = p_customer and p.deleted_at is null), 0)
$$;
create function public.trip_payment_guard() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.trip_id is not null then
    perform 1 from public.trips where id = new.trip_id and org_id = new.org_id and customer_id = new.customer_id;
    if not found then raise exception 'That trip is not for this client'; end if;
  end if;
  if new.amount > public.trip_client_owed(new.org_id, new.customer_id) + 0.01 then
    raise exception 'Payment % is more than the client owes (%)', new.amount, round(public.trip_client_owed(new.org_id, new.customer_id), 2);
  end if;
  return new;
end $$;
-- Runs after the money trigger (alphabetical: trg_trip_payments_money < trg_trip_payments_z_guard).
create trigger trg_trip_payments_z_guard before insert on public.trip_payments
  for each row execute function public.trip_payment_guard();

-- ===== Add stock: shared internal function (used by add_stock and by own-depot trips) =====
create function public.add_stock_internal(
  p_org uuid,
  p_fuel_type_id uuid,
  p_litres numeric,
  p_currency text,
  p_cost_per_litre numeric,
  p_cost_total numeric,
  p_selling_price numeric,
  p_tank_id uuid,
  p_new_tank_name text,
  p_new_tank_capacity numeric,
  p_supplier_id uuid,
  p_new_supplier_name text,
  p_truck_id uuid,
  p_new_truck_plate text,
  p_trip_cost numeric,
  p_date date,
  p_trip_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tank uuid := p_tank_id;
  v_supplier uuid := p_supplier_id;
  v_truck uuid := p_truck_id;
  v_purchase uuid;
  m record;
  t public.tanks;
begin
  perform public.assert_same_org('fuel_types', p_fuel_type_id, p_org, 'Fuel type');
  if p_litres is null or p_litres <= 0 then raise exception 'Enter how many litres arrived'; end if;
  if coalesce(p_date, public.nairobi_today()) > public.nairobi_today() then
    raise exception 'The delivery date cannot be in the future';
  end if;

  if v_tank is null then
    if coalesce(trim(p_new_tank_name), '') = '' or p_new_tank_capacity is null or p_new_tank_capacity <= 0 then
      raise exception 'Give the new tank a name and capacity';
    end if;
    insert into public.tanks(org_id, name, fuel_type_id, capacity_litres, low_stock_level)
    values (p_org, trim(p_new_tank_name), p_fuel_type_id, p_new_tank_capacity, round(p_new_tank_capacity * 0.15))
    returning id into v_tank;
  else
    select * into t from public.tanks where id = v_tank and org_id = p_org and deleted_at is null;
    if not found then raise exception 'Tank not found'; end if;
    if t.fuel_type_id <> p_fuel_type_id then raise exception '% holds a different fuel', t.name; end if;
  end if;

  if v_supplier is null then
    if coalesce(trim(p_new_supplier_name), '') = '' then raise exception 'Choose or add a supplier'; end if;
    insert into public.suppliers(org_id, name) values (p_org, trim(p_new_supplier_name)) returning id into v_supplier;
  end if;
  if v_truck is null then
    if coalesce(trim(p_new_truck_plate), '') = '' then raise exception 'Choose or add a truck'; end if;
    insert into public.trucks(org_id, plate_number, capacity_litres)
    values (p_org, upper(regexp_replace(trim(p_new_truck_plate), '\s+', ' ', 'g')), greatest(p_litres, 1))
    returning id into v_truck;
  end if;

  if p_cost_per_litre is null and p_cost_total is null then raise exception 'Enter the cost per litre or the total cost'; end if;

  insert into public.purchases(org_id, date, supplier_id, truck_id, tank_id, litres, currency,
    original_cost_per_litre, original_fuel_cost, original_trip_cost, cost_per_litre, trip_id)
  values (p_org, coalesce(p_date, public.nairobi_today()), v_supplier, v_truck, v_tank, p_litres, p_currency,
    p_cost_per_litre, p_cost_total, coalesce(p_trip_cost, 0), 0, p_trip_id)
  returning id into v_purchase;

  if p_selling_price is not null then
    if p_selling_price <= 0 then raise exception 'Selling price must be more than 0'; end if;
    select * into m from public.money_currency(p_org, p_currency);
    update public.fuel_types set current_selling_price = p_selling_price / m.fx where id = p_fuel_type_id;
  end if;
  return v_purchase;
end $$;

create or replace function public.add_stock(
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
begin
  if not public.is_manager_up() then raise exception 'Only the owner or a sales manager can add stock'; end if;
  return public.add_stock_internal(public.current_org_id(), p_fuel_type_id, p_litres, p_currency, p_cost_per_litre,
    p_cost_total, p_selling_price, p_tank_id, p_new_tank_name, p_new_tank_capacity, p_supplier_id,
    p_new_supplier_name, p_truck_id, p_new_truck_plate, p_trip_cost, p_date, null);
end $$;

-- ===== Trip lifecycle (internal functions do the work; RPCs check who's asking) =====
create function public.truck_release(p_truck uuid) returns void language sql security definer
set search_path = '' as $$
  update public.trucks set status = 'active'
  where id = p_truck and status = 'on_trip'
    and not exists (select 1 from public.trips where truck_id = p_truck and status = 'on_road' and deleted_at is null)
$$;

create function public.start_trip_internal(p_trip uuid, p_start_odometer numeric, p_override_reason text, p_owner boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips; v_expired text;
begin
  select * into t from public.trips where id = p_trip and deleted_at is null for update;
  if not found then raise exception 'Trip not found'; end if;
  if t.status <> 'planned' then raise exception 'This trip has already started'; end if;
  select string_agg(initcap(d.doc_type) || ' expired on ' || to_char(d.expires_on, 'DD Mon YYYY'), '; ')
    into v_expired
    from (select distinct on (doc_type) doc_type, expires_on from public.truck_documents
          where truck_id = t.truck_id and deleted_at is null and doc_type in ('insurance', 'licence')
          order by doc_type, expires_on desc) d
   where d.expires_on < public.nairobi_today();
  if v_expired is not null then
    if not p_owner or coalesce(trim(p_override_reason), '') = '' then
      raise exception '%. Only the owner can start this trip, with a reason.', v_expired;
    end if;
  end if;
  update public.trips set status = 'on_road', started_at = now(),
    start_odometer = coalesce(p_start_odometer, start_odometer, (select odometer_km from public.trucks where id = t.truck_id)),
    start_override_reason = case when v_expired is not null then trim(p_override_reason) end,
    start_override_by = case when v_expired is not null then auth.uid() end
  where id = p_trip;
  update public.trucks set status = 'on_trip' where id = t.truck_id;
end $$;

create function public.deliver_trip_internal(
  p_trip uuid, p_litres_delivered numeric, p_end_odometer numeric,
  p_tank_id uuid, p_new_tank_name text, p_new_tank_capacity numeric,
  p_cost_per_litre numeric, p_cost_total numeric, p_cost_currency text, p_selling_price numeric,
  p_finish boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips; o public.organizations; v_delivered numeric; v_pct numeric; m record;
begin
  select * into t from public.trips where id = p_trip and deleted_at is null for update;
  if not found then raise exception 'Trip not found'; end if;
  if t.status = 'delivered' then raise exception 'This trip has already been delivered'; end if;
  if t.status = 'cancelled' then raise exception 'This trip was cancelled'; end if;
  select * into o from public.organizations where id = t.org_id;
  v_delivered := coalesce(p_litres_delivered, t.litres_delivered);
  if t.cargo_type = 'fuel' then
    if v_delivered is null then raise exception 'Enter the litres delivered'; end if;
    if t.litres_loaded is null then raise exception 'Enter the litres loaded first'; end if;
    if v_delivered > t.litres_loaded then raise exception 'Delivered litres can''t be more than loaded litres'; end if;
  end if;
  if p_end_odometer is not null and p_end_odometer < coalesce(t.start_odometer, 0) then
    raise exception 'End odometer is below the start reading';
  end if;

  update public.trips set litres_delivered = v_delivered, end_odometer = coalesce(p_end_odometer, end_odometer)
   where id = p_trip;
  if not p_finish then return; end if;   -- a driver's report on an own-depot trip; the office finishes it

  if t.cargo_type = 'fuel' then
    v_pct := case when t.litres_loaded > 0 then (t.litres_loaded - v_delivered) / t.litres_loaded * 100 else 0 end;
    update public.trips set haulage_status = case when v_pct > o.haulage_tolerance_pct then 'disputed' else 'ok' end
     where id = p_trip;
  end if;

  if t.for_own_depot then
    if exists (select 1 from public.purchases where trip_id = p_trip and deleted_at is null) then
      raise exception 'This trip''s fuel is already in stock';
    end if;
    if t.supplier_id is null then raise exception 'Pick the supplier the fuel was loaded from'; end if;
    -- The trip's own fee (an internal charge, often 0) is the depot's transport cost.
    select * into m from public.money_currency(t.org_id, p_cost_currency);
    perform public.add_stock_internal(t.org_id, t.fuel_type_id, v_delivered, m.currency, p_cost_per_litre, p_cost_total,
      p_selling_price, coalesce(p_tank_id, t.tank_id), p_new_tank_name, p_new_tank_capacity, t.supplier_id, null,
      t.truck_id, null, round(t.fee * m.fx, 2), null, p_trip);
  end if;

  update public.trips set status = 'delivered', delivered_at = now(), started_at = coalesce(started_at, now())
   where id = p_trip;
  update public.trucks set odometer_km = greatest(odometer_km, coalesce(p_end_odometer, t.end_odometer, 0)) where id = t.truck_id;
  perform public.truck_release(t.truck_id);
end $$;

create function public.start_trip(p_trip uuid, p_start_odometer numeric default null, p_override_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.trips where id = p_trip and org_id = public.current_org_id()) then
    raise exception 'Trip not found';
  end if;
  if not (public.is_fleet_up() or public.is_my_trip(p_trip)) then raise exception 'Not allowed'; end if;
  perform public.start_trip_internal(p_trip, p_start_odometer, p_override_reason, public.is_owner());
end $$;

create function public.record_delivery(
  p_trip uuid,
  p_litres_delivered numeric default null,
  p_end_odometer numeric default null,
  p_tank_id uuid default null,
  p_new_tank_name text default null,
  p_new_tank_capacity numeric default null,
  p_cost_per_litre numeric default null,
  p_cost_total numeric default null,
  p_cost_currency text default null,
  p_selling_price numeric default null
) returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips;
begin
  select * into t from public.trips where id = p_trip and org_id = public.current_org_id();
  if not found then raise exception 'Trip not found'; end if;
  if public.is_fleet_up() then
    perform public.deliver_trip_internal(p_trip, p_litres_delivered, p_end_odometer, p_tank_id, p_new_tank_name,
      p_new_tank_capacity, p_cost_per_litre, p_cost_total, p_cost_currency, p_selling_price, true);
  elsif public.is_my_trip(p_trip) then
    -- Drivers report litres and odometer. Client trips are then delivered; own-depot trips wait
    -- for the office to put the fuel into stock.
    perform public.deliver_trip_internal(p_trip, p_litres_delivered, p_end_odometer, null, null, null,
      null, null, null, null, not t.for_own_depot);
  else
    raise exception 'Not allowed';
  end if;
end $$;

create function public.cancel_trip(p_trip uuid, p_reason text) returns void language plpgsql security definer
set search_path = '' as $$
declare t public.trips;
begin
  if not public.is_fleet_up() then raise exception 'Only the owner or a fleet manager can cancel a trip'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling'; end if;
  select * into t from public.trips where id = p_trip and org_id = public.current_org_id() and deleted_at is null for update;
  if not found then raise exception 'Trip not found'; end if;
  if t.status not in ('planned', 'on_road') then raise exception 'Only planned or ongoing trips can be cancelled'; end if;
  update public.trips set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_trip;
  perform public.truck_release(t.truck_id);
end $$;

create function public.void_trip(p_trip uuid, p_reason text) returns void language plpgsql security definer
set search_path = '' as $$
declare t public.trips;
begin
  if not public.is_fleet_up() then raise exception 'Only the owner or a fleet manager can void a trip'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding this trip'; end if;
  select * into t from public.trips where id = p_trip and org_id = public.current_org_id() and deleted_at is null for update;
  if not found then raise exception 'Trip not found'; end if;
  -- Fuel that went into our tank comes back out (fails if it has already been sold).
  update public.purchases set deleted_at = now() where trip_id = p_trip and deleted_at is null;
  update public.trips set deleted_at = now(), void_reason = trim(p_reason) where id = p_trip;
  perform public.truck_release(t.truck_id);
end $$;

create function public.set_haulage_status(p_trip uuid, p_status text, p_note text) returns void language plpgsql
security definer set search_path = '' as $$
begin
  if not public.is_fleet_up() then raise exception 'Not allowed'; end if;
  if p_status not in ('ok', 'disputed', 'resolved') then raise exception 'Unknown status'; end if;
  if p_status <> 'ok' and coalesce(trim(p_note), '') = '' then raise exception 'Add a note'; end if;
  update public.trips set haulage_status = p_status, dispute_note = nullif(trim(p_note), '')
   where id = p_trip and org_id = public.current_org_id() and cargo_type = 'fuel' and deleted_at is null;
  if not found then raise exception 'Fuel trip not found'; end if;
end $$;

create function public.mark_service_done(p_reminder uuid, p_odometer numeric default null, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.service_reminders;
begin
  if not public.is_fleet_up() then raise exception 'Not allowed'; end if;
  select * into r from public.service_reminders where id = p_reminder and org_id = public.current_org_id() and deleted_at is null;
  if not found then raise exception 'Reminder not found'; end if;
  update public.service_reminders
     set last_done_km = coalesce(p_odometer, (select odometer_km from public.trucks where id = r.truck_id)),
         last_done_on = coalesce(p_date, public.nairobi_today())
   where id = p_reminder;
  if p_odometer is not null then
    update public.trucks set odometer_km = greatest(odometer_km, p_odometer) where id = r.truck_id;
  end if;
end $$;

-- Post repeating truck expenses that have come due (idempotent; safe to call on page load).
create function public.post_recurring_expenses() returns int language plpgsql security definer
set search_path = '' as $$
declare r public.truck_recurring_expenses; v_count int := 0; v_due date;
begin
  if not public.is_fleet_up() then return 0; end if;
  for r in select * from public.truck_recurring_expenses
           where org_id = public.current_org_id() and active and deleted_at is null and next_due <= public.nairobi_today()
           for update loop
    v_due := r.next_due;
    while v_due <= public.nairobi_today() loop
      insert into public.truck_expenses(org_id, truck_id, date, category, description, driver_id, currency,
        original_amount, recurring_id, created_by)
      values (r.org_id, r.truck_id, v_due, r.category, r.description, r.driver_id, r.currency, r.original_amount, r.id, r.created_by);
      v_count := v_count + 1;
      v_due := (v_due + interval '1 month')::date;
    end loop;
    update public.truck_recurring_expenses set next_due = v_due where id = r.id;
  end loop;
  return v_count;
end $$;

-- ===== Grants and row level security =====
alter table public.trips enable row level security;
alter table public.trip_lines enable row level security;
alter table public.truck_recurring_expenses enable row level security;
alter table public.truck_expenses enable row level security;
alter table public.truck_documents enable row level security;
alter table public.service_reminders enable row level security;
alter table public.trip_payments enable row level security;
alter table public.driver_advances enable row level security;

revoke all on public.trips, public.trip_lines, public.truck_recurring_expenses, public.truck_expenses,
  public.truck_documents, public.service_reminders, public.trip_payments, public.driver_advances from anon, authenticated;

grant select on public.trips, public.trip_lines, public.truck_recurring_expenses, public.truck_expenses,
  public.truck_documents, public.service_reminders, public.trip_payments, public.driver_advances to authenticated;

grant insert (date, truck_id, driver_id, customer_id, for_own_depot, route_from, route_to, cargo_type, currency,
  fee_original, notes, fuel_type_id, litres_loaded, loaded_from, loading_ticket, supplier_id, tank_id, start_odometer)
  on public.trips to authenticated;
grant update (date, truck_id, driver_id, customer_id, for_own_depot, route_from, route_to, cargo_type,
  fee_original, notes, fuel_type_id, litres_loaded, loaded_from, loading_ticket, supplier_id, tank_id, start_odometer)
  on public.trips to authenticated;

grant insert (trip_id, kind, category, description, currency, original_amount, litres, driver_id, paid_from_advance, receipt_path)
  on public.trip_lines to authenticated;
grant update (description, original_amount, receipt_path, deleted_at) on public.trip_lines to authenticated;

grant insert (truck_id, date, category, description, litres, odometer_km, workshop, driver_id, currency, original_amount, receipt_path)
  on public.truck_expenses to authenticated;
grant update (description, original_amount, receipt_path, workshop, deleted_at) on public.truck_expenses to authenticated;

grant insert (truck_id, category, description, driver_id, currency, original_amount, next_due)
  on public.truck_recurring_expenses to authenticated;
grant update (description, original_amount, next_due, active, deleted_at) on public.truck_recurring_expenses to authenticated;

grant insert (truck_id, doc_type, reference, expires_on, notes, file_path) on public.truck_documents to authenticated;
grant update (reference, expires_on, notes, file_path, deleted_at) on public.truck_documents to authenticated;

grant insert (truck_id, name, every_km, every_days, last_done_km, last_done_on, notes) on public.service_reminders to authenticated;
grant update (name, every_km, every_days, notes, deleted_at) on public.service_reminders to authenticated;

grant insert (customer_id, trip_id, date, method, reference, currency, original_amount) on public.trip_payments to authenticated;
grant update (deleted_at) on public.trip_payments to authenticated;

grant insert (trip_id, driver_id, kind, date, currency, original_amount) on public.driver_advances to authenticated;
grant update (deleted_at) on public.driver_advances to authenticated;

-- Trips: owner and fleet manager. Drivers use driver_trips (no fee) and the RPCs.
create policy trips_read on public.trips for select
  using (org_id = public.current_org_id() and public.is_fleet_up());
create policy trips_insert on public.trips for insert
  with check (org_id = public.current_org_id() and public.is_fleet_up());
create policy trips_update on public.trips for update
  using (org_id = public.current_org_id() and public.is_fleet_up() and deleted_at is null)
  with check (org_id = public.current_org_id() and public.is_fleet_up());

-- Trip lines: staff pay only for the owner; drivers see and add expenses on their own trips.
create policy trip_lines_read on public.trip_lines for select
  using (org_id = public.current_org_id() and (
    public.is_owner()
    or (category <> 'driver_pay' and (public.is_fleet_up() or (public.app_role() = 'driver' and public.is_my_trip(trip_id))))));
create policy trip_lines_insert on public.trip_lines for insert
  with check (org_id = public.current_org_id() and (
    public.is_fleet_up()
    or (public.app_role() = 'driver' and kind = 'expense' and public.is_my_trip(trip_id))));
create policy trip_lines_update on public.trip_lines for update
  using (org_id = public.current_org_id() and (public.is_owner() or (public.is_fleet_up() and category <> 'driver_pay')))
  with check (org_id = public.current_org_id() and public.is_fleet_up());

do $$ declare t text; begin
  foreach t in array array['truck_expenses','truck_recurring_expenses'] loop
    execute format('create policy %1$s_read on public.%1$s for select
      using (org_id = public.current_org_id() and (public.is_owner() or (public.is_fleet_up() and category <> ''driver_salary'')))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert
      with check (org_id = public.current_org_id() and public.is_fleet_up())', t);
    execute format('create policy %1$s_update on public.%1$s for update
      using (org_id = public.current_org_id() and (public.is_owner() or (public.is_fleet_up() and category <> ''driver_salary'')))
      with check (org_id = public.current_org_id() and public.is_fleet_up())', t);
  end loop;
  foreach t in array array['truck_documents','service_reminders'] loop
    execute format('create policy %1$s_read on public.%1$s for select
      using (org_id = public.current_org_id() and public.can_manage_assets())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert
      with check (org_id = public.current_org_id() and public.is_fleet_up())', t);
    execute format('create policy %1$s_update on public.%1$s for update
      using (org_id = public.current_org_id() and public.is_fleet_up())
      with check (org_id = public.current_org_id() and public.is_fleet_up())', t);
  end loop;
end $$;

create policy trip_payments_read on public.trip_payments for select
  using (org_id = public.current_org_id() and public.is_fleet_up());
create policy trip_payments_insert on public.trip_payments for insert
  with check (org_id = public.current_org_id() and public.is_fleet_up());
create policy trip_payments_void on public.trip_payments for update
  using (org_id = public.current_org_id() and public.is_owner())
  with check (org_id = public.current_org_id() and public.is_owner());

create policy driver_advances_read on public.driver_advances for select
  using (org_id = public.current_org_id() and (public.is_fleet_up() or (public.app_role() = 'driver' and public.is_my_trip(trip_id))));
create policy driver_advances_insert on public.driver_advances for insert
  with check (org_id = public.current_org_id() and public.is_fleet_up());
create policy driver_advances_void on public.driver_advances for update
  using (org_id = public.current_org_id() and public.is_fleet_up())
  with check (org_id = public.current_org_id() and public.is_fleet_up());

-- ===== Views =====
-- Driver's phone view: own trips only, no fee or client money.
create view public.driver_trips as
  select t.id, t.org_id, t.trip_no, t.date, t.truck_id, t.route_from, t.route_to, t.cargo_type, t.status,
         t.fuel_type_id, t.litres_loaded, t.litres_delivered, t.loading_ticket, t.start_odometer, t.end_odometer,
         t.for_own_depot, t.currency, t.notes,
         (select plate_number from public.trucks k where k.id = t.truck_id) as plate_number,
         (select name from public.customers c where c.id = t.customer_id) as client_name
  from public.trips t
  where t.deleted_at is null and t.org_id = public.current_org_id()
    and t.driver_id is not null and t.driver_id = public.current_driver_id();

-- Trip money per trip (owner only): income, expenses, third-party payout, profit, per km.
create view public.trip_financials with (security_invoker = true) as
with l as (
  select trip_id,
         coalesce(sum(amount) filter (where kind = 'income'), 0) as extras,
         coalesce(sum(amount) filter (where kind = 'expense'), 0) as expenses
  from public.trip_lines where deleted_at is null and org_id = public.current_org_id()
  group by trip_id)
select t.id as trip_id, t.org_id, t.trip_no, t.date, t.delivered_at, t.status, t.truck_id, t.driver_id, t.customer_id,
  t.for_own_depot, t.cargo_type, t.currency, t.fx_rate, t.fee_original, t.fee,
  coalesce(l.extras, 0) as extras,
  t.fee + coalesce(l.extras, 0) as income,
  case when t.status = 'delivered' then t.fee + coalesce(l.extras, 0) else 0 end as earned_income,
  coalesce(l.expenses, 0) as trip_expenses,
  case when t.status = 'delivered' and k.ownership = 'third_party' then
    case k.payout_type when 'fixed_per_trip' then k.payout_value
                       else round((t.fee + coalesce(l.extras, 0)) * k.payout_value / 100, 2) end
  else 0 end as owner_payout,
  t.end_odometer - t.start_odometer as km,
  t.litres_loaded, t.litres_delivered, t.shortage_litres,
  coalesce((t.delivered_at at time zone 'Africa/Nairobi')::date, t.date) as report_date
from public.trips t
join public.trucks k on k.id = t.truck_id
left join l on l.trip_id = t.id
where t.deleted_at is null and t.org_id = public.current_org_id() and public.is_owner();

-- Profit is a separate step so the expression stays readable.
create view public.trip_profit with (security_invoker = true) as
select f.*, f.earned_income - f.trip_expenses - f.owner_payout as profit,
  case when coalesce(f.km, 0) > 0 then round((f.earned_income - f.trip_expenses - f.owner_payout) / f.km, 4) end as profit_per_km
from public.trip_financials f;

-- Trucks P&L by day (owner only), for the dashboard's Depot / Trucks / Combined toggle.
create view public.truck_daily_summary with (security_invoker = true) as
with t as (
  select report_date as date, sum(earned_income) as income, sum(trip_expenses) as trip_expenses, sum(owner_payout) as payouts
  from public.trip_financials where status <> 'planned' group by report_date),
x as (
  select date, sum(amount) as truck_expenses from public.truck_expenses
  where deleted_at is null and org_id = public.current_org_id() group by date)
select date,
  coalesce(t.income, 0) as income,
  coalesce(t.trip_expenses, 0) as trip_expenses,
  coalesce(t.payouts, 0) as payouts,
  coalesce(x.truck_expenses, 0) as truck_expenses,
  coalesce(t.income, 0) - coalesce(t.trip_expenses, 0) - coalesce(t.payouts, 0) - coalesce(x.truck_expenses, 0) as net_profit
from t full join x using (date)
where public.is_owner();

-- What each client owes for delivered trips (owner and fleet manager; no profit).
create view public.trip_client_balances as
with billed as (
  select t.customer_id,
         sum(t.fee + coalesce((select sum(l.amount) from public.trip_lines l
                               where l.trip_id = t.id and l.kind = 'income' and l.deleted_at is null), 0)) as billed,
         sum(case when t.delivered_at >= now() - make_interval(days => c.credit_terms_days)
                  then t.fee + coalesce((select sum(l.amount) from public.trip_lines l
                                         where l.trip_id = t.id and l.kind = 'income' and l.deleted_at is null), 0)
                  else 0 end) as billed_recent,
         count(*) as trips,
         min(t.delivered_at) as first_delivered
  from public.trips t join public.customers c on c.id = t.customer_id
  where t.org_id = public.current_org_id() and t.status = 'delivered' and t.deleted_at is null and not t.for_own_depot
  group by t.customer_id),
paid as (
  select customer_id, sum(amount) as paid from public.trip_payments
  where org_id = public.current_org_id() and deleted_at is null group by customer_id)
select c.id as customer_id, c.org_id, c.name, c.phone, c.credit_terms_days,
  coalesce(b.trips, 0) as trips,
  coalesce(b.billed, 0) as billed,
  coalesce(p.paid, 0) as paid,
  coalesce(b.billed, 0) - coalesce(p.paid, 0) as owed,
  greatest(0, coalesce(b.billed, 0) - coalesce(p.paid, 0) - coalesce(b.billed_recent, 0)) as overdue
from public.customers c
left join billed b on b.customer_id = c.id
left join paid p on p.customer_id = c.id
where c.org_id = public.current_org_id() and c.deleted_at is null and public.is_fleet_up()
  and (b.customer_id is not null or p.customer_id is not null);

revoke all on public.driver_trips, public.trip_financials, public.trip_profit, public.truck_daily_summary,
  public.trip_client_balances from anon, public;
grant select on public.driver_trips, public.trip_financials, public.trip_profit, public.truck_daily_summary,
  public.trip_client_balances to authenticated;

-- ===== Function permissions =====
revoke execute on function
  public.add_stock_internal(uuid, uuid, numeric, text, numeric, numeric, numeric, uuid, text, numeric, uuid, text, uuid, text, numeric, date, uuid),
  public.start_trip_internal(uuid, numeric, text, boolean),
  public.deliver_trip_internal(uuid, numeric, numeric, uuid, text, numeric, numeric, numeric, text, numeric, boolean),
  public.truck_release(uuid), public.trip_client_owed(uuid, uuid),
  public.trip_before_write(), public.money_line_before_write(), public.fleet_row_before_insert(), public.pay_guard(),
  public.truck_expense_after_insert(), public.trip_payment_guard()
  from public, anon, authenticated;
revoke execute on function public.start_trip(uuid, numeric, text), public.record_delivery(uuid, numeric, numeric, uuid, text, numeric, numeric, numeric, text, numeric),
  public.cancel_trip(uuid, text), public.void_trip(uuid, text), public.set_haulage_status(uuid, text, text),
  public.mark_service_done(uuid, numeric, date), public.post_recurring_expenses() from public, anon;
grant execute on function public.start_trip(uuid, numeric, text), public.record_delivery(uuid, numeric, numeric, uuid, text, numeric, numeric, numeric, text, numeric),
  public.cancel_trip(uuid, text), public.void_trip(uuid, text), public.set_haulage_status(uuid, text, text),
  public.mark_service_done(uuid, numeric, date), public.post_recurring_expenses() to authenticated;

-- ===== Receipt photos (Supabase Storage). Skipped where there is no storage schema (tests). =====
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
    -- Files live under <org_id>/... and only that org's staff (not attendants) can read or add them.
    execute $p$create policy receipts_read on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_org_id()::text
             and public.app_role() in ('owner', 'manager', 'fleet_manager', 'driver'))$p$;
    execute $p$create policy receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.current_org_id()::text
                  and public.app_role() in ('owner', 'manager', 'fleet_manager', 'driver'))$p$;
  end if;
end $$;
