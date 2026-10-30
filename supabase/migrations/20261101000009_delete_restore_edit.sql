-- =====================================================================================
-- 009: "Delete" (soft delete) for purchases, sales, expenses, credit payments, trips,
-- trip lines and truck expenses; a Deleted items list; owner restore; edits for expenses
-- and purchases.
--
-- Rules
--   * Nothing is ever removed: delete sets deleted_at (hard DELETE stays blocked).
--   * Owner: may delete, restore and edit anything in the organization.
--   * Sales manager (depot records) and fleet manager (truck records): only records they
--     entered themselves, within organizations.delete_window_hours (default 24).
--   * Attendants and drivers: never.
--   * Clients can no longer set deleted_at on these tables directly; everything goes
--     through delete_record / restore_record so the rules above always apply.
--   * Every delete, restore and edit is written to audit_log by the existing audit trigger
--     (user, time, old and new row, which includes the reason).
-- =====================================================================================

-- ===== Settings =====
alter table public.organizations
  add column delete_window_hours int not null default 24 check (delete_window_hours between 0 and 168);
grant update (delete_window_hours) on public.organizations to authenticated;

-- ===== Who deleted it and why =====
do $$ declare t text; begin
  foreach t in array array['purchases','sales','expenses','credit_payments','trips','trip_lines','truck_expenses'] loop
    execute format('alter table public.%I add column deleted_by uuid, add column delete_reason text, add column delete_note text', t);
  end loop;
end $$;

-- Sales record who entered them (an attendant's sale may be entered by a manager).
alter table public.sales add column created_by uuid;
update public.sales s set created_by = coalesce(
  (select a.user_id from public.audit_log a where a.table_name = 'sales' and a.record_id = s.id and a.action = 'INSERT' limit 1),
  s.attendant_id);
create function public.sale_stamp_creator() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by, new.attendant_id);
  return new;
end $$;
create trigger trg_sale_who before insert on public.sales
  for each row execute function public.sale_stamp_creator();

-- Existing voids keep their reason under the new name.
update public.sales set delete_reason = 'Other', delete_note = void_reason where deleted_at is not null and delete_reason is null;
update public.trips set delete_reason = 'Other', delete_note = void_reason where deleted_at is not null and delete_reason is null;

-- ===== Only the functions below may delete or restore =====
revoke update (deleted_at) on public.purchases, public.sales, public.credit_payments from authenticated;
revoke update (void_reason) on public.sales from authenticated;
revoke update (deleted_at) on public.trip_lines, public.truck_expenses from authenticated;
-- Expenses are edited through edit_expense (same rules as delete).
revoke update on public.expenses from authenticated;

