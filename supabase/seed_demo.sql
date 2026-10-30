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

-- =====================================================================================
-- Truck Business demo (same demo organization): 6 trips including a fuel haulage with a
-- shortage and an unpaid client, truck expenses, a monthly salary, documents and a reminder.
do $$
declare
  v_demo_email text := 'demo@petrotrack.test';   -- <-- keep in step with the block above
  v_owner uuid; v_org uuid;
  tr1 uuid; tr2 uuid; tr3 uuid; dr1 uuid; dr2 uuid;
  cu1 uuid; cu2 uuid; cu_juba uuid; sup1 uuid; tk_petrol uuid; ft_petrol uuid; ft_diesel uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;
  today date := public.nairobi_today();
begin
  select p.id, p.org_id into v_owner, v_org
  from public.profiles p join auth.users u on u.id = p.id
  where lower(u.email) = lower(v_demo_email) and p.role = 'owner' and p.active;
  if v_owner is null then raise exception 'Run the first block of this file first.'; end if;
  if exists (select 1 from public.trips where org_id = v_org) then
    raise exception 'Truck demo already applied.';
  end if;

  select id into tr1 from public.trucks where org_id = v_org and plate_number = 'KCA 123A';
  select id into tr2 from public.trucks where org_id = v_org and plate_number = 'KCB 456B';
  select id into tr3 from public.trucks where org_id = v_org and plate_number = 'KCC 789C';
  select id into dr1 from public.drivers where org_id = v_org and name = 'John Kamau';
  select id into dr2 from public.drivers where org_id = v_org and name = 'Peter Otieno';
  select id into cu1 from public.customers where org_id = v_org and name = 'Mwangi Transporters';
  select id into cu2 from public.customers where org_id = v_org and name = 'Green Farm Co-op';
  select id into sup1 from public.suppliers where org_id = v_org and name = 'Rift Valley Fuels Ltd';
  select id into tk_petrol from public.tanks where org_id = v_org and name = 'Tank 1 - Petrol';
  select id into ft_petrol from public.fuel_types where org_id = v_org and name = 'Petrol';
  select id into ft_diesel from public.fuel_types where org_id = v_org and name = 'Diesel';

  update public.trucks set make_model = 'Mercedes-Benz Actros', year = 2017, truck_type = 'tanker', odometer_km = 182400, status = 'active' where id = tr1;
  update public.trucks set make_model = 'Isuzu FVZ', year = 2019, truck_type = 'tanker', odometer_km = 96350, status = 'active' where id = tr2;
  update public.trucks set make_model = 'Scania P410', year = 2015, truck_type = 'flatbed', capacity_unit = 'tonnes', capacity_litres = 28,
    odometer_km = 254900, ownership = 'third_party', third_party_owner = 'Hassan Haulage', payout_type = 'percent_of_fee', payout_value = 15
   where id = tr3;
  update public.drivers set licence_expiry = today + 210 where id = dr1;
  update public.drivers set licence_expiry = today + 18 where id = dr2;

  insert into public.customers(org_id, name, phone, credit_limit, credit_terms_days)
  values (v_org, 'Juba Fuel Traders', '0922 000 444', 0, 7) returning id into cu_juba;

  insert into public.truck_documents(org_id, truck_id, doc_type, reference, expires_on, created_by) values
    (v_org, tr1, 'insurance', 'INS-55120', today + 140, v_owner),
    (v_org, tr1, 'licence', 'LIC-8812', today + 22, v_owner),
    (v_org, tr2, 'insurance', 'INS-55121', today + 300, v_owner),
    (v_org, tr2, 'inspection', 'INSP-301', today - 5, v_owner),
    (v_org, tr3, 'licence', 'LIC-9001', today - 12, v_owner);
  insert into public.service_reminders(org_id, truck_id, name, every_km, last_done_km, last_done_on, created_by) values
    (v_org, tr1, 'Oil change', 10000, 173000, today - 50, v_owner),
    (v_org, tr2, 'Brake check', 20000, 90000, today - 30, v_owner);

  -- 1. Goods for Mwangi, USD, delivered, paid in full
  insert into public.trips(org_id, date, truck_id, driver_id, customer_id, route_from, route_to, cargo_type, currency, fee_original, created_by)
  values (v_org, today - 12, tr1, dr1, cu1, 'Port Sudan', 'Khartoum', 'goods', 'USD', 1200, v_owner) returning id into t1;
  insert into public.trip_lines(org_id, trip_id, kind, category, currency, original_amount, driver_id, created_by) values
    (v_org, t1, 'expense', 'fuel', 'USD', 180, null, v_owner),
    (v_org, t1, 'expense', 'tolls_border', 'USD', 40, null, v_owner),
    (v_org, t1, 'expense', 'meals', 'SDG', 25000, null, v_owner),
    (v_org, t1, 'expense', 'driver_pay', 'USD', 60, dr1, v_owner);
  perform public.start_trip_internal(t1, 182400 - 2100, null, true);
  perform public.deliver_trip_internal(t1, null, 182400 - 1300, null, null, null, null, null, null, null, true);

  -- 2. Fuel haulage for Juba Fuel Traders, SSP, 1.2% shortage -> disputed, unpaid
  insert into public.trips(org_id, date, truck_id, driver_id, customer_id, route_from, route_to, cargo_type, currency, fee_original,
    fuel_type_id, litres_loaded, loaded_from, loading_ticket, notes, created_by)
  values (v_org, today - 25, tr2, dr2, cu_juba, 'Kosti depot', 'Juba', 'fuel', 'SSP', 9000000,
    ft_diesel, 30000, 'Kosti depot', 'LT-77812', 'Client diesel', v_owner) returning id into t2;
  insert into public.trip_lines(org_id, trip_id, kind, category, currency, original_amount, created_by) values
    (v_org, t2, 'expense', 'fuel', 'USD', 600, v_owner),
    (v_org, t2, 'expense', 'tolls_border', 'USD', 150, v_owner),
    (v_org, t2, 'expense', 'checkpoint', 'SSP', 90000, v_owner),
    (v_org, t2, 'income', 'waiting_time', 'USD', 120, v_owner);
  insert into public.driver_advances(org_id, trip_id, driver_id, kind, currency, original_amount, created_by)
  values (v_org, t2, dr2, 'given', 'USD', 300, v_owner), (v_org, t2, dr2, 'returned', 'USD', 45, v_owner);
  perform public.start_trip_internal(t2, 96350 - 2600, null, true);
  perform public.deliver_trip_internal(t2, 29640, 96350 - 1150, null, null, null, null, null, null, null, true);
  update public.trips set delivered_at = (today - 22)::timestamptz + interval '15 hours',
    dispute_note = '360 L short at Juba. Seals intact; checking the meter at Kosti.' where id = t2;

  -- 3. Our own petrol from Rift Valley into Tank 1 (becomes a stock purchase)
  insert into public.trips(org_id, date, truck_id, driver_id, for_own_depot, route_from, route_to, cargo_type, currency, fee_original,
    fuel_type_id, litres_loaded, loaded_from, loading_ticket, supplier_id, tank_id, created_by)
  values (v_org, today - 3, tr1, dr1, true, 'Rift Valley depot', 'Our depot', 'fuel', 'USD', 0,
    ft_petrol, 8000, 'Rift Valley Fuels Ltd', 'RV-20931', sup1, tk_petrol, v_owner) returning id into t3;
  insert into public.trip_lines(org_id, trip_id, kind, category, currency, original_amount, created_by)
  values (v_org, t3, 'expense', 'fuel', 'USD', 95, v_owner);
  perform public.start_trip_internal(t3, 182400 - 400, null, true);
  perform public.deliver_trip_internal(t3, 7985, 182400, null, null, null, 1.20, null, 'USD', null, true);

  -- 4. Goods for Green Farm, SDG, delivered, partly paid (third-party truck: 15% payout)
  insert into public.trips(org_id, date, truck_id, customer_id, route_from, route_to, cargo_type, currency, fee_original, created_by)
  values (v_org, today - 8, tr3, cu2, 'Gedaref', 'Port Sudan', 'goods', 'SDG', 1300000, v_owner) returning id into t4;
  insert into public.trip_lines(org_id, trip_id, kind, category, currency, original_amount, created_by) values
    (v_org, t4, 'expense', 'loading', 'SDG', 60000, v_owner),
    (v_org, t4, 'expense', 'road_repairs', 'USD', 85, v_owner);
  perform public.start_trip_internal(t4, 254900 - 1100, 'Licence renewal booked; owner approved', true);
  perform public.deliver_trip_internal(t4, null, 254900, null, null, null, null, null, null, null, true);

  -- 5. Planned
  insert into public.trips(org_id, date, truck_id, driver_id, customer_id, route_from, route_to, cargo_type, currency, fee_original, created_by)
  values (v_org, today + 2, tr2, dr2, cu1, 'Khartoum', 'Atbara', 'goods', 'USD', 650, v_owner) returning id into t5;

  -- 6. On the road
  insert into public.trips(org_id, date, truck_id, driver_id, customer_id, route_from, route_to, cargo_type, currency, fee_original, created_by)
  values (v_org, today, tr1, dr1, cu2, 'Khartoum', 'Wad Madani', 'other', 'USD', 380, v_owner) returning id into t6;
  perform public.start_trip_internal(t6, 182400, null, true);

  -- Client payments: Mwangi paid in full; Green Farm part; Juba nothing (overdue)
  insert into public.trip_payments(org_id, customer_id, trip_id, method, reference, currency, original_amount, received_by)
  values (v_org, cu1, t1, 'bank', 'BK-1182', 'USD', 1200, v_owner),
         (v_org, cu2, t4, 'mobile', null, 'SDG', 500000, v_owner);

  -- Truck expenses and a monthly salary
  insert into public.truck_expenses(org_id, truck_id, date, category, description, litres, odometer_km, workshop, driver_id, currency, original_amount, created_by) values
    (v_org, tr1, today - 9, 'truck_fuel', 'Diesel top-up', 220, 181000, null, null, 'USD', 255, v_owner),
    (v_org, tr2, today - 20, 'insurance', 'Annual cover (instalment)', null, null, null, null, 'USD', 300, v_owner),
    (v_org, tr3, today - 15, 'tyres', 'Two rear tyres', null, null, 'Gedaref Tyre Centre', null, 'SDG', 800000, v_owner),
    (v_org, tr2, today - 6, 'repairs', 'Clutch adjustment', null, null, 'Juba Motors', null, 'SSP', 460000, v_owner),
    (v_org, tr1, today - 1, 'driver_salary', 'October salary', null, null, null, dr1, 'USD', 250, v_owner);
  insert into public.truck_recurring_expenses(org_id, truck_id, category, description, driver_id, currency, original_amount, next_due, created_by)
  values (v_org, tr1, 'driver_salary', 'Monthly salary - John Kamau', dr1, 'USD', 250, (date_trunc('month', today) + interval '1 month')::date, v_owner);
end $$;
