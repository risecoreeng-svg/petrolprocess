-- PetroTrack: types and tables
-- Every business table carries created_at / updated_at / deleted_at (soft delete only).

create type public.user_role        as enum ('owner','manager','attendant');
create type public.truck_status     as enum ('active','maintenance','on_trip');
create type public.payment_type     as enum ('cash','mpesa','credit');
create type public.expense_category as enum ('salaries','rent','electricity','licences',
  'maintenance','truck_repairs','truck_fuel','security','other');

create function public.nairobi_today() returns date language sql stable
as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

create table public.profiles (
  id uuid primary key references auth.users(id),
  full_name text not null,
  role public.user_role not null default 'attendant',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  licence_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  capacity_litres numeric(12,2) not null check (capacity_litres > 0),
  driver_id uuid references public.drivers(id),
  status public.truck_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.fuel_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('Petrol','Diesel','Kerosene')),
  current_selling_price numeric(12,2) not null check (current_selling_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.tanks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fuel_type_id uuid not null references public.fuel_types(id),
  capacity_litres numeric(12,2) not null check (capacity_litres > 0),
  current_litres numeric(12,2) not null default 0,
  low_stock_level numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (current_litres >= 0 and current_litres <= capacity_litres)
);

-- Weighted-average landed cost per tank. Owner-only; kept apart so cost never leaks via tanks.
create table public.tank_costing (
  tank_id uuid primary key references public.tanks(id),
  avg_cost_per_litre numeric(12,4) not null check (avg_cost_per_litre >= 0),
  updated_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  date date not null default public.nairobi_today(),
  supplier_id uuid not null references public.suppliers(id),
  truck_id uuid not null references public.trucks(id),
  tank_id uuid not null references public.tanks(id),
  fuel_type_id uuid not null references public.fuel_types(id),
  litres numeric(12,2) not null check (litres > 0),
  cost_per_litre numeric(12,4) not null check (cost_per_litre > 0),
  fuel_cost numeric(14,2) generated always as (round(litres * cost_per_litre, 2)) stored,
  trip_cost numeric(14,2) not null default 0 check (trip_cost >= 0),
  landed_cost_per_litre numeric(12,4) generated always as
    (round((litres * cost_per_litre + trip_cost) / litres, 4)) stored,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  credit_terms_days int not null default 30 check (credit_terms_days > 0),
  balance numeric(14,2) not null default 0,          -- maintained by triggers only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  attendant_id uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expected_cash numeric(14,2),
  cash_handed_in numeric(14,2),
  variance numeric(14,2) generated always as (cash_handed_in - expected_cash) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index one_open_shift on public.shifts(attendant_id)
  where ended_at is null and deleted_at is null;

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  date date not null default public.nairobi_today(),
  tank_id uuid not null references public.tanks(id),
  fuel_type_id uuid not null references public.fuel_types(id),   -- forced to the tank's type
  litres numeric(12,2) not null check (litres > 0),
  price_per_litre numeric(12,2) not null check (price_per_litre >= 0),
  total numeric(14,2) generated always as (round(litres * price_per_litre, 2)) stored,
  cost_per_litre numeric(12,4) not null,                          -- weighted average, set by trigger
  cost_total numeric(14,2) generated always as (round(litres * cost_per_litre, 2)) stored,
  payment_type public.payment_type not null,
  customer_id uuid references public.customers(id),
  mpesa_ref text,
  attendant_id uuid not null references public.profiles(id),
  shift_id uuid references public.shifts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((payment_type = 'credit') = (customer_id is not null)),
  check (payment_type <> 'mpesa' or mpesa_ref is not null)
);
create unique index sales_mpesa_ref_uq on public.sales(mpesa_ref)
  where mpesa_ref is not null and deleted_at is null;

create table public.credit_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','mpesa')),
  date date not null default public.nairobi_today(),
  received_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default public.nairobi_today(),
  category public.expense_category not null,
  amount numeric(14,2) not null check (amount > 0),
  truck_id uuid references public.trucks(id),
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  tank_id uuid not null references public.tanks(id),
  date date not null default public.nairobi_today(),
  system_litres numeric(12,2) not null,                           -- set by trigger
  dip_litres numeric(12,2) not null check (dip_litres >= 0),
  difference numeric(12,2) generated always as (dip_litres - system_litres) stored,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,           -- INSERT | UPDATE | SOFT_DELETE | RESTORE
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index sales_date_idx on public.sales(date);
create index sales_customer_idx on public.sales(customer_id);
create index sales_shift_idx on public.sales(shift_id);
create index purchases_date_idx on public.purchases(date);
create index purchases_truck_idx on public.purchases(truck_id);
create index expenses_date_idx on public.expenses(date);
create index expenses_truck_idx on public.expenses(truck_id);
create index audit_log_record_idx on public.audit_log(table_name, record_id);
create index audit_log_created_idx on public.audit_log(created_at desc);
