-- PetroTrack: dip losses in profit, sales ledger and sale history for the dashboard drill-downs.
--
-- Bug fixed: a dip reading that finds less fuel than expected reduced the tank's litres but
-- never reduced profit, so net profit was overstated by the value of fuel lost. Each
-- adjustment now records the tank's average cost at that moment, and the value of the
-- difference (negative for a loss) is part of net profit.
--
-- The cost on an adjustment is owner-only: sales managers can still read dip readings,
-- but not what the fuel was worth.

-- ===== Dip readings carry their value =====
alter table public.stock_adjustments add column cost_per_litre numeric(16,6);
alter table public.stock_adjustments
  add column value_change numeric(16,2) generated always as (round((dip_litres - system_litres) * coalesce(cost_per_litre, 0), 2)) stored;

-- Existing readings: value them at the tank's current average cost (the best we have).
update public.stock_adjustments a set cost_per_litre = coalesce(tc.avg_cost_per_litre, 0)
from public.tanks t left join public.tank_costing tc on tc.tank_id = t.id
where t.id = a.tank_id and a.cost_per_litre is null;
alter table public.stock_adjustments alter column cost_per_litre set not null;

create or replace function public.adjustment_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks;
begin
  select * into t from public.tanks
   where id = new.tank_id and org_id = new.org_id and deleted_at is null for update;
  if not found then raise exception 'Tank not found'; end if;
  if new.dip_litres > t.capacity_litres then raise exception 'Dip reading exceeds tank capacity'; end if;
  new.system_litres := t.current_litres;
  new.cost_per_litre := coalesce((select avg_cost_per_litre from public.tank_costing where tank_id = new.tank_id), 0);
  new.created_by := coalesce(auth.uid(), new.created_by);
  update public.tanks set current_litres = new.dip_litres where id = new.tank_id;
  return new;
end $$;

-- Column-level select so the cost columns stay owner-only.
revoke select on public.stock_adjustments from authenticated;
grant select (id, org_id, tank_id, date, system_litres, dip_litres, difference, reason, created_by, created_at, updated_at, deleted_at)
  on public.stock_adjustments to authenticated;

create view public.stock_adjustment_values as
  select id, org_id, tank_id, date, difference, cost_per_litre, value_change
  from public.stock_adjustments
  where deleted_at is null and org_id = public.current_org_id() and public.is_owner();

-- ===== Daily P&L now includes dip gains/losses =====
drop view public.monthly_summary;
drop view public.daily_summary;

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
  group by date),
a as (
  select date, sum(value_change) as stock_adjustments
  from public.stock_adjustment_values
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
  coalesce(a.stock_adjustments, 0) as stock_adjustments,
  coalesce(s.sales, 0) - coalesce(s.cost_of_fuel, 0) - coalesce(e.expenses, 0) + coalesce(a.stock_adjustments, 0) as net_profit
from s full join e using (date) full join a using (date)
where public.is_owner();

create view public.monthly_summary with (security_invoker = true) as
select date_trunc('month', date)::date as month,
  sum(sales) as sales, sum(litres) as litres,
  sum(cash_sales) as cash_sales, sum(mobile_sales) as mobile_sales, sum(credit_sales) as credit_sales,
  sum(cost_of_fuel) as cost_of_fuel, sum(gross_profit) as gross_profit,
  sum(expenses) as expenses, sum(stock_adjustments) as stock_adjustments, sum(net_profit) as net_profit
from public.daily_summary
group by 1;

-- ===== Sales ledger: every sale incl. voided ones, without cost (owner + sales manager) =====
create view public.sales_ledger as
  select id, org_id, date, created_at, tank_id, fuel_type_id, litres, price_per_litre, total,
         payment_type, customer_id, payment_ref, attendant_id, shift_id,
         currency, fx_rate, original_price_per_litre, original_total,
         delivery_date, delivery_status, delivered_at, deleted_at, void_reason
  from public.sales
  where org_id = public.current_org_id() and public.is_manager_up();

-- ===== A sale's change history (owner + sales manager; cost removed for non-owners) =====
create function public.sale_history(p_sale uuid)
returns table (action text, changed_at timestamptz, changed_by text, old_data jsonb, new_data jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_owner boolean := public.is_owner();
begin
  if not public.is_manager_up() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.sales where id = p_sale and org_id = public.current_org_id()) then
    raise exception 'Sale not found';
  end if;
  return query
    select a.action, a.created_at,
           coalesce((select full_name from public.profiles p where p.id = a.user_id), 'System'),
           case when v_owner then a.old_data else a.old_data - 'cost_per_litre' - 'cost_total' end,
           case when v_owner then a.new_data else a.new_data - 'cost_per_litre' - 'cost_total' end
    from public.audit_log a
    where a.table_name = 'sales' and a.record_id = p_sale and a.org_id = public.current_org_id()
    order by a.created_at;
end $$;

revoke all on public.stock_adjustment_values, public.daily_summary, public.monthly_summary, public.sales_ledger from anon, public;
grant select on public.stock_adjustment_values, public.daily_summary, public.monthly_summary, public.sales_ledger to authenticated;
revoke execute on function public.sale_history(uuid) from public, anon;
grant execute on function public.sale_history(uuid) to authenticated;
