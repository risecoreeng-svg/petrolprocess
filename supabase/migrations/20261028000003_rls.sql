-- PetroTrack: grants and row level security.
-- Column-level grants stop clients writing system-maintained columns
-- (current_litres, balance, costs). No DELETE is granted on anything.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

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
grant select on public.profiles, public.drivers, public.trucks, public.suppliers,
  public.fuel_types, public.tanks, public.customers, public.shifts, public.credit_payments,
  public.expenses, public.stock_adjustments, public.purchases, public.sales,
  public.tank_costing, public.audit_log to authenticated;

grant insert, update on public.drivers, public.trucks, public.suppliers, public.fuel_types,
  public.expenses to authenticated;
grant insert on public.purchases, public.sales, public.credit_payments,
  public.stock_adjustments, public.customers, public.tanks to authenticated;
grant update (name, fuel_type_id, capacity_litres, low_stock_level, deleted_at)
  on public.tanks to authenticated;
grant update (name, phone, credit_limit, credit_terms_days, deleted_at)
  on public.customers to authenticated;
grant update (full_name, role, active, deleted_at) on public.profiles to authenticated;
-- Transactions can only be voided, never edited.
grant update (deleted_at) on public.purchases, public.sales, public.credit_payments
  to authenticated;

revoke execute on function public.start_shift(), public.end_shift(uuid, numeric) from public, anon;
grant execute on function public.start_shift(), public.end_shift(uuid, numeric) to authenticated;

-- ===== Policies =====
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_manager_up());
create policy profiles_update on public.profiles for update
  using (public.is_owner()) with check (public.is_owner());

-- Reference data: any active staff can read, owner/manager can write.
do $$ declare t text; begin
  foreach t in array array['drivers','trucks','suppliers','fuel_types','tanks'] loop
    execute format('create policy %1$s_read on public.%1$s for select
      using ((public.app_role() is not null and deleted_at is null) or public.is_owner())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert
      with check (public.is_manager_up())', t);
    execute format('create policy %1$s_update on public.%1$s for update
      using (public.is_manager_up()) with check (public.is_manager_up())', t);
  end loop;
end $$;

-- Cost basis: owner only.
create policy tank_costing_read on public.tank_costing for select using (public.is_owner());

-- Purchases: base table (with cost) is owner-only to read; managers insert; owner voids.
create policy purchases_read on public.purchases for select using (public.is_owner());
create policy purchases_insert on public.purchases for insert with check (public.is_manager_up());
create policy purchases_void on public.purchases for update
  using (public.is_owner()) with check (public.is_owner());

-- Sales: base table is owner-only to read; all staff insert as themselves; owner voids.
create policy sales_read on public.sales for select using (public.is_owner());
create policy sales_insert on public.sales for insert
  with check (public.app_role() is not null and attendant_id = auth.uid());
create policy sales_void on public.sales for update
  using (public.is_owner()) with check (public.is_owner());

create policy customers_read on public.customers for select
  using (public.app_role() is not null and (deleted_at is null or public.is_owner()));
create policy customers_insert on public.customers for insert with check (public.is_manager_up());
create policy customers_update on public.customers for update
  using (public.is_manager_up()) with check (public.is_manager_up());

create policy payments_read on public.credit_payments for select
  using (public.is_manager_up() or (public.app_role() is not null and received_by = auth.uid()));
create policy payments_insert on public.credit_payments for insert
  with check (public.app_role() is not null and received_by = auth.uid());
create policy payments_void on public.credit_payments for update
  using (public.is_owner()) with check (public.is_owner());

create policy expenses_read on public.expenses for select using (public.is_manager_up());
create policy expenses_insert on public.expenses for insert with check (public.is_manager_up());
create policy expenses_update on public.expenses for update
  using (public.is_owner()) with check (public.is_owner());

-- Shifts are read-only to clients; writes go through start_shift / end_shift.
create policy shifts_read on public.shifts for select
  using (public.is_manager_up() or (public.app_role() is not null and attendant_id = auth.uid()));

create policy adjustments_read on public.stock_adjustments for select using (public.is_manager_up());
create policy adjustments_insert on public.stock_adjustments for insert
  with check (public.is_manager_up());
-- Dip readings are final; a wrong reading is corrected by taking a new one.

create policy audit_read on public.audit_log for select using (public.is_owner());
