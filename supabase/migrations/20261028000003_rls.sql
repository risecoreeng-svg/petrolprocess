-- PetroTrack: grants and row level security, scoped to the caller's organization.
-- Every policy requires org_id = current_org_id(); current_org_id() is NULL for signed-out,
-- inactive or deleted users, so they match nothing.
-- Column-level grants stop clients writing system-maintained columns
-- (org_id, current_litres, balance, costs). No DELETE is granted on anything.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;

alter table public.organizations     enable row level security;
alter table public.profiles          enable row level security;
alter table public.drivers           enable row level security;
alter table public.trucks            enable row level security;
alter table public.suppliers         enable row level security;
alter table public.fuel_types        enable row level security;
alter table public.tanks             enable row level security;
alter table public.tank_costing      enable row level security;
alter table public.purchases         enable row level security;
alter table public.customers         enable row level security;
alter table public.shifts            enable row level security;
alter table public.sales             enable row level security;
alter table public.credit_payments   enable row level security;
alter table public.expenses          enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.audit_log         enable row level security;

-- ===== Grants =====
grant select on public.organizations, public.profiles, public.drivers, public.trucks,
  public.suppliers, public.fuel_types, public.tanks, public.customers, public.shifts,
  public.credit_payments, public.expenses, public.stock_adjustments, public.purchases,
  public.sales, public.tank_costing, public.audit_log to authenticated;

grant update (name) on public.organizations to authenticated;
grant update (full_name, role, active, deleted_at) on public.profiles to authenticated;

grant insert (name, phone, licence_no) on public.drivers to authenticated;
grant update (name, phone, licence_no, deleted_at) on public.drivers to authenticated;
grant insert (plate_number, capacity_litres, driver_id, status, notes) on public.trucks to authenticated;
grant update (plate_number, capacity_litres, driver_id, status, notes, deleted_at) on public.trucks to authenticated;
grant insert (name, phone, location) on public.suppliers to authenticated;
grant update (name, phone, location, deleted_at) on public.suppliers to authenticated;
grant insert (name, current_selling_price) on public.fuel_types to authenticated;
grant update (current_selling_price, deleted_at) on public.fuel_types to authenticated;
grant insert (name, fuel_type_id, capacity_litres, low_stock_level) on public.tanks to authenticated;
grant update (name, fuel_type_id, capacity_litres, low_stock_level, deleted_at) on public.tanks to authenticated;
grant insert (name, phone, credit_limit, credit_terms_days) on public.customers to authenticated;
grant update (name, phone, credit_limit, credit_terms_days, deleted_at) on public.customers to authenticated;
grant insert (date, category, amount, truck_id, description) on public.expenses to authenticated;
grant update (date, category, amount, truck_id, description, deleted_at) on public.expenses to authenticated;

-- Transactions: insert the business fields only; system fields are set by triggers.
grant insert (date, supplier_id, truck_id, tank_id, fuel_type_id, litres, cost_per_litre, trip_cost)
  on public.purchases to authenticated;
grant insert (date, tank_id, fuel_type_id, litres, price_per_litre, payment_type, customer_id,
  mpesa_ref, attendant_id, shift_id) on public.sales to authenticated;
grant insert (customer_id, amount, method, date) on public.credit_payments to authenticated;
grant insert (tank_id, date, dip_litres, reason, system_litres) on public.stock_adjustments to authenticated;
-- Transactions can only be voided, never edited.
grant update (deleted_at) on public.purchases, public.sales, public.credit_payments to authenticated;

grant execute on function public.current_org_id(), public.app_role(), public.is_owner(),
  public.is_manager_up(), public.nairobi_today() to authenticated;
grant execute on function public.start_shift(), public.end_shift(uuid, numeric) to authenticated;

-- ===== Policies =====
create policy organizations_read on public.organizations for select
  using (id = public.current_org_id());
create policy organizations_update on public.organizations for update
  using (id = public.current_org_id() and public.is_owner())
  with check (id = public.current_org_id() and public.is_owner());

