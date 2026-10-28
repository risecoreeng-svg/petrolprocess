-- PetroTrack: business logic triggers, audit, shift RPCs

-- ===== Role helpers (inactive or deleted users resolve to NULL = no access) =====
create function public.app_role() returns text language sql stable security definer
set search_path = '' as $$
  select role::text from public.profiles
  where id = auth.uid() and active and deleted_at is null
$$;

create function public.is_owner() returns boolean language sql stable
set search_path = '' as $$ select coalesce(public.app_role() = 'owner', false) $$;

create function public.is_manager_up() returns boolean language sql stable
set search_path = '' as $$ select coalesce(public.app_role() in ('owner','manager'), false) $$;

-- ===== Profile auto-creation. Role comes from app_metadata, which only the server can set. =====
create function public.handle_new_user() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, role) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'attendant'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== Generic: updated_at, hard-delete block, append-only audit =====
create function public.set_updated_at() returns trigger language plpgsql
set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;

create function public.block_hard_delete() returns trigger language plpgsql
set search_path = '' as $$
begin
  raise exception 'Hard delete is not allowed on %; set deleted_at instead', tg_table_name;
end $$;

create function public.block_audit_changes() returns trigger language plpgsql
set search_path = '' as $$ begin raise exception 'audit_log is append-only'; end $$;

