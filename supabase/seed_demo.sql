-- PetroTrack demo organization.
--
-- All amounts are in US dollars (the base currency), with some sales taken in SDG and SSP.
-- Fills ONE organization with 14 days of demo data and flags it is_demo = true, so it is
-- clearly separate from real sign-ups. It never touches any other organization.
--
-- How to use:
--   1. Sign up in the app with a dedicated demo email (e.g. demo@yourdomain.com).
--      That creates a fresh, empty organization owned by that account.
--   2. Put that email in v_demo_email below and run this file in the Supabase SQL editor
--      (or: npx supabase db query --linked -f supabase/seed_demo.sql).
--
-- It refuses to run if the account isn't an owner or its organization already has tanks.

do $$
declare
  v_demo_email text := 'demo@petrotrack.test';   -- <-- change to your demo account's email
  v_owner uuid;
  v_org uuid;
  ft_petrol uuid; ft_diesel uuid; ft_kero uuid;
  tk_petrol uuid; tk_diesel uuid; tk_kero uuid;
  tr1 uuid; tr2 uuid; tr3 uuid;
  dr1 uuid; dr2 uuid; dr3 uuid;
  sup1 uuid; sup2 uuid;
  cu1 uuid; cu2 uuid; cu3 uuid;
  d date;
  i int;
