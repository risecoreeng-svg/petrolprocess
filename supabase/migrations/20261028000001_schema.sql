-- PetroTrack: types and tables (multi-tenant).
-- Every business table carries org_id plus created_at / updated_at / deleted_at (soft delete only).
-- Parents expose unique (org_id, id) and children reference them with composite foreign keys,
-- so a row can never point at a truck / tank / customer / profile in another organization.

create type public.user_role        as enum ('owner','manager','attendant');
create type public.truck_status     as enum ('active','maintenance','on_trip');
create type public.payment_type     as enum ('cash','mpesa','credit');
create type public.expense_category as enum ('salaries','rent','electricity','licences',
  'maintenance','truck_repairs','truck_fuel','security','other');

create function public.nairobi_today() returns date language sql stable
as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id),
  org_id uuid not null references public.organizations(id),
  full_name text not null,
  role public.user_role not null default 'attendant',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id)
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  phone text,
  licence_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id)
);

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  plate_number text not null,
  capacity_litres numeric(12,2) not null check (capacity_litres > 0),
  driver_id uuid,
  status public.truck_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  unique (org_id, plate_number),
  foreign key (org_id, driver_id) references public.drivers(org_id, id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  phone text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id)
);

create table public.fuel_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null check (name in ('Petrol','Diesel','Kerosene')),
  current_selling_price numeric(12,2) not null check (current_selling_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  unique (org_id, name)
);

create table public.tanks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  fuel_type_id uuid not null,
  capacity_litres numeric(12,2) not null check (capacity_litres > 0),
  current_litres numeric(12,2) not null default 0,
  low_stock_level numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (current_litres >= 0 and current_litres <= capacity_litres),
  unique (org_id, id),
  foreign key (org_id, fuel_type_id) references public.fuel_types(org_id, id)
);

-- Weighted-average landed cost per tank. Owner-only; kept apart so cost never leaks via tanks.
create table public.tank_costing (
  tank_id uuid primary key,
  org_id uuid not null references public.organizations(id),
  avg_cost_per_litre numeric(12,4) not null check (avg_cost_per_litre >= 0),
  updated_at timestamptz not null default now(),
  foreign key (org_id, tank_id) references public.tanks(org_id, id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  date date not null default public.nairobi_today(),
  supplier_id uuid not null,
  truck_id uuid not null,
  tank_id uuid not null,
  fuel_type_id uuid not null,
  litres numeric(12,2) not null check (litres > 0),
  cost_per_litre numeric(12,4) not null check (cost_per_litre > 0),
  fuel_cost numeric(14,2) generated always as (round(litres * cost_per_litre, 2)) stored,
  trip_cost numeric(14,2) not null default 0 check (trip_cost >= 0),
  landed_cost_per_litre numeric(12,4) generated always as
    (round((litres * cost_per_litre + trip_cost) / litres, 4)) stored,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, supplier_id) references public.suppliers(org_id, id),
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, tank_id) references public.tanks(org_id, id),
  foreign key (org_id, fuel_type_id) references public.fuel_types(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  phone text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  credit_terms_days int not null default 30 check (credit_terms_days > 0),
  balance numeric(14,2) not null default 0,          -- maintained by triggers only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  attendant_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expected_cash numeric(14,2),
  cash_handed_in numeric(14,2),
  variance numeric(14,2) generated always as (cash_handed_in - expected_cash) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, attendant_id) references public.profiles(org_id, id)
);
create unique index one_open_shift on public.shifts(attendant_id)
  where ended_at is null and deleted_at is null;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  date date not null default public.nairobi_today(),
  tank_id uuid not null,
  fuel_type_id uuid not null,                                     -- forced to the tank's type
  litres numeric(12,2) not null check (litres > 0),
  price_per_litre numeric(12,2) not null check (price_per_litre >= 0),
  total numeric(14,2) generated always as (round(litres * price_per_litre, 2)) stored,
  cost_per_litre numeric(12,4) not null,                          -- weighted average, set by trigger
  cost_total numeric(14,2) generated always as (round(litres * cost_per_litre, 2)) stored,
  payment_type public.payment_type not null,
  customer_id uuid,
  mpesa_ref text,
  attendant_id uuid not null,
  shift_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((payment_type = 'credit') = (customer_id is not null)),
  check (payment_type <> 'mpesa' or mpesa_ref is not null),
  foreign key (org_id, tank_id) references public.tanks(org_id, id),
  foreign key (org_id, fuel_type_id) references public.fuel_types(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, attendant_id) references public.profiles(org_id, id),
  foreign key (org_id, shift_id) references public.shifts(org_id, id)
);
create unique index sales_mpesa_ref_uq on public.sales(org_id, mpesa_ref)
  where mpesa_ref is not null and deleted_at is null;

create table public.credit_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  customer_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','mpesa')),
  date date not null default public.nairobi_today(),
  received_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, received_by) references public.profiles(org_id, id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  date date not null default public.nairobi_today(),
  category public.expense_category not null,
  amount numeric(14,2) not null check (amount > 0),
  truck_id uuid,
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, truck_id) references public.trucks(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  tank_id uuid not null,
  date date not null default public.nairobi_today(),
  system_litres numeric(12,2) not null,                           -- set by trigger
  dip_litres numeric(12,2) not null check (dip_litres >= 0),
  difference numeric(12,2) generated always as (dip_litres - system_litres) stored,
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (org_id, tank_id) references public.tanks(org_id, id),
  foreign key (org_id, created_by) references public.profiles(org_id, id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,           -- INSERT | UPDATE | SOFT_DELETE | RESTORE
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- org_id indexes (composite uniques above already index (org_id, id) on parent tables)
create index profiles_org_idx on public.profiles(org_id);
create index tank_costing_org_idx on public.tank_costing(org_id);
create index purchases_org_date_idx on public.purchases(org_id, date);
create index purchases_truck_idx on public.purchases(truck_id);
create index shifts_org_idx on public.shifts(org_id, started_at desc);
create index sales_org_date_idx on public.sales(org_id, date);
create index sales_customer_idx on public.sales(customer_id);
create index sales_shift_idx on public.sales(shift_id);
create index credit_payments_org_idx on public.credit_payments(org_id, created_at desc);
create index credit_payments_customer_idx on public.credit_payments(customer_id);
create index expenses_org_date_idx on public.expenses(org_id, date);
create index expenses_truck_idx on public.expenses(truck_id);
create index stock_adjustments_org_idx on public.stock_adjustments(org_id, created_at desc);
create index audit_log_org_created_idx on public.audit_log(org_id, created_at desc);
create index audit_log_record_idx on public.audit_log(table_name, record_id);
