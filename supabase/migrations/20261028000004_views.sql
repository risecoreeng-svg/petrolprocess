-- PetroTrack: views.
-- "Safe" views run as the view owner but filter by role inside, and never expose cost columns.
-- Owner reports use security_invoker, so the owner-only RLS on sales/purchases/tank_costing applies.

create view public.purchases_safe as
  select id, date, supplier_id, truck_id, tank_id, fuel_type_id, litres, created_by, created_at
  from public.purchases
  where deleted_at is null and public.is_manager_up();

create view public.sales_safe as
  select id, date, created_at, tank_id, fuel_type_id, litres, price_per_litre, total,
         payment_type, customer_id, mpesa_ref, attendant_id, shift_id
  from public.sales
  where deleted_at is null
    and (public.is_manager_up()
         or (public.app_role() = 'attendant' and attendant_id = auth.uid()));

-- ===== Owner-only reports =====
create view public.daily_summary with (security_invoker = true) as
with s as (
  select date,
         sum(total) as sales,
         sum(litres) as litres,
         sum(total) filter (where payment_type = 'cash') as cash_sales,
         sum(total) filter (where payment_type = 'mpesa') as mpesa_sales,
         sum(total) filter (where payment_type = 'credit') as credit_sales,
         sum(cost_total) as cost_of_fuel
  from public.sales where deleted_at is null group by date),
e as (
  select date, sum(amount) as expenses
  from public.expenses where deleted_at is null group by date)
select date,
  coalesce(s.sales, 0) as sales,
  coalesce(s.litres, 0) as litres,
  coalesce(s.cash_sales, 0) as cash_sales,
  coalesce(s.mpesa_sales, 0) as mpesa_sales,
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
  sum(cash_sales) as cash_sales, sum(mpesa_sales) as mpesa_sales, sum(credit_sales) as credit_sales,
  sum(cost_of_fuel) as cost_of_fuel, sum(gross_profit) as gross_profit,
  sum(expenses) as expenses, sum(net_profit) as net_profit
from public.daily_summary
group by 1;

-- Margin is an estimate: litres delivered x (current pump price - landed cost).
-- Trip cost is already inside landed cost, so it is not subtracted again.
create view public.truck_performance with (security_invoker = true) as
with p as (
  select pu.truck_id,
         count(*) as deliveries,
         sum(pu.litres) as litres_brought,
         sum(pu.fuel_cost) as fuel_cost,
         sum(pu.trip_cost) as trip_cost,
         sum(round(pu.litres * (ft.current_selling_price - pu.landed_cost_per_litre), 2)) as margin
  from public.purchases pu
  join public.fuel_types ft on ft.id = pu.fuel_type_id
  where pu.deleted_at is null
  group by pu.truck_id),
x as (
  select truck_id,
    sum(amount) filter (where category in ('truck_repairs','maintenance')) as repair_costs,
    sum(amount) filter (where category not in ('truck_repairs','maintenance')) as other_truck_costs
  from public.expenses
  where truck_id is not null and deleted_at is null
  group by truck_id)
select t.id as truck_id, t.plate_number, t.status,
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
where t.deleted_at is null and public.is_owner();

create view public.stock_value with (security_invoker = true) as
select tk.id as tank_id, tk.name, tk.fuel_type_id, tk.current_litres, tc.avg_cost_per_litre,
       round(tk.current_litres * tc.avg_cost_per_litre, 2) as value
from public.tanks tk
join public.tank_costing tc on tc.tank_id = tk.id
where tk.deleted_at is null and public.is_owner();

-- ===== Owner + manager (no profit or cost) =====
-- Overdue = balance not covered by credit sales made inside the customer's terms window
-- (payments are applied to the oldest debt first).
create view public.customer_balances as
select c.id as customer_id, c.name, c.phone, c.credit_limit, c.credit_terms_days, c.balance,
  coalesce((select sum(s.total) from public.sales s
             where s.customer_id = c.id and s.deleted_at is null), 0) as total_credit_sales,
  coalesce((select sum(p.amount) from public.credit_payments p
             where p.customer_id = c.id and p.deleted_at is null), 0) as total_paid,
  greatest(0, c.balance - coalesce((select sum(s.total) from public.sales s
             where s.customer_id = c.id and s.deleted_at is null
               and s.date > public.nairobi_today() - c.credit_terms_days), 0)) as overdue
from public.customers c
where c.deleted_at is null and public.is_manager_up();

create view public.daily_sales_summary as
select date,
  sum(total) as sales,
  sum(litres) as litres,
  coalesce(sum(total) filter (where payment_type = 'cash'), 0) as cash_sales,
  coalesce(sum(total) filter (where payment_type = 'mpesa'), 0) as mpesa_sales,
  coalesce(sum(total) filter (where payment_type = 'credit'), 0) as credit_sales
from public.sales
where deleted_at is null and public.is_manager_up()
group by date;

revoke all on public.purchases_safe, public.sales_safe, public.daily_summary,
  public.monthly_summary, public.truck_performance, public.stock_value,
  public.customer_balances, public.daily_sales_summary from anon, public;
grant select on public.purchases_safe, public.sales_safe, public.daily_summary,
  public.monthly_summary, public.truck_performance, public.stock_value,
  public.customer_balances, public.daily_sales_summary to authenticated;