-- ===== Average cost when stock goes in or out =====
-- Adding: weighted average of what's in the tank and what arrives.
create function public.tank_stock_in(p_tank uuid, p_org uuid, p_litres numeric, p_landed numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tanks; v_avg numeric;
begin
  select * into t from public.tanks where id = p_tank for update;
  if t.current_litres + p_litres > t.capacity_litres then
    raise exception '% only has room for % L; this delivery is % L', t.name, t.capacity_litres - t.current_litres, p_litres;
  end if;
  select avg_cost_per_litre into v_avg from public.tank_costing where tank_id = p_tank;
  insert into public.tank_costing(tank_id, org_id, avg_cost_per_litre)
  values (p_tank, p_org, (greatest(t.current_litres, 0) * coalesce(v_avg, 0) + p_litres * p_landed) / (greatest(t.current_litres, 0) + p_litres))
  on conflict (tank_id) do update set avg_cost_per_litre = excluded.avg_cost_per_litre, updated_at = now();
  update public.tanks set current_litres = current_litres + p_litres where id = p_tank;
end $$;

-- Removing a delivery: take its litres and their cost back out of the average.
create function public.tank_stock_out(p_tank uuid, p_litres numeric, p_landed numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tanks; v_avg numeric; v_left numeric;
begin
  select * into t from public.tanks where id = p_tank for update;
  if t.current_litres < p_litres then
    raise exception 'Only % L are left in %, but this delivery was % L. Delete the sales from that stock first',
      t.current_litres, t.name, p_litres;
  end if;
  v_left := t.current_litres - p_litres;
  if v_left > 0 then
    select avg_cost_per_litre into v_avg from public.tank_costing where tank_id = p_tank;
    update public.tank_costing
       set avg_cost_per_litre = greatest(0, (t.current_litres * coalesce(v_avg, 0) - p_litres * p_landed) / v_left), updated_at = now()
     where tank_id = p_tank;
  end if;
  update public.tanks set current_litres = v_left where id = p_tank;
end $$;

-- ===== Effects of deleting and restoring (trigger level, so every path agrees) =====
create or replace function public.purchase_after_change() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.tank_stock_in(new.tank_id, new.org_id, new.litres, new.landed_cost_per_litre);
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform public.tank_stock_out(old.tank_id, old.litres, old.landed_cost_per_litre);
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public.tank_stock_in(new.tank_id, new.org_id, new.litres, new.landed_cost_per_litre);
  end if;
  return new;
end $$;

-- The insert trigger no longer needs its own capacity check (tank_stock_in does it) but keeps it
-- for the friendlier message on a normal delivery.

create or replace function public.sale_after_change() returns trigger language plpgsql
security definer set search_path = '' as $$
declare t public.tanks; c public.customers;
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
    select * into t from public.tanks where id = new.tank_id for update;
    if t.current_litres < new.litres then
      raise exception 'Can''t restore: the sale was % L but only % L are in % now', new.litres, t.current_litres, t.name;
    end if;
    if new.payment_type = 'credit' then
      select * into c from public.customers where id = new.customer_id for update;
      if c.deleted_at is not null then raise exception 'Can''t restore: the customer has been removed'; end if;
      if c.balance + new.total > c.credit_limit then
        raise exception 'Can''t restore: % would go over their credit limit (owes %, limit %, this sale %)',
          c.name, c.balance, c.credit_limit, new.total;
      end if;
      update public.customers set balance = balance + new.total where id = new.customer_id;
    end if;
    update public.tanks set current_litres = current_litres - new.litres where id = new.tank_id;
  end if;
  return new;
end $$;

create or replace function public.payment_after_change() returns trigger language plpgsql
security definer set search_path = '' as $$
declare c public.customers;
begin
  if tg_op = 'INSERT' then
    update public.customers set balance = balance - new.amount where id = new.customer_id;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.customers set balance = balance + old.amount where id = old.customer_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    select * into c from public.customers where id = new.customer_id for update;
    if new.amount > c.balance + 0.01 then
      raise exception 'Can''t restore: % now owes only %, less than this payment of %', c.name, c.balance, new.amount;
    end if;
    update public.customers set balance = balance - new.amount where id = new.customer_id;
  end if;
  return new;
end $$;

-- "Other: note" reads as just the note.
create function public.reason_text(p_reason text, p_note text) returns text language sql immutable
set search_path = '' as $$
  select nullif(trim(case when p_reason = 'Other' or p_reason is null then coalesce(p_note, '')
                          else concat_ws(': ', p_reason, nullif(trim(p_note), '')) end), '')
$$;

-- A sale's void_reason is kept in step with the delete reason.
create or replace function public.sale_before_update() returns trigger language plpgsql
set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    new.void_reason := coalesce(nullif(trim(new.void_reason), ''),
      public.reason_text(new.delete_reason, new.delete_note));
    if coalesce(trim(new.void_reason), '') = '' then
      raise exception 'Give a reason for cancelling this sale';
    end if;
  elsif old.deleted_at is not null and new.deleted_at is null then
    new.void_reason := null;
  end if;
  return new;
end $$;

-- ===== The kinds of record that can be deleted =====
-- kind -> table, the column holding who entered it, and which manager role may delete it.
create function public.deletable(p_kind text, out tbl text, out creator_col text, out dept text)
language sql immutable set search_path = '' as $$
  select v.tbl, v.creator_col, v.dept from (values
    ('purchase',       'purchases',       'created_by',  'depot'),
    ('sale',           'sales',           'created_by',  'depot'),
    ('expense',        'expenses',        'created_by',  'depot'),
    ('credit_payment', 'credit_payments', 'received_by', 'depot'),
    ('trip',           'trips',           'created_by',  'fleet'),
    ('trip_line',      'trip_lines',      'created_by',  'fleet'),
    ('truck_expense',  'truck_expenses',  'created_by',  'fleet')
  ) v(kind, tbl, creator_col, dept) where v.kind = p_kind
$$;

-- Who may change (delete or edit) a record. Returns null when allowed, or why not.
create function public.change_denied(p_kind text, p_creator uuid, p_created timestamptz)
returns text language plpgsql stable security definer set search_path = '' as $$
declare d record; v_role text := public.app_role(); v_hours int;
begin
  select * into d from public.deletable(p_kind);
  if d.tbl is null then return 'Unknown record type'; end if;
  if v_role = 'owner' then return null; end if;
  if not ((v_role = 'manager' and d.dept = 'depot') or (v_role = 'fleet_manager' and d.dept = 'fleet')) then
    return 'Only the owner can delete this';
  end if;
  select delete_window_hours into v_hours from public.organizations where id = public.current_org_id();
  if p_creator is distinct from auth.uid() then
    return 'You can only delete records you entered yourself. Ask the owner';
  end if;
  if p_created < now() - make_interval(hours => v_hours) then
    return format('You can only delete records within %s hours of entering them. Ask the owner', v_hours);
  end if;
  return null;
end $$;

-- Reads a record's creator and timestamps (organization-scoped).
create function public.record_meta(p_kind text, p_id uuid, out creator uuid, out created timestamptz, out deleted timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare d record;
begin
  select * into d from public.deletable(p_kind);
  if d.tbl is null then raise exception 'Unknown record type'; end if;
  execute format('select %I, created_at, deleted_at from public.%I where id = $1 and org_id = $2', d.creator_col, d.tbl)
    into creator, created, deleted using p_id, public.current_org_id();
end $$;

create function public.fmt_money(p_amount numeric) returns text language sql stable security definer
set search_path = '' as $$
  select (select base_currency from public.organizations where id = public.current_org_id()) || ' ' ||
         to_char(coalesce(p_amount, 0), 'FM999,999,999,999,990.00')
$$;
create function public.fmt_litres(p_litres numeric) returns text language sql immutable set search_path = '' as $$
  select rtrim(rtrim(to_char(coalesce(p_litres, 0), 'FM999,999,999,990.99'), '0'), '.') || ' L'
$$;

-- ===== What a delete would do, in plain words =====
-- { allowed, denied, effect, warning, blocked, editable }
create function public.delete_preview(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m record; v_denied text; v_effect text; v_warning text; v_blocked text; v_edit boolean := false;
  p public.purchases; s public.sales; e public.expenses; cp public.credit_payments;
  tr public.trips; tl public.trip_lines; te public.truck_expenses; t public.tanks; v_sold numeric; v_fuel text;
  v_owner boolean := public.is_owner();
begin
  if public.app_role() not in ('owner', 'manager', 'fleet_manager') then raise exception 'Not allowed'; end if;
  select * into m from public.record_meta(p_kind, p_id);
  if m.created is null then raise exception 'Record not found'; end if;
  if m.deleted is not null then raise exception 'This has already been deleted'; end if;
  v_denied := public.change_denied(p_kind, m.creator, m.created);

  case p_kind
  when 'purchase' then
    select * into p from public.purchases where id = p_id;
    select * into t from public.tanks where id = p.tank_id;
    select name into v_fuel from public.fuel_types where id = p.fuel_type_id;
    v_effect := format('This removes %s of %s from %s and takes its cost out of the tank''s average cost.',
      public.fmt_litres(p.litres), v_fuel, t.name);
    select coalesce(sum(litres), 0) into v_sold from public.sales
     where tank_id = p.tank_id and deleted_at is null and created_at > p.created_at;
    if v_sold > 0 then
      v_warning := format('%s have been sold from %s since this delivery arrived. Those sales keep the cost they were recorded with.',
        public.fmt_litres(v_sold), t.name);
    end if;
    if t.current_litres < p.litres then
      v_blocked := format('Only %s are left in %s, but this delivery was %s. Delete the sales from that stock first.',
        public.fmt_litres(t.current_litres), t.name, public.fmt_litres(p.litres));
    end if;
    if p.trip_id is not null then
      v_blocked := 'This fuel came in on a trip. Delete the trip instead.';
    end if;
    v_edit := v_denied is null and p.trip_id is null;
  when 'sale' then
    select * into s from public.sales where id = p_id;
    select * into t from public.tanks where id = s.tank_id;
    select name into v_fuel from public.fuel_types where id = s.fuel_type_id;
    v_effect := format('This puts %s of %s back into %s and removes %s from your sales%s.',
      public.fmt_litres(s.litres), v_fuel, t.name, public.fmt_money(s.total),
      case when v_owner then ' and its cost from your profit' else '' end);
    if s.payment_type = 'credit' then
      v_effect := v_effect || format(' %s will owe %s less.', (select name from public.customers where id = s.customer_id), public.fmt_money(s.total));
    end if;
  when 'expense' then
    select * into e from public.expenses where id = p_id;
    v_effect := format('This removes %s (%s) from your expenses, so net profit goes up by the same amount.',
      public.fmt_money(e.amount), replace(e.category::text, '_', ' '));
    v_edit := v_denied is null;
  when 'credit_payment' then
    select * into cp from public.credit_payments where id = p_id;
    v_effect := format('This puts %s back on what %s owes you.', public.fmt_money(cp.amount),
      (select name from public.customers where id = cp.customer_id));
  when 'trip' then
    select * into tr from public.trips where id = p_id;
    v_effect := format('This removes trip #%s (%s to %s) and its income and costs from your reports.', tr.trip_no, tr.route_from, tr.route_to);
    select * into p from public.purchases where trip_id = p_id and deleted_at is null;
    if found then
      select * into t from public.tanks where id = p.tank_id;
      v_effect := v_effect || format(' The %s it delivered into %s come out of stock.', public.fmt_litres(p.litres), t.name);
      if t.current_litres < p.litres then
        v_blocked := format('Only %s are left in %s, but this trip delivered %s. Delete the sales from that stock first.',
          public.fmt_litres(t.current_litres), t.name, public.fmt_litres(p.litres));
      end if;
    end if;
    if exists (select 1 from public.trip_payments where trip_id = p_id and deleted_at is null) then
      v_warning := 'Payments were recorded against this trip. They stay on the client''s account.';
    end if;
  when 'trip_line' then
    select * into tl from public.trip_lines where id = p_id;
    select * into tr from public.trips where id = tl.trip_id;
    v_effect := format('This removes %s %s (%s) from trip #%s.', public.fmt_money(tl.amount),
      case tl.kind when 'income' then 'of income' else 'of costs' end, replace(tl.category, '_', ' '), tr.trip_no);
  when 'truck_expense' then
    select * into te from public.truck_expenses where id = p_id;
    v_effect := format('This removes %s (%s, %s) from your truck costs, so net profit goes up by the same amount.',
      public.fmt_money(te.amount), replace(te.category, '_', ' '), (select plate_number from public.trucks where id = te.truck_id));
  end case;

  return jsonb_build_object('allowed', v_denied is null, 'denied', v_denied, 'effect', v_effect,
    'warning', v_warning, 'blocked', v_blocked, 'editable', v_edit);
end $$;

-- ===== Delete =====
create function public.delete_record(p_kind text, p_id uuid, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d record; m record; v_denied text; v_note text := nullif(trim(p_note), ''); tr public.trips; v_blocked text;
begin
  if public.app_role() not in ('owner', 'manager', 'fleet_manager') then raise exception 'You can''t delete records'; end if;
  if p_reason is null or p_reason not in ('Entered by mistake', 'Duplicate', 'Wrong amount', 'Test data', 'Other') then
    raise exception 'Choose a reason';
  end if;
  if p_reason = 'Other' and v_note is null then raise exception 'Say why in a few words'; end if;
  select * into d from public.deletable(p_kind);
  if d.tbl is null then raise exception 'Unknown record type'; end if;
  select * into m from public.record_meta(p_kind, p_id);
  if m.created is null then raise exception 'Record not found'; end if;
  if m.deleted is not null then raise exception 'This has already been deleted'; end if;
  v_denied := public.change_denied(p_kind, m.creator, m.created);
  if v_denied is not null then raise exception '%', v_denied; end if;
  v_blocked := public.delete_preview(p_kind, p_id)->>'blocked';
  if v_blocked is not null then raise exception '%', v_blocked; end if;

  if p_kind = 'trip' then
    select * into tr from public.trips where id = p_id for update;
    -- Fuel this trip put into our tank comes back out with it.
    update public.purchases set deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Deleted with trip',
           delete_note = format('Trip #%s', tr.trip_no)
     where trip_id = p_id and deleted_at is null;
    update public.trips set deleted_at = now(), deleted_by = auth.uid(), delete_reason = p_reason, delete_note = v_note,
           void_reason = public.reason_text(p_reason, v_note)
     where id = p_id;
    perform public.truck_release(tr.truck_id);
  else
    execute format('update public.%I set deleted_at = now(), deleted_by = $1, delete_reason = $2, delete_note = $3 where id = $4', d.tbl)
      using auth.uid(), p_reason, v_note, p_id;
  end if;
end $$;

-- ===== Restore (owner only) =====
create function public.restore_record(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d record; m record; tr public.trips; v_trip uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner can restore deleted records'; end if;
  select * into d from public.deletable(p_kind);
  if d.tbl is null then raise exception 'Unknown record type'; end if;
  select * into m from public.record_meta(p_kind, p_id);
  if m.created is null then raise exception 'Record not found'; end if;
  if m.deleted is null then raise exception 'This record isn''t deleted'; end if;

  if p_kind = 'purchase' then
    select trip_id into v_trip from public.purchases where id = p_id;
    if v_trip is not null then raise exception 'This fuel came in on a trip. Restore the trip instead'; end if;
  elsif p_kind = 'trip_line' then
    select t.* into tr from public.trips t join public.trip_lines l on l.trip_id = t.id where l.id = p_id;
    if tr.deleted_at is not null then raise exception 'Restore trip #% first', tr.trip_no; end if;
  end if;

  if p_kind = 'trip' then
    select * into tr from public.trips where id = p_id for update;
    update public.trips set deleted_at = null, deleted_by = null, delete_reason = null, delete_note = null, void_reason = null where id = p_id;
    update public.purchases set deleted_at = null, deleted_by = null, delete_reason = null, delete_note = null
     where trip_id = p_id and deleted_at is not null and delete_reason = 'Deleted with trip';
    if tr.status = 'on_road' then
      update public.trucks set status = 'on_trip' where id = tr.truck_id and status = 'active';
    end if;
  else
    execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_note = null where id = $1', d.tbl)
      using p_id;
  end if;
end $$;

-- ===== Edits (same who-and-when rules as delete) =====
create function public.edit_expense(p_id uuid, p_date date, p_category public.expense_category, p_original_amount numeric,
  p_truck_id uuid default null, p_description text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m record; v_denied text;
begin
  if public.app_role() not in ('owner', 'manager') then raise exception 'You can''t edit expenses'; end if;
  select * into m from public.record_meta('expense', p_id);
  if m.created is null then raise exception 'Expense not found'; end if;
  if m.deleted is not null then raise exception 'This expense has been deleted'; end if;
  v_denied := public.change_denied('expense', m.creator, m.created);
  if v_denied is not null then raise exception '%', replace(v_denied, 'delete', 'edit'); end if;
  if p_original_amount is null or p_original_amount <= 0 then raise exception 'Enter the amount'; end if;
  if p_date is null or p_date > public.nairobi_today() then raise exception 'The date cannot be in the future'; end if;
  update public.expenses
     set date = p_date, category = p_category, original_amount = p_original_amount, truck_id = p_truck_id,
         description = nullif(trim(p_description), '')
   where id = p_id;
end $$;

-- Undo the old delivery, apply the new one (same tank, supplier and currency; the rate it was entered at).
create function public.edit_purchase(p_id uuid, p_litres numeric, p_cost_per_litre numeric, p_trip_cost numeric, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare m record; v_denied text; p public.purchases; v_fuel numeric; v_trip numeric; v_landed numeric;
begin
  if public.app_role() not in ('owner', 'manager') then raise exception 'You can''t edit deliveries'; end if;
  select * into m from public.record_meta('purchase', p_id);
  if m.created is null then raise exception 'Delivery not found'; end if;
  if m.deleted is not null then raise exception 'This delivery has been deleted'; end if;
  v_denied := public.change_denied('purchase', m.creator, m.created);
  if v_denied is not null then raise exception '%', replace(v_denied, 'delete', 'edit'); end if;
  select * into p from public.purchases where id = p_id for update;
  if p.trip_id is not null then raise exception 'This fuel came in on a trip and can''t be edited here'; end if;
  if p_litres is null or p_litres <= 0 then raise exception 'Enter how many litres arrived'; end if;
  if p_cost_per_litre is null or p_cost_per_litre <= 0 then raise exception 'Cost must be more than 0'; end if;
  if coalesce(p_trip_cost, 0) < 0 then raise exception 'Transport cost can''t be negative'; end if;
  if p_date is null or p_date > public.nairobi_today() then raise exception 'The delivery date cannot be in the future'; end if;

  perform public.tank_stock_out(p.tank_id, p.litres, p.landed_cost_per_litre);
  v_fuel := round(p_litres * p_cost_per_litre, 2);
  v_trip := coalesce(p_trip_cost, 0);
  update public.purchases
     set litres = p_litres, date = p_date,
         original_cost_per_litre = p_cost_per_litre, original_fuel_cost = v_fuel,
         original_trip_cost = v_trip, original_total = v_fuel + v_trip,
         cost_per_litre = p_cost_per_litre / p.fx_rate, trip_cost = v_trip / p.fx_rate
   where id = p_id
  returning landed_cost_per_litre into v_landed;
  perform public.tank_stock_in(p.tank_id, p.org_id, p_litres, v_landed);
end $$;

-- ===== Old entry points keep working, under the new rules =====
create or replace function public.void_sale(p_sale uuid, p_reason text) returns void language plpgsql
security definer set search_path = '' as $$
begin
  if not public.is_manager_up() then raise exception 'Only the owner or a sales manager can cancel a sale'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling this sale'; end if;
  if not exists (select 1 from public.sales where id = p_sale and org_id = public.current_org_id() and deleted_at is null) then
    raise exception 'Sale not found';
  end if;
  perform public.delete_record('sale', p_sale, 'Other', p_reason);
end $$;

create or replace function public.void_trip(p_trip uuid, p_reason text) returns void language plpgsql
security definer set search_path = '' as $$
begin
  if not public.is_fleet_up() then raise exception 'Only the owner or a fleet manager can void a trip'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding this trip'; end if;
  if not exists (select 1 from public.trips where id = p_trip and org_id = public.current_org_id() and deleted_at is null) then
    raise exception 'Trip not found';
  end if;
  perform public.delete_record('trip', p_trip, 'Other', p_reason);
end $$;

-- ===== Deleted items (owner: everything; sales manager: depot records, no purchase cost) =====
create view public.deleted_items as
select 'purchase'::text as kind, p.id, p.org_id, p.date, p.created_at, p.created_by, p.deleted_at, p.deleted_by, p.delete_reason, p.delete_note,
       format('Delivery: %s %s into %s', public.fmt_litres(p.litres), f.name, t.name) as title,
       case when public.is_owner() then p.cost_per_litre * p.litres + p.trip_cost end as amount, p.litres,
       p.trip_id is not null as linked
from public.purchases p join public.tanks t on t.id = p.tank_id join public.fuel_types f on f.id = p.fuel_type_id
where p.deleted_at is not null
union all
select 'sale', s.id, s.org_id, s.date, s.created_at, s.created_by, s.deleted_at, s.deleted_by, s.delete_reason, s.delete_note,
       format('Sale: %s %s, %s', public.fmt_litres(s.litres), f.name, s.payment_type), s.total, s.litres, false
from public.sales s join public.fuel_types f on f.id = s.fuel_type_id
where s.deleted_at is not null
union all
select 'expense', e.id, e.org_id, e.date, e.created_at, e.created_by, e.deleted_at, e.deleted_by, e.delete_reason, e.delete_note,
       format('Expense: %s%s', replace(e.category::text, '_', ' '), coalesce(' · ' || e.description, '')), e.amount, null, false
from public.expenses e where e.deleted_at is not null
union all
select 'credit_payment', cp.id, cp.org_id, cp.date, cp.created_at, cp.received_by, cp.deleted_at, cp.deleted_by, cp.delete_reason, cp.delete_note,
       format('Payment from %s', c.name), cp.amount, null, false
from public.credit_payments cp join public.customers c on c.id = cp.customer_id
where cp.deleted_at is not null
union all
select 'trip', tr.id, tr.org_id, tr.date, tr.created_at, tr.created_by, tr.deleted_at, tr.deleted_by, tr.delete_reason, tr.delete_note,
       format('Trip #%s: %s to %s', tr.trip_no, tr.route_from, tr.route_to), tr.fee, tr.litres_delivered, false
from public.trips tr where tr.deleted_at is not null
union all
select 'trip_line', l.id, l.org_id, l.created_at::date, l.created_at, l.created_by, l.deleted_at, l.deleted_by, l.delete_reason, l.delete_note,
       format('Trip #%s %s: %s', tr.trip_no, case l.kind when 'income' then 'income' else 'cost' end, replace(l.category, '_', ' ')),
       l.amount, null, tr.deleted_at is not null
from public.trip_lines l join public.trips tr on tr.id = l.trip_id
where l.deleted_at is not null
union all
select 'truck_expense', x.id, x.org_id, x.date, x.created_at, x.created_by, x.deleted_at, x.deleted_by, x.delete_reason, x.delete_note,
       format('Truck cost: %s, %s', replace(x.category, '_', ' '), k.plate_number), x.amount, x.litres, false
from public.truck_expenses x join public.trucks k on k.id = x.truck_id
where x.deleted_at is not null;

-- Wrap the union so the org and role filter applies to every branch.
create view public.deleted_items_safe as
select d.* from public.deleted_items d
where d.org_id = public.current_org_id()
  and (public.is_owner() or (public.app_role() = 'manager' and d.kind in ('purchase', 'sale', 'expense', 'credit_payment')));

revoke all on public.deleted_items from anon, authenticated, public;
revoke all on public.deleted_items_safe from anon, public;
grant select on public.deleted_items_safe to authenticated;

revoke execute on function public.tank_stock_in(uuid, uuid, numeric, numeric), public.tank_stock_out(uuid, numeric, numeric),
  public.deletable(text), public.change_denied(text, uuid, timestamptz), public.record_meta(text, uuid),
  public.sale_stamp_creator() from public, anon, authenticated;
revoke execute on function public.delete_preview(text, uuid), public.delete_record(text, uuid, text, text),
  public.restore_record(text, uuid), public.edit_expense(uuid, date, public.expense_category, numeric, uuid, text),
  public.edit_purchase(uuid, numeric, numeric, numeric, date) from public, anon;
grant execute on function public.delete_preview(text, uuid), public.delete_record(text, uuid, text, text),
  public.restore_record(text, uuid), public.edit_expense(uuid, date, public.expense_category, numeric, uuid, text),
  public.edit_purchase(uuid, numeric, numeric, numeric, date) to authenticated;
-- The deleted items view formats its titles with these.
grant execute on function public.fmt_money(numeric), public.fmt_litres(numeric), public.reason_text(text, text) to authenticated;

-- ===== Sales views show who entered a sale (for the Delete button) =====
create or replace view public.sales_safe as
  select id, org_id, date, created_at, tank_id, fuel_type_id, litres, price_per_litre, total,
         payment_type, customer_id, payment_ref, attendant_id, shift_id,
         currency, fx_rate, original_price_per_litre, original_total,
         delivery_date, delivery_status, delivered_at, created_by
  from public.sales
  where deleted_at is null
    and org_id = public.current_org_id()
    and (public.is_manager_up()
         or (public.app_role() = 'attendant' and attendant_id = auth.uid()));

create or replace view public.sales_ledger as
  select id, org_id, date, created_at, tank_id, fuel_type_id, litres, price_per_litre, total,
         payment_type, customer_id, payment_ref, attendant_id, shift_id,
         currency, fx_rate, original_price_per_litre, original_total,
         delivery_date, delivery_status, delivered_at, deleted_at, void_reason,
         created_by, deleted_by, delete_reason, delete_note
  from public.sales
  where org_id = public.current_org_id() and public.is_manager_up();