begin
  select p.id, p.org_id into v_owner, v_org
  from public.profiles p join auth.users u on u.id = p.id
  where lower(u.email) = lower(v_demo_email) and p.role = 'owner' and p.active;
  if v_owner is null then
    raise exception 'No active owner account with email %. Sign up with it in the app first.', v_demo_email;
  end if;
  if exists (select 1 from public.tanks where org_id = v_org) then
    raise exception 'Demo data already applied (organization for % already has tanks).', v_demo_email;
  end if;

  update public.organizations set name = 'PetroTrack Demo Depot', is_demo = true where id = v_org;

  -- Demo exchange rates (illustrative only: real SDG/SSP rates move often)
  insert into public.exchange_rates(org_id, currency, per_base, effective_date)
  values (v_org, 'SDG', 2600, public.nairobi_today() - 14), (v_org, 'SSP', 4600, public.nairobi_today() - 14);

  -- Fuel types were created at sign-up; set demo pump prices.
  update public.fuel_types set current_selling_price = 1.40 where org_id = v_org and name = 'Petrol' returning id into ft_petrol;
  update public.fuel_types set current_selling_price = 1.32 where org_id = v_org and name = 'Diesel' returning id into ft_diesel;
  update public.fuel_types set current_selling_price = 1.18 where org_id = v_org and name = 'Kerosene' returning id into ft_kero;

  insert into public.tanks(org_id, name, fuel_type_id, capacity_litres, low_stock_level)
    values (v_org, 'Tank 1 - Petrol', ft_petrol, 30000, 4000) returning id into tk_petrol;
  insert into public.tanks(org_id, name, fuel_type_id, capacity_litres, low_stock_level)
    values (v_org, 'Tank 2 - Diesel', ft_diesel, 30000, 4000) returning id into tk_diesel;
  insert into public.tanks(org_id, name, fuel_type_id, capacity_litres, low_stock_level)
    values (v_org, 'Tank 3 - Kerosene', ft_kero, 10000, 2500) returning id into tk_kero;

  insert into public.drivers(org_id, name, phone, licence_no) values (v_org, 'John Kamau', '0712 345 678', 'DL-448812') returning id into dr1;
  insert into public.drivers(org_id, name, phone, licence_no) values (v_org, 'Peter Otieno', '0722 987 654', 'DL-551203') returning id into dr2;
  insert into public.drivers(org_id, name, phone, licence_no) values (v_org, 'Ali Hassan', '0733 112 233', 'DL-602977') returning id into dr3;

  insert into public.trucks(org_id, plate_number, capacity_litres, driver_id, status, notes)
    values (v_org, 'KCA 123A', 15000, dr1, 'active', 'Main delivery truck') returning id into tr1;
  insert into public.trucks(org_id, plate_number, capacity_litres, driver_id, status)
    values (v_org, 'KCB 456B', 12000, dr2, 'on_trip') returning id into tr2;
  insert into public.trucks(org_id, plate_number, capacity_litres, driver_id, status, notes)
    values (v_org, 'KCC 789C', 10000, dr3, 'maintenance', 'Gearbox repair') returning id into tr3;

  insert into public.suppliers(org_id, name, phone, location)
    values (v_org, 'Rift Valley Fuels Ltd', '0700 100 200', 'Nakuru') returning id into sup1;
  insert into public.suppliers(org_id, name, phone, location)
    values (v_org, 'Coastline Petroleum Depot', '0700 300 400', 'Mombasa') returning id into sup2;

  insert into public.customers(org_id, name, phone, credit_limit, credit_terms_days)
    values (v_org, 'Mwangi Transporters', '0711 000 111', 2300, 30) returning id into cu1;
  insert into public.customers(org_id, name, phone, credit_limit, credit_terms_days)
    values (v_org, 'Green Farm Co-op', '0711 000 222', 1150, 14) returning id into cu2;
  insert into public.customers(org_id, name, phone, credit_limit, credit_terms_days)
    values (v_org, 'Kiptoo Boda Boda SACCO', '0711 000 333', 600, 7) returning id into cu3;

  for i in reverse 13..0 loop
    d := public.nairobi_today() - i;

    -- deliveries
    if i = 13 then
      insert into public.purchases(org_id, date, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost, created_by)
      values (v_org, d, sup1, tr1, tk_petrol, 14000, 1.21, 290, v_owner),
             (v_org, d, sup1, tr2, tk_diesel, 12000, 1.15, 245, v_owner),
             (v_org, d, sup2, tr3, tk_kero,    6000, 1.02, 160, v_owner);
    elsif i = 7 then
      insert into public.purchases(org_id, date, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost, created_by)
      values (v_org, d, sup2, tr1, tk_petrol, 9000, 1.23, 315, v_owner),
             (v_org, d, sup1, tr2, tk_diesel, 7000, 1.16, 200, v_owner);
    elsif i = 2 then
      insert into public.purchases(org_id, date, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost, created_by)
      values (v_org, d, sup1, tr1, tk_petrol, 6000, 1.22, 185, v_owner);
    end if;

    -- sales (deterministic quantities so the demo is reproducible)
    insert into public.sales(org_id, date, tank_id, litres, payment_type, payment_ref, currency, attendant_id)
    values (v_org, d, tk_petrol, 620 + (i * 37) % 180, 'cash',  null, 'USD', v_owner),
           (v_org, d, tk_petrol, 410 + (i * 53) % 140, 'mobile', 'DEMO' || to_char(d, 'YYMMDD') || 'P', 'SDG', v_owner),
           (v_org, d, tk_diesel, 380 + (i * 29) % 160, 'cash',  null, 'USD', v_owner),
           (v_org, d, tk_diesel, 300 + (i * 41) % 120, 'mobile', null, 'SSP', v_owner),
           (v_org, d, tk_kero,   190 + (i * 17) % 90,  'cash',  null, 'SDG', v_owner);

    if i % 3 = 0 then
      insert into public.sales(org_id, date, tank_id, litres, payment_type, customer_id, attendant_id)
      values (v_org, d, tk_diesel, 250, 'credit', cu1, v_owner);
    end if;
    if i % 5 = 1 then
      insert into public.sales(org_id, date, tank_id, litres, payment_type, customer_id, attendant_id)
      values (v_org, d, tk_petrol, 120, 'credit', cu2, v_owner);
    end if;
    if i = 12 then
      insert into public.sales(org_id, date, tank_id, litres, payment_type, customer_id, attendant_id)
      values (v_org, d, tk_petrol, 60, 'credit', cu3, v_owner);
    end if;

    -- expenses
    if i = 13 then
      insert into public.expenses(org_id, date, category, amount, description, created_by)
      values (v_org, d, 'rent', 350, 'Monthly depot rent', v_owner),
             (v_org, d, 'licences', 90, 'EPRA licence renewal instalment', v_owner);
    end if;
    if i = 10 then
      insert into public.expenses(org_id, date, category, amount, truck_id, description, created_by)
      values (v_org, d, 'truck_repairs', 295, tr3, 'Gearbox overhaul', v_owner);
    end if;
    if i = 6 then
      insert into public.expenses(org_id, date, category, amount, description, created_by)
      values (v_org, d, 'electricity', 67, 'Electricity token', v_owner),
             (v_org, d, 'security', 115, 'Night guard - fortnight', v_owner);
    end if;
    if i = 4 then
      insert into public.expenses(org_id, date, category, amount, truck_id, description, created_by)
      values (v_org, d, 'maintenance', 48, tr1, 'Service and tyres check', v_owner);
    end if;
    if i = 1 then
      insert into public.expenses(org_id, date, category, amount, description, created_by)
      values (v_org, d, 'salaries', 460, 'Attendant wages (half month)', v_owner);
    end if;
  end loop;

  -- some credit repaid
  insert into public.credit_payments(org_id, customer_id, amount, method, date, received_by)
  values (v_org, cu1, 385, 'mobile', public.nairobi_today() - 3, v_owner);
end $$;
