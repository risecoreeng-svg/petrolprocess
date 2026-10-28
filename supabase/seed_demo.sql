-- PetroTrack demo data.
-- Run AFTER the migrations and AFTER you have created and promoted your owner account
-- (see README). Sales are recorded against the owner account.
-- Produces 14 days of deliveries, sales and expenses so the dashboard has something to show.

do $$
declare
  v_owner uuid;
  ft_petrol uuid; ft_diesel uuid; ft_kero uuid;
  tk_petrol uuid; tk_diesel uuid; tk_kero uuid;
  tr1 uuid; tr2 uuid; tr3 uuid;
  dr1 uuid; dr2 uuid; dr3 uuid;
  sup1 uuid; sup2 uuid;
  cu1 uuid; cu2 uuid; cu3 uuid;
  d date;
  i int;
begin
  select id into v_owner from public.profiles where role = 'owner' and active order by created_at limit 1;
  if v_owner is null then
    raise exception 'Create and promote the owner account first (see README), then run this seed.';
  end if;
  if exists (select 1 from public.fuel_types) then
    raise exception 'Seed already applied (fuel_types is not empty).';
  end if;

  insert into public.fuel_types(name, current_selling_price) values ('Petrol', 182.00) returning id into ft_petrol;
  insert into public.fuel_types(name, current_selling_price) values ('Diesel', 171.50) returning id into ft_diesel;
  insert into public.fuel_types(name, current_selling_price) values ('Kerosene', 154.00) returning id into ft_kero;

  insert into public.tanks(name, fuel_type_id, capacity_litres, low_stock_level)
    values ('Tank 1 - Petrol', ft_petrol, 30000, 4000) returning id into tk_petrol;
  insert into public.tanks(name, fuel_type_id, capacity_litres, low_stock_level)
    values ('Tank 2 - Diesel', ft_diesel, 30000, 4000) returning id into tk_diesel;
  insert into public.tanks(name, fuel_type_id, capacity_litres, low_stock_level)
    values ('Tank 3 - Kerosene', ft_kero, 10000, 2500) returning id into tk_kero;

  insert into public.drivers(name, phone, licence_no) values ('John Kamau', '0712 345 678', 'DL-448812') returning id into dr1;
  insert into public.drivers(name, phone, licence_no) values ('Peter Otieno', '0722 987 654', 'DL-551203') returning id into dr2;
  insert into public.drivers(name, phone, licence_no) values ('Ali Hassan', '0733 112 233', 'DL-602977') returning id into dr3;

  insert into public.trucks(plate_number, capacity_litres, driver_id, status, notes)
    values ('KCA 123A', 15000, dr1, 'active', 'Main delivery truck') returning id into tr1;
  insert into public.trucks(plate_number, capacity_litres, driver_id, status)
    values ('KCB 456B', 12000, dr2, 'on_trip') returning id into tr2;
  insert into public.trucks(plate_number, capacity_litres, driver_id, status, notes)
    values ('KCC 789C', 10000, dr3, 'maintenance', 'Gearbox repair') returning id into tr3;

  insert into public.suppliers(name, phone, location)
    values ('Rift Valley Fuels Ltd', '0700 100 200', 'Nakuru') returning id into sup1;
  insert into public.suppliers(name, phone, location)
    values ('Coastline Petroleum Depot', '0700 300 400', 'Mombasa') returning id into sup2;

  insert into public.customers(name, phone, credit_limit, credit_terms_days)
    values ('Mwangi Transporters', '0711 000 111', 300000, 30) returning id into cu1;
  insert into public.customers(name, phone, credit_limit, credit_terms_days)
    values ('Green Farm Co-op', '0711 000 222', 150000, 14) returning id into cu2;
  insert into public.customers(name, phone, credit_limit, credit_terms_days)
    values ('Kiptoo Boda Boda SACCO', '0711 000 333', 80000, 7) returning id into cu3;

  for i in reverse 13..0 loop
    d := public.nairobi_today() - i;

    -- deliveries
    if i = 13 then
      insert into public.purchases(date, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost, created_by)
      values (d, sup1, tr1, tk_petrol, 14000, 158.20, 38000, v_owner),
             (d, sup1, tr2, tk_diesel, 12000, 149.90, 32000, v_owner),
             (d, sup2, tr3, tk_kero,    6000, 133.40, 21000, v_owner);
    elsif i = 7 then
      insert into public.purchases(date, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost, created_by)
      values (d, sup2, tr1, tk_petrol, 9000, 160.10, 41000, v_owner),
             (d, sup1, tr2, tk_diesel, 7000, 151.25, 26000, v_owner);
    elsif i = 2 then
      insert into public.purchases(date, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost, created_by)
      values (d, sup1, tr1, tk_petrol, 6000, 159.40, 24000, v_owner);
    end if;

    -- sales (deterministic quantities so the demo is reproducible)
    insert into public.sales(date, tank_id, litres, payment_type, mpesa_ref, attendant_id)
    values (d, tk_petrol, 620 + (i * 37) % 180, 'cash',  null, v_owner),
           (d, tk_petrol, 410 + (i * 53) % 140, 'mpesa', 'SEED' || to_char(d, 'YYMMDD') || 'P', v_owner),
           (d, tk_diesel, 380 + (i * 29) % 160, 'cash',  null, v_owner),
           (d, tk_diesel, 300 + (i * 41) % 120, 'mpesa', 'SEED' || to_char(d, 'YYMMDD') || 'D', v_owner),
           (d, tk_kero,   190 + (i * 17) % 90,  'cash',  null, v_owner);

    if i % 3 = 0 then
      insert into public.sales(date, tank_id, litres, payment_type, customer_id, attendant_id)
      values (d, tk_diesel, 250, 'credit', cu1, v_owner);
    end if;
    if i % 5 = 1 then
      insert into public.sales(date, tank_id, litres, payment_type, customer_id, attendant_id)
      values (d, tk_petrol, 120, 'credit', cu2, v_owner);
    end if;
    if i = 12 then
      insert into public.sales(date, tank_id, litres, payment_type, customer_id, attendant_id)
      values (d, tk_petrol, 60, 'credit', cu3, v_owner);
    end if;

    -- expenses
    if i = 13 then
      insert into public.expenses(date, category, amount, description, created_by)
      values (d, 'rent', 45000, 'Monthly depot rent', v_owner),
             (d, 'licences', 12000, 'EPRA licence renewal instalment', v_owner);
    end if;
    if i = 10 then
      insert into public.expenses(date, category, amount, truck_id, description, created_by)
      values (d, 'truck_repairs', 38500, tr3, 'Gearbox overhaul', v_owner);
    end if;
    if i = 6 then
      insert into public.expenses(date, category, amount, description, created_by)
      values (d, 'electricity', 8700, 'KPLC token', v_owner),
             (d, 'security', 15000, 'Night guard - fortnight', v_owner);
    end if;
    if i = 4 then
      insert into public.expenses(date, category, amount, truck_id, description, created_by)
      values (d, 'maintenance', 6200, tr1, 'Service and tyres check', v_owner);
    end if;
    if i = 1 then
      insert into public.expenses(date, category, amount, description, created_by)
      values (d, 'salaries', 60000, 'Attendant wages (half month)', v_owner);
    end if;
  end loop;

  -- some credit repaid
  insert into public.credit_payments(customer_id, amount, method, date, received_by)
  values (cu1, 50000, 'mpesa', public.nairobi_today() - 3, v_owner);
end $$;