-- ===== Audit =====
create function public.audit_row() returns trigger language plpgsql security definer
set search_path = '' as $$
declare v_action text; v_old jsonb; v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'INSERT';
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_action := case
      when old.deleted_at is null and new.deleted_at is not null then 'SOFT_DELETE'
      when old.deleted_at is not null and new.deleted_at is null then 'RESTORE'
      else 'UPDATE' end;
  end if;
  insert into public.audit_log(user_id, table_name, record_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, new.id, v_action, v_old, v_new);
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','drivers','trucks','suppliers','fuel_types','tanks',
    'purchases','customers','shifts','sales','credit_payments','expenses','stock_adjustments']
  loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
    execute format('create trigger trg_%1$s_nodelete before delete on public.%1$s
                    for each row execute function public.block_hard_delete()', t);
    execute format('create trigger trg_%1$s_audit after insert or update on public.%1$s
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

create trigger trg_audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.block_audit_changes();

-- ===== System-maintained columns always start at zero =====
create function public.tank_before_insert() returns trigger language plpgsql
set search_path = '' as $$ begin new.current_litres := 0; return new; end $$;
create trigger trg_tank_before before insert on public.tanks
  for each row execute function public.tank_before_insert();

create function public.customer_before_insert() returns trigger language plpgsql
set search_path = '' as $$ begin new.balance := 0; return new; end $$;
create trigger trg_customer_before before insert on public.customers
  for each row execute function public.customer_before_insert();

-- ===== Purchases =====
create function public.purchase_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks;
begin
  select * into t from public.tanks where id = new.tank_id and deleted_at is null for update;
  if not found then raise exception 'Tank not found'; end if;
  new.fuel_type_id := t.fuel_type_id;
  new.created_by := coalesce(auth.uid(), new.created_by);
  if t.current_litres + new.litres > t.capacity_litres then
    raise exception 'Delivery of % L exceeds tank capacity (% L free)',
      new.litres, t.capacity_litres - t.current_litres;
  end if;
  return new;
end $$;
create trigger trg_purchase_before before insert on public.purchases
  for each row execute function public.purchase_before_insert();

create function public.purchase_after_change() returns trigger language plpgsql
security definer set search_path = '' as $$
declare v_old numeric; v_avg numeric; v_new_avg numeric;
begin
  if tg_op = 'INSERT' then
    select current_litres into v_old from public.tanks where id = new.tank_id for update;
    select avg_cost_per_litre into v_avg from public.tank_costing where tank_id = new.tank_id;
    v_new_avg := (v_old * coalesce(v_avg, 0) + new.litres * new.landed_cost_per_litre)
                 / (v_old + new.litres);
    insert into public.tank_costing(tank_id, avg_cost_per_litre) values (new.tank_id, v_new_avg)
      on conflict (tank_id) do update
      set avg_cost_per_litre = excluded.avg_cost_per_litre, updated_at = now();
    update public.tanks set current_litres = current_litres + new.litres where id = new.tank_id;
  elsif old.deleted_at is null and new.deleted_at is not null then
    select current_litres into v_old from public.tanks where id = old.tank_id for update;
    if v_old < old.litres then
      raise exception 'Cannot void: tank only has % L, delivery was % L', v_old, old.litres;
    end if;
    update public.tanks set current_litres = current_litres - old.litres where id = old.tank_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Voided deliveries cannot be restored; record a new delivery';
  end if;
  return new;
end $$;
create trigger trg_purchase_after after insert or update of deleted_at on public.purchases
  for each row execute function public.purchase_after_change();

-- ===== Sales =====
create function public.sale_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks; ft public.fuel_types; c public.customers; v_avg numeric; v_total numeric;
begin
  select * into t from public.tanks where id = new.tank_id and deleted_at is null for update;
  if not found then raise exception 'Tank not found'; end if;
  select * into ft from public.fuel_types where id = t.fuel_type_id;
  new.fuel_type_id := t.fuel_type_id;

  if public.app_role() = 'attendant' then
    -- attendants cannot change price, date, or record for someone else
    new.attendant_id := auth.uid();
    new.price_per_litre := ft.current_selling_price;
    new.date := public.nairobi_today();
    new.shift_id := null;
  else
    new.attendant_id := coalesce(new.attendant_id, auth.uid());
    new.price_per_litre := coalesce(new.price_per_litre, ft.current_selling_price);
  end if;

  if new.shift_id is null then
    select id into new.shift_id from public.shifts
     where attendant_id = new.attendant_id and ended_at is null and deleted_at is null;
    if new.shift_id is null and public.app_role() = 'attendant' then
      raise exception 'Start a shift before recording sales';
    end if;
  end if;

  if new.litres > t.current_litres then
    raise exception 'Insufficient stock: % L requested, % L available in %',
      new.litres, t.current_litres, t.name;
  end if;

  select avg_cost_per_litre into v_avg from public.tank_costing where tank_id = new.tank_id;
  if v_avg is null then raise exception 'Tank has no cost basis; record a delivery first'; end if;
  new.cost_per_litre := v_avg;

  if new.payment_type = 'credit' then
    if new.customer_id is null then raise exception 'Credit sales need a customer'; end if;
    select * into c from public.customers
     where id = new.customer_id and deleted_at is null for update;
    if not found then raise exception 'Customer not found'; end if;
    v_total := round(new.litres * new.price_per_litre, 2);
    if c.balance + v_total > c.credit_limit then
      raise exception 'Credit limit exceeded: balance %, limit %, this sale %',
        c.balance, c.credit_limit, v_total;
    end if;
  end if;
  return new;
end $$;
create trigger trg_sale_before before insert on public.sales
  for each row execute function public.sale_before_insert();

create function public.sale_after_change() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.tanks set current_litres = current_litres - new.litres where id = new.tank_id;
    if new.payment_type = 'credit' then
      update public.customers set balance = balance + new.total where id = new.customer_id;
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.tanks set current_litres = current_litres + old.litres where id = old.tank_id;
    if old.payment_type = 'credit' then
      update public.customers set balance = balance - old.total where id = old.customer_id;
    end if;
  elsif old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Voided sales cannot be restored; record a new sale';
  end if;
  return new;
end $$;
create trigger trg_sale_after after insert or update of deleted_at on public.sales
  for each row execute function public.sale_after_change();

-- ===== Credit payments =====
create function public.payment_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers
   where id = new.customer_id and deleted_at is null for update;
  if not found then raise exception 'Customer not found'; end if;
  if new.amount > c.balance then
    raise exception 'Payment % exceeds balance owed %', new.amount, c.balance;
  end if;
  new.received_by := coalesce(auth.uid(), new.received_by);
  return new;
end $$;
create trigger trg_payment_before before insert on public.credit_payments
  for each row execute function public.payment_before_insert();

create function public.payment_after_change() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.customers set balance = balance - new.amount where id = new.customer_id;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.customers set balance = balance + old.amount where id = old.customer_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Voided payments cannot be restored';
  end if;
  return new;
end $$;
create trigger trg_payment_after after insert or update of deleted_at on public.credit_payments
  for each row execute function public.payment_after_change();

-- ===== Stock adjustments (dip readings) =====
create function public.adjustment_before_insert() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks;
begin
  select * into t from public.tanks where id = new.tank_id and deleted_at is null for update;
  if not found then raise exception 'Tank not found'; end if;
  if new.dip_litres > t.capacity_litres then raise exception 'Dip reading exceeds tank capacity'; end if;
  new.system_litres := t.current_litres;
  new.created_by := coalesce(auth.uid(), new.created_by);
  update public.tanks set current_litres = new.dip_litres where id = new.tank_id;
  return new;
end $$;
create trigger trg_adjust_before before insert on public.stock_adjustments
  for each row execute function public.adjustment_before_insert();

-- ===== Expenses: stamp creator =====
create function public.expense_before_insert() returns trigger language plpgsql
set search_path = '' as $$
begin new.created_by := coalesce(auth.uid(), new.created_by); return new; end $$;
create trigger trg_expense_before before insert on public.expenses
  for each row execute function public.expense_before_insert();

-- ===== Shifts (RPC only; clients have no direct write access) =====
create function public.start_shift() returns uuid language plpgsql security definer
set search_path = '' as $$
declare v_id uuid;
begin
  if public.app_role() is null then raise exception 'Not allowed'; end if;
  insert into public.shifts(attendant_id) values (auth.uid()) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'You already have an open shift';
end $$;

create function public.end_shift(p_shift uuid, p_cash_handed_in numeric)
returns public.shifts language plpgsql security definer set search_path = '' as $$
declare s public.shifts; v_expected numeric;
begin
  if p_cash_handed_in is null or p_cash_handed_in < 0 then
    raise exception 'Enter the cash handed in';
  end if;
  select * into s from public.shifts
   where id = p_shift and attendant_id = auth.uid() and ended_at is null and deleted_at is null
   for update;
  if not found then raise exception 'No open shift found'; end if;
  v_expected :=
      coalesce((select sum(total) from public.sales
                 where shift_id = p_shift and payment_type = 'cash' and deleted_at is null), 0)
    + coalesce((select sum(amount) from public.credit_payments
                 where received_by = auth.uid() and method = 'cash'
                   and deleted_at is null and created_at >= s.started_at), 0);
  update public.shifts
     set ended_at = now(), expected_cash = v_expected, cash_handed_in = p_cash_handed_in
   where id = p_shift
  returning * into s;
  return s;
end $$;