-- Owners manage staff in their own org: never themselves, and never promote to owner.
create policy profiles_read on public.profiles for select
  using (org_id = public.current_org_id() and (id = auth.uid() or public.is_manager_up()));
create policy profiles_update on public.profiles for update
  using (org_id = public.current_org_id() and public.is_owner() and id <> auth.uid())
  with check (org_id = public.current_org_id() and public.is_owner() and id <> auth.uid()
              and role <> 'owner');

-- Reference data: any active staff in the org can read, owner/manager can write.
do $$ declare t text; begin
  foreach t in array array['drivers','trucks','suppliers','fuel_types','tanks'] loop
    execute format('create policy %1$s_read on public.%1$s for select
      using (org_id = public.current_org_id() and (deleted_at is null or public.is_owner()))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert
      with check (org_id = public.current_org_id() and public.is_manager_up())', t);
    execute format('create policy %1$s_update on public.%1$s for update
      using (org_id = public.current_org_id() and public.is_manager_up())
      with check (org_id = public.current_org_id() and public.is_manager_up())', t);
  end loop;
end $$;

-- Cost basis: owner only.
create policy tank_costing_read on public.tank_costing for select
  using (org_id = public.current_org_id() and public.is_owner());

-- Purchases: base table (with cost) owner-only to read; managers insert; owner voids.
create policy purchases_read on public.purchases for select
  using (org_id = public.current_org_id() and public.is_owner());
create policy purchases_insert on public.purchases for insert
  with check (org_id = public.current_org_id() and public.is_manager_up());
create policy purchases_void on public.purchases for update
  using (org_id = public.current_org_id() and public.is_owner())
  with check (org_id = public.current_org_id() and public.is_owner());

-- Sales: base table owner-only to read; all staff insert as themselves; owner voids.
create policy sales_read on public.sales for select
  using (org_id = public.current_org_id() and public.is_owner());
create policy sales_insert on public.sales for insert
  with check (org_id = public.current_org_id() and attendant_id = auth.uid());
create policy sales_void on public.sales for update
  using (org_id = public.current_org_id() and public.is_owner())
  with check (org_id = public.current_org_id() and public.is_owner());

create policy customers_read on public.customers for select
  using (org_id = public.current_org_id() and (deleted_at is null or public.is_owner()));
create policy customers_insert on public.customers for insert
  with check (org_id = public.current_org_id() and public.is_manager_up());
create policy customers_update on public.customers for update
  using (org_id = public.current_org_id() and public.is_manager_up())
  with check (org_id = public.current_org_id() and public.is_manager_up());

create policy payments_read on public.credit_payments for select
  using (org_id = public.current_org_id() and (public.is_manager_up() or received_by = auth.uid()));
create policy payments_insert on public.credit_payments for insert
  with check (org_id = public.current_org_id() and received_by = auth.uid());
create policy payments_void on public.credit_payments for update
  using (org_id = public.current_org_id() and public.is_owner())
  with check (org_id = public.current_org_id() and public.is_owner());

create policy expenses_read on public.expenses for select
  using (org_id = public.current_org_id() and public.is_manager_up());
create policy expenses_insert on public.expenses for insert
  with check (org_id = public.current_org_id() and public.is_manager_up());
create policy expenses_update on public.expenses for update
  using (org_id = public.current_org_id() and public.is_owner())
  with check (org_id = public.current_org_id() and public.is_owner());

-- Shifts are read-only to clients; writes go through start_shift / end_shift.
create policy shifts_read on public.shifts for select
  using (org_id = public.current_org_id() and (public.is_manager_up() or attendant_id = auth.uid()));

create policy adjustments_read on public.stock_adjustments for select
  using (org_id = public.current_org_id() and public.is_manager_up());
create policy adjustments_insert on public.stock_adjustments for insert
  with check (org_id = public.current_org_id() and public.is_manager_up());
-- Dip readings are final; a wrong reading is corrected by taking a new one.

create policy audit_read on public.audit_log for select
  using (org_id = public.current_org_id() and public.is_owner());
