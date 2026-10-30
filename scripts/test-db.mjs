// Runs the Supabase migrations against an in-memory Postgres (PGlite) with a stubbed
// `auth` schema, then checks the profit maths, business rules, role isolation inside an
// organization, and isolation between organizations (tenants).
// Usage: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to authenticated, anon;
  grant usage on schema public to authenticated, anon;
  create table auth.users (id uuid primary key, email text,
    raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to authenticated, anon;
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const f of readdirSync(join(root, "supabase/migrations")).sort()) {
    await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
  }
  return db;
}

// ---------- ids ----------
const A_OWNER = "a0000000-0000-0000-0000-000000000001";
const A_MANAGER = "a0000000-0000-0000-0000-000000000002";
const A_ATT = "a0000000-0000-0000-0000-000000000003";
const B_OWNER = "b0000000-0000-0000-0000-000000000001";
const B_ATT = "b0000000-0000-0000-0000-000000000003";
const A_TANK = "a2000000-0000-0000-0000-000000000001";
const A_SUP = "a3000000-0000-0000-0000-000000000001";
const A_TRUCK = "a4000000-0000-0000-0000-000000000001";
const A_CUST = "a5000000-0000-0000-0000-000000000001";
const A_SHIFT = "a6000000-0000-0000-0000-000000000001";
const B_TANK = "b2000000-0000-0000-0000-000000000001";
const B_SUP = "b3000000-0000-0000-0000-000000000001";
const B_TRUCK = "b4000000-0000-0000-0000-000000000001";
const B_CUST = "b5000000-0000-0000-0000-000000000001";
const B_SHIFT = "b6000000-0000-0000-0000-000000000001";
const B_DRIVER = "b7000000-0000-0000-0000-000000000001";
const B_SALE = "b8000000-0000-0000-0000-000000000001";
const B_PURCHASE = "b9000000-0000-0000-0000-000000000001";
const B_PAYMENT = "ba000000-0000-0000-0000-000000000001";
const B_EXPENSE = "bb000000-0000-0000-0000-000000000001";

// ---------- assertion helpers ----------
let passed = 0;
let failed = 0;
const results = [];
let db;

function record(section, name, ok, actual, expected) {
  results.push({ section, name, ok, actual, expected });
  if (ok) passed++;
  else failed++;
}
let section = "";
const check = (name, actual, expected) =>
  record(section, name, Number(actual).toFixed(2) === Number(expected).toFixed(2),
    Number(actual).toFixed(2), Number(expected).toFixed(2));
const checkTrue = (name, cond, detail = "") => record(section, name, !!cond, cond ? "yes" : `no ${detail}`, "yes");
async function expectError(name, sql, match) {
  try {
    await db.exec(sql);
    checkTrue(name, false, "(no error raised)");
  } catch (e) {
    checkTrue(name, String(e.message).includes(match), `(${e.message})`);
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const count = async (sql) => Number((await one(sql)).n);
const asUser = (id) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;`);
const asAnon = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`);
const asAdmin = () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);

// =====================================================================================
db = await freshDb();

// ---------- Sign-up creates the organization atomically ----------
section = "Sign-up";
await db.exec(`
  insert into auth.users(id, email, raw_user_meta_data) values
    ('${A_OWNER}', 'owner@alpha.ke', '{"business_name":"Alpha Fuels","full_name":"Ann Owner"}'),
    ('${B_OWNER}', 'owner@beta.ke',  '{"business_name":"Beta Petroleum","full_name":"Ben Owner"}');
`);
const ORG_A = (await one(`select org_id from profiles where id = '${A_OWNER}'`)).org_id;
const ORG_B = (await one(`select org_id from profiles where id = '${B_OWNER}'`)).org_id;
checkTrue("Each sign-up gets its own organization", ORG_A && ORG_B && ORG_A !== ORG_B);
checkTrue("Sign-up user becomes the org owner", (await one(`select role from profiles where id = '${A_OWNER}'`)).role === "owner");
checkTrue("Organization named from the business name",
  (await one(`select name from organizations where id = '${ORG_A}'`)).name === "Alpha Fuels");
checkTrue("Default fuel types Petrol, Diesel, Kerosene created",
  (await one(`select string_agg(name, ',' order by name) s from fuel_types where org_id = '${ORG_A}'`)).s === "Diesel,Kerosene,Petrol");

// Staff are created by the owner with server-side app_metadata.
await db.exec(`
  insert into auth.users(id, email, raw_app_meta_data) values
    ('${A_MANAGER}', 'mgr@alpha.ke', '{"org_id":"${ORG_A}","role":"manager"}'),
    ('${A_ATT}',     'att@alpha.ke', '{"org_id":"${ORG_A}","role":"attendant"}'),
    ('${B_ATT}',     'att@beta.ke',  '{"org_id":"${ORG_B}","role":"attendant"}');
`);
checkTrue("Staff join the owner's org with the given role",
  (await one(`select org_id, role from profiles where id = '${A_MANAGER}'`)).org_id === ORG_A &&
  (await one(`select role from profiles where id = '${A_ATT}'`)).role === "attendant");
await expectError("Staff path cannot create a second owner",
  `insert into auth.users(id, email, raw_app_meta_data) values (gen_random_uuid(), 'x@alpha.ke', '{"org_id":"${ORG_A}","role":"owner"}')`,
  "Staff accounts can only be");
await expectError("Staff path rejects an unknown organization",
  `insert into auth.users(id, email, raw_app_meta_data) values (gen_random_uuid(), 'y@alpha.ke', '{"org_id":"00000000-0000-0000-0000-00000000dead","role":"attendant"}')`,
  "Organization not found");
checkTrue("Failed sign-up leaves no partial rows (atomic)",
  (await count(`select count(*) n from auth.users where email in ('x@alpha.ke','y@alpha.ke')`)) === 0 &&
  (await count(`select count(*) n from organizations`)) === 2);

// ---------- Reference data for both orgs (system context passes org_id explicitly) ----------
const FT = async (org, name) => (await one(`select id from fuel_types where org_id = '${org}' and name = '${name}'`)).id;
const A_PETROL = await FT(ORG_A, "Petrol");
const B_PETROL = await FT(ORG_B, "Petrol");
await db.exec(`
  update fuel_types set current_selling_price = 180 where id = '${A_PETROL}';
  update fuel_types set current_selling_price = 190 where id = '${B_PETROL}';
  insert into tanks(id, org_id, name, fuel_type_id, capacity_litres, current_litres, low_stock_level) values
    ('${A_TANK}', '${ORG_A}', 'A1', '${A_PETROL}', 25000, 99999, 2000),
    ('${B_TANK}', '${ORG_B}', 'B1', '${B_PETROL}', 25000, 0, 2000);
  insert into suppliers(id, org_id, name) values ('${A_SUP}', '${ORG_A}', 'S-A'), ('${B_SUP}', '${ORG_B}', 'S-B');
  insert into drivers(id, org_id, name) values ('${B_DRIVER}', '${ORG_B}', 'Driver B');
  insert into trucks(id, org_id, plate_number, capacity_litres) values
    ('${A_TRUCK}', '${ORG_A}', 'KAA 001A', 15000),
    ('${B_TRUCK}', '${ORG_B}', 'KAA 001A', 15000);
  insert into customers(id, org_id, name, credit_limit, balance) values
    ('${A_CUST}', '${ORG_A}', 'C-A', 100000, 77777),
    ('${B_CUST}', '${ORG_B}', 'C-B', 500000, 0);
`);

section = "Per-org uniqueness and integrity";
checkTrue("Same truck plate allowed in two different orgs",
  (await count(`select count(*) n from trucks where plate_number = 'KAA 001A'`)) === 2);
await expectError("Duplicate truck plate within one org is rejected",
  `insert into trucks(org_id, plate_number, capacity_litres) values ('${ORG_A}', 'KAA 001A', 1000)`, "duplicate key");
checkTrue("Tank opening litres forced to 0", Number((await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l) === 0);
checkTrue("Customer opening balance forced to 0", Number((await one(`select balance b from customers where id = '${A_CUST}'`)).b) === 0);
await expectError("System insert without org_id is rejected",
  `insert into drivers(name) values ('No org')`, "org_id is required");
await expectError("Records cannot be moved between orgs (even by the system)",
  `update trucks set org_id = '${ORG_B}' where id = '${A_TRUCK}'`, "cannot be moved");
await expectError("Composite FK backstop: org A tank cannot use org B fuel type",
  `insert into tanks(org_id, name, fuel_type_id, capacity_litres) values ('${ORG_A}', 'X', '${B_PETROL}', 100)`, "Fuel type not found");

// Org B activity, so there is something to try to steal.
await db.exec(`
  insert into purchases(id, org_id, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost)
    values ('${B_PURCHASE}', '${ORG_B}', '${B_SUP}', '${B_TRUCK}', '${B_TANK}', 8000, 170, 8000);
  insert into shifts(id, org_id, attendant_id) values ('${B_SHIFT}', '${ORG_B}', '${B_ATT}');
  insert into sales(id, org_id, tank_id, litres, payment_type, customer_id, attendant_id)
    values ('${B_SALE}', '${ORG_B}', '${B_TANK}', 1000, 'credit', '${B_CUST}', '${B_OWNER}');
  insert into credit_payments(id, org_id, customer_id, amount, method, received_by)
    values ('${B_PAYMENT}', '${ORG_B}', '${B_CUST}', 10000, 'cash', '${B_OWNER}');
  insert into expenses(id, org_id, category, amount, truck_id) values ('${B_EXPENSE}', '${ORG_B}', 'truck_repairs', 7000, '${B_TRUCK}');
  insert into stock_adjustments(org_id, tank_id, dip_litres, reason, system_litres) values ('${ORG_B}', '${B_TANK}', 6990, 'B dip', 0);
`);
const bSnapshot = async () => {
  await asAdmin();
  return JSON.stringify((await db.query(`
    select (select current_litres from tanks where id = '${B_TANK}') litres,
           (select balance from customers where id = '${B_CUST}') balance,
           (select count(*) from sales where org_id = '${ORG_B}' and deleted_at is null) sales,
           (select count(*) from purchases where org_id = '${ORG_B}' and deleted_at is null) purchases,
           (select count(*) from credit_payments where org_id = '${ORG_B}' and deleted_at is null) payments,
           (select count(*) from expenses where org_id = '${ORG_B}' and deleted_at is null) expenses,
           (select string_agg(plate_number || ':' || coalesce(notes, ''), ',') from trucks where org_id = '${ORG_B}') trucks,
           (select string_agg(name, ',') from drivers where org_id = '${ORG_B}') drivers,
           (select string_agg(name, ',') from suppliers where org_id = '${ORG_B}') suppliers,
           (select string_agg(name || ':' || current_selling_price, ',' order by name) from fuel_types where org_id = '${ORG_B}') prices,
           (select low_stock_level from tanks where id = '${B_TANK}') low_stock,
           (select credit_limit from customers where id = '${B_CUST}') credit_limit,
           (select sum(amount) from expenses where org_id = '${ORG_B}') expense_total,
           (select string_agg(id || ':' || active, ',') from profiles where org_id = '${ORG_B}') staff,
           (select count(*) from stock_adjustments where org_id = '${ORG_B}') adjustments,
           (select count(*) from shifts where org_id = '${ORG_B}' and ended_at is null) open_shifts,
           (select name from organizations where id = '${ORG_B}') org`)).rows[0]);
};
const B_BEFORE = await bSnapshot();

// =====================================================================================
// Profit maths and business rules (inside org A)
// Deliveries go through add_stock() (owner and sales manager only).
const purchase = (litres, cpl, trip) => `
  select add_stock(p_fuel_type_id := '${A_PETROL}', p_litres := ${litres}, p_cost_per_litre := ${cpl},
    p_tank_id := '${A_TANK}', p_supplier_id := '${A_SUP}', p_truck_id := '${A_TRUCK}', p_trip_cost := ${trip});`;
const avgCost = async () => Number((await one(`select avg_cost_per_litre a from tank_costing where tank_id = '${A_TANK}'`)).a);
const tankLitres = async () => Number((await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l);

section = "Profit maths";
await asUser(A_MANAGER);
await db.exec(purchase(10000, 150, 20000));
await asAdmin();
const p1 = await one(`select fuel_cost, landed_cost_per_litre, org_id from purchases where tank_id = '${A_TANK}' order by created_at limit 1`);
checkTrue("Manager's delivery is stamped with org A", p1.org_id === ORG_A);
check("Case 1: fuel cost 10,000 L x 150", p1.fuel_cost, 1500000);
check("Case 1: landed cost (1,500,000 + 20,000) / 10,000", p1.landed_cost_per_litre, 152);
check("Case 1: tank after delivery", await tankLitres(), 10000);

await asUser(A_OWNER);
await db.exec(purchase(5000, 160, 10000)); // landed 162
await asAdmin();
const expAvg2 = (10000 * 152 + 5000 * 162) / 15000;
check("Case 2: weighted avg (10k@152 + 5k@162)/15k", await avgCost(), expAvg2.toFixed(6));
check("Case 2: tank litres", await tankLitres(), 15000);

await db.exec(`insert into shifts(id, org_id, attendant_id) values ('${A_SHIFT}', '${ORG_A}', '${A_ATT}');`);
await asUser(A_ATT);
await db.exec(`insert into sales(tank_id, litres, payment_type) values ('${A_TANK}', 1000, 'cash');`);
await asAdmin();
const s1 = await one(`select total, cost_total, price_per_litre, shift_id from sales where org_id = '${ORG_A}'`);
check("Case 3: no amount entered → pump price used (USD)", s1.price_per_litre, 180);
check("Case 3: sales 1,000 L x 180", s1.total, 180000);
// Average cost is kept to 6 decimals in base currency.
const avg4 = Number(expAvg2.toFixed(6));
check("Case 3: cost of fuel sold 1,000 x 155.333333", s1.cost_total, (1000 * avg4).toFixed(2));
checkTrue("Case 3: sale attached to attendant's open shift", s1.shift_id === A_SHIFT);
await asUser(A_MANAGER);
await db.exec(`insert into expenses(category, amount) values ('electricity', 5000);`);
await asUser(A_OWNER);
const ds = await one(`select sum(sales) s, sum(gross_profit) g, sum(net_profit) n from daily_summary`);
check("Case 3: daily_summary gross profit 180,000 - 155,333.33 (org A only)", ds.g, 180000 - 1000 * avg4);
check("Case 3: daily_summary net profit (gross - 5,000 expenses)", ds.n, 180000 - 1000 * avg4 - 5000);
const sv = await one(`select sum(value) value from stock_value`);
check("Case 4: stock value 14,000 L x 155.333333 (org A only)", sv.value, (14000 * avg4).toFixed(2));
await asAdmin();

await asUser(A_OWNER);
await db.exec(purchase(6000, 157, 6000)); // landed 158
await asAdmin();
const expAvg5 = (14000 * avg4 + 6000 * 158) / 20000;
check("Case 5: weighted avg (14k@155.3333 + 6k@158)/20k", await avgCost(), expAvg5.toFixed(4));
await asUser(A_OWNER);
await db.exec(`insert into sales(tank_id, litres, original_price_per_litre, payment_type) values ('${A_TANK}', 2000, 185, 'cash');`);
await asAdmin();
const s2 = await one(`select total, cost_total from sales where litres = 2000 and org_id = '${ORG_A}'`);
check("Case 5: second sale gross profit 2,000 x (185 - 156.1333)", Number(s2.total) - Number(s2.cost_total),
  (370000 - 2000 * Number(expAvg5.toFixed(6))).toFixed(2));

section = "Business rules";
await asUser(A_OWNER);
await expectError("A sale cannot exceed the stock in the tank",
  `insert into sales(tank_id, litres, payment_type) values ('${A_TANK}', 999999, 'cash');`, "Not enough fuel");
await expectError("Credit sale without customer is rejected",
  `insert into sales(tank_id, litres, payment_type) values ('${A_TANK}', 10, 'credit');`, "need a customer");
await expectError("Credit sale over limit is rejected (600 L x 180 > 100,000)",
  `insert into sales(tank_id, litres, payment_type, customer_id) values ('${A_TANK}', 600, 'credit', '${A_CUST}');`, "Credit limit exceeded");
const mob = (await db.query(`insert into sales(tank_id, litres, payment_type) values ('${A_TANK}', 10, 'mobile') returning id`)).rows[0];
checkTrue("Mobile money sale without a reference is allowed", !!mob);
await expectError("Cancelling a sale needs a reason", `update sales set deleted_at = now() where id = '${mob.id}'`, "Give a reason");
await db.exec(`update sales set deleted_at = now(), void_reason = 'Test sale' where id = '${mob.id}'`);
await expectError("Adding stock without a truck is rejected",
  `select add_stock(p_fuel_type_id := '${A_PETROL}', p_litres := 100, p_cost_per_litre := 150, p_tank_id := '${A_TANK}', p_supplier_id := '${A_SUP}')`, "Choose or add a truck");
await asAdmin();

await db.exec(`insert into sales(id, org_id, tank_id, litres, payment_type, customer_id, attendant_id) values
  ('a8000000-0000-0000-0000-000000000001', '${ORG_A}', '${A_TANK}', 500, 'credit', '${A_CUST}', '${A_OWNER}');`);
check("Credit: balance after 500 L credit sale", (await one(`select balance from customers where id = '${A_CUST}'`)).balance, 90000);
await asUser(A_MANAGER);
await db.exec(`insert into credit_payments(customer_id, amount, method) values ('${A_CUST}', 30000, 'mobile');`);
await asAdmin();
check("Credit: balance after 30,000 payment", (await one(`select balance from customers where id = '${A_CUST}'`)).balance, 60000);
await asUser(A_MANAGER);
await expectError("Credit: overpayment is rejected",
  `insert into credit_payments(customer_id, amount, method) values ('${A_CUST}', 70000, 'cash');`, "exceeds balance");
await asAdmin();
const litresBeforeVoid = await tankLitres();
await asUser(A_OWNER);
await db.exec(`update sales set deleted_at = now(), void_reason = 'Customer cancelled' where id = 'a8000000-0000-0000-0000-000000000001';`);
await asAdmin();
check("Void: credit sale void restores tank litres", await tankLitres(), litresBeforeVoid + 500);
check("Void: credit sale void reduces balance by 90,000", (await one(`select balance from customers where id = '${A_CUST}'`)).balance, -30000);
await expectError("Soft delete: hard DELETE is blocked", `delete from sales;`, "Hard delete is not allowed");
checkTrue("Audit: sale void logged as SOFT_DELETE with org A",
  (await count(`select count(*) n from audit_log where table_name = 'sales' and action = 'SOFT_DELETE' and org_id = '${ORG_A}' and record_id = 'a8000000-0000-0000-0000-000000000001'`)) === 1);
await expectError("Audit: audit_log cannot be edited", `update audit_log set action = 'X';`, "append-only");

section = "Roles inside one org";
await asUser(A_ATT);
checkTrue("Attendant cannot read sales base table (cost hidden)", (await count(`select count(*) n from sales`)) === 0);
checkTrue("Attendant sees only own sales in sales_safe", (await count(`select count(*) n from sales_safe`)) === 1);
checkTrue("Attendant cannot read daily_summary", (await count(`select count(*) n from daily_summary`)) === 0);
await expectError("An attendant cannot add stock", purchase(10, 150, 0), "Only the owner or a sales manager");
await expectError("An attendant cannot insert deliveries directly either",
  `insert into purchases(supplier_id, truck_id, tank_id, litres, cost_per_litre) values ('${A_SUP}', '${A_TRUCK}', '${A_TANK}', 1, 1)`, "permission denied");
await expectError("Attendant cannot set tank litres directly", `update tanks set current_litres = 1;`, "permission denied");
await asUser(A_MANAGER);
checkTrue("Manager cannot read tank cost basis", (await count(`select count(*) n from tank_costing`)) === 0);
checkTrue("Sales manager can see what was paid for stock", (await count(`select count(*) n from purchases where cost_per_litre > 0`)) === 3);
checkTrue("Manager sees org A deliveries via purchases_safe", (await count(`select count(*) n from purchases_safe`)) === 3);
checkTrue("Manager cannot read stock_value / truck_performance",
  (await count(`select count(*) n from stock_value`)) === 0 && (await count(`select count(*) n from truck_performance`)) === 0);
checkTrue("Manager cannot read audit log", (await count(`select count(*) n from audit_log`)) === 0);
checkTrue("Sales manager cannot void a sale by editing it directly", (await db.query(`update sales set deleted_at = now(), void_reason = 'x' returning id`)).rows.length === 0);
checkTrue("Sales manager cannot read profit (sale cost) columns", (await count(`select count(*) n from sales`)) === 0);
checkTrue("Manager cannot change staff roles",
  (await db.query(`update profiles set role = 'attendant' where id = '${A_ATT}' returning id`)).rows.length === 0);
await asUser(A_OWNER);
checkTrue("Owner reads own org's audit log", (await count(`select count(*) n from audit_log`)) > 0);
checkTrue("Owner cannot promote staff to owner",
  await expectRlsBlock(`update profiles set role = 'owner' where id = '${A_MANAGER}'`));
checkTrue("Owner cannot change their own profile role",
  (await db.query(`update profiles set role = 'manager' where id = '${A_OWNER}' returning id`)).rows.length === 0);
await asAdmin();

async function expectRlsBlock(sql) {
  try {
    const r = await db.query(`${sql} returning id`);
    return r.rows.length === 0;
  } catch (e) {
    return /row-level security|permission denied/.test(e.message);
  }
}

section = "Shift variance";
await asUser(A_ATT);
const sh = await one(`select * from end_shift('${A_SHIFT}', 179500)`);
await asAdmin();
check("Expected cash = cash sales in shift", sh.expected_cash, 180000);
check("Variance = 179,500 - 180,000", sh.variance, -500);

// =====================================================================================
// Multi-currency (base USD) and the add-stock / scheduled-delivery flow, inside org A.
section = "Multi-currency";
let SDG_SALE, SDG_SALE2;
await asAdmin();
checkTrue("Organization base currency defaults to USD", (await one(`select base_currency c from organizations where id = '${ORG_A}'`)).c === "USD");
checkTrue("Sign-up seeds placeholder SDG and SSP rates flagged 'update me'",
  (await count(`select count(*) n from exchange_rates where org_id = '${ORG_A}' and is_placeholder`)) === 2);
await asUser(A_MANAGER);
await expectError("Only the owner can set exchange rates", `select set_exchange_rate('SDG', 2500)`, "Only the owner");
await asUser(A_OWNER);
await db.exec(`select set_exchange_rate('SDG', 2500)`);
SDG_SALE = (await one(`insert into sales(tank_id, litres, payment_type, currency, original_total)
  values ('${A_TANK}', 100, 'cash', 'SDG', 450000) returning id`)).id;
await asAdmin();
const sd = await one(`select total, fx_rate, original_total, currency, cost_total, cost_per_litre from sales where id = '${SDG_SALE}'`);
check("Sale of 450,000 SDG at 1 USD = 2,500 SDG is stored as 180.00 USD", sd.total, 180);
checkTrue("The sale keeps its original currency, amount and the rate used",
  sd.currency === "SDG" && Number(sd.original_total) === 450000 && Number(sd.fx_rate) === 2500);
const avgBefore = Number(expAvg5.toFixed(6));
check("Profit is computed in USD: 180.00 − 100 L × average USD cost", Number(sd.total) - Number(sd.cost_total),
  (180 - Number((100 * Number(sd.cost_per_litre)).toFixed(2))).toFixed(2));
check("…and the USD cost per litre is the tank's weighted average", sd.cost_per_litre, avgBefore.toFixed(4));

await asUser(A_OWNER);
await db.exec(`select set_exchange_rate('SDG', 3000)`);
SDG_SALE2 = (await one(`insert into sales(tank_id, litres, payment_type, currency, original_total)
  values ('${A_TANK}', 100, 'cash', 'SDG', 450000) returning id`)).id;
await asAdmin();
check("An old sale keeps its old rate after the rate changes (still 180.00 USD)",
  (await one(`select total from sales where id = '${SDG_SALE}'`)).total, 180);
check("The same 450,000 SDG at the new rate (3,000) is 150.00 USD",
  (await one(`select total from sales where id = '${SDG_SALE2}'`)).total, 150);
await asUser(A_OWNER);
await expectError("A currency the business hasn't enabled is rejected",
  `insert into sales(tank_id, litres, payment_type, currency, original_total) values ('${A_TANK}', 1, 'cash', 'KES', 100)`, "KES is not enabled");

section = "Add stock and sales flow";
const A_DIESEL = await (async () => { await asAdmin(); return FT(ORG_A, "Diesel"); })();
await asUser(A_OWNER);
await db.exec(`select set_exchange_rate('SSP', 5000)`);
// Sales manager adds diesel for the first time: the tank, truck and price are created in one step.
await asUser(A_MANAGER);
await db.exec(`select add_stock(p_fuel_type_id := '${A_DIESEL}', p_litres := 2000, p_currency := 'SSP',
  p_cost_total := 10000000, p_selling_price := 7500, p_new_tank_name := 'Diesel tank', p_new_tank_capacity := 10000,
  p_supplier_id := '${A_SUP}', p_new_truck_plate := 'kbb  222b')`);
await asAdmin();
const dTank = await one(`select id, current_litres from tanks where org_id = '${ORG_A}' and name = 'Diesel tank'`);
const dPurchase = await one(`select currency, original_total, cost_per_litre, fuel_cost from purchases where tank_id = '${dTank.id}'`);
checkTrue("Adding stock for a fuel with no tank creates the tank", !!dTank);
check("The new tank holds the 2,000 L delivered", dTank.current_litres, 2000);
check("10,000,000 SSP for 2,000 L at 1 USD = 5,000 SSP is 1.00 USD per litre", dPurchase.cost_per_litre, 1);
checkTrue("The delivery keeps its SSP amount", dPurchase.currency === "SSP" && Number(dPurchase.original_total) === 10000000);
check("Selling price of 7,500 SSP/L is stored as 1.50 USD/L", (await one(`select current_selling_price p from fuel_types where id = '${A_DIESEL}'`)).p, 1.5);
checkTrue("A new truck typed during add-stock is created (plate tidied)",
  (await count(`select count(*) n from trucks where org_id = '${ORG_A}' and plate_number = 'KBB 222B'`)) === 1);

await asUser(A_MANAGER);
await db.exec(`insert into sales(tank_id, litres, payment_type) values ('${dTank.id}', 500, 'cash')`);
await asAdmin();
const dSale = await one(`select total, cost_total from sales where tank_id = '${dTank.id}' order by created_at limit 1`);
checkTrue("Stock added is sellable immediately", !!dSale);
check("Diesel sale: 500 L × 1.50 USD = 750.00 USD", dSale.total, 750);
check("Profit on it in USD: 750.00 − 500 L × 1.00 = 250.00", Number(dSale.total) - Number(dSale.cost_total), 250);
await asUser(A_MANAGER);
await expectError("A sale cannot exceed stock (1,600 L asked, 1,500 L left)",
  `insert into sales(tank_id, litres, payment_type) values ('${dTank.id}', 1600, 'cash')`, "Not enough fuel");

// (A sales manager can't read the sales table, so no RETURNING here.)
await db.exec(`insert into sales(tank_id, litres, payment_type, delivery_date, delivery_status)
  values ('${dTank.id}', 100, 'cash', current_date + 2, 'scheduled')`);
await asAdmin();
const schedRow = await one(`select id, delivery_status, delivered_at from sales where tank_id = '${dTank.id}' and delivery_status = 'scheduled'`);
check("A scheduled sale takes the litres out straight away (1,500 → 1,400)",
  (await one(`select current_litres l from tanks where id = '${dTank.id}'`)).l, 1400);
checkTrue("Scheduled sale is waiting for delivery", schedRow && !schedRow.delivered_at);
await asUser(A_MANAGER);
await db.exec(`select mark_sale_delivered('${schedRow.id}')`);
await asAdmin();
checkTrue("Marking it delivered records when", !!(await one(`select delivered_at from sales where id = '${schedRow.id}'`)).delivered_at);
await asUser(A_MANAGER);
await db.exec(`insert into sales(tank_id, litres, payment_type, delivery_date, delivery_status)
  values ('${dTank.id}', 200, 'cash', current_date + 3, 'scheduled')`);
await asAdmin();
const toCancel = (await one(`select id from sales where tank_id = '${dTank.id}' and delivery_status = 'scheduled' and deleted_at is null`)).id;
await asUser(A_MANAGER);
await expectError("Cancelling needs a reason", `select void_sale('${toCancel}', '  ')`, "Give a reason");
await db.exec(`select void_sale('${toCancel}', 'Customer changed their mind')`);
await asAdmin();
check("Cancelling puts the litres back (1,200 → 1,400)", (await one(`select current_litres l from tanks where id = '${dTank.id}'`)).l, 1400);
checkTrue("The cancel reason is kept", (await one(`select void_reason r from sales where id = '${toCancel}'`)).r === "Customer changed their mind");
await asUser(A_ATT);
await expectError("An attendant cannot cancel a sale", `select void_sale('${toCancel}', 'x')`, "Only the owner or a sales manager");

await asUser(A_MANAGER);
await db.exec(`insert into expenses(category, currency, original_amount) values ('rent', 'SDG', 300000)`);
await asAdmin();
check("Expense of 300,000 SDG at 3,000 is 100.00 USD", (await one(`select amount from expenses where original_amount = 300000`)).amount, 100);

// A fresh open shift, so the attendant's sale attempts reach the org checks.
await asUser(A_ATT);
await db.exec(`select start_shift()`);
await asAdmin();

// =====================================================================================
// Cross-tenant isolation: every org A role tries to read, write, edit and void org B.
const TABLES = ["profiles", "drivers", "trucks", "suppliers", "fuel_types", "tanks", "tank_costing", "purchases",
  "customers", "shifts", "sales", "credit_payments", "expenses", "stock_adjustments", "audit_log"];
const ORG_VIEWS = ["purchases_safe", "sales_safe", "truck_performance", "stock_value", "customer_balances"];

for (const [label, uid] of [["owner", A_OWNER], ["manager", A_MANAGER], ["attendant", A_ATT]]) {
  section = `Cross-tenant: org A ${label} vs org B`;
  await asUser(uid);
  checkTrue("current_org_id() is org A", (await one(`select public.current_org_id() id`)).id === ORG_A);
  checkTrue("Cannot read org B's organization row", (await count(`select count(*) n from organizations where id = '${ORG_B}'`)) === 0);
  const leaks = [];
  for (const t of TABLES) if ((await count(`select count(*) n from ${t} where org_id = '${ORG_B}'`)) > 0) leaks.push(t);
  checkTrue(`Reads 0 org B rows from all ${TABLES.length} tables`, leaks.length === 0, leaks.join(","));
  const vleaks = [];
  for (const v of ORG_VIEWS) if ((await count(`select count(*) n from ${v} where org_id = '${ORG_B}'`)) > 0) vleaks.push(v);
  checkTrue(`Reads 0 org B rows from ${ORG_VIEWS.length} org-tagged views`, vleaks.length === 0, vleaks.join(","));
  checkTrue("Cannot look up org B rows by id either",
    (await count(`select count(*) n from sales_safe where id = '${B_SALE}'`)) === 0 &&
    (await count(`select count(*) n from tanks where id = '${B_TANK}'`)) === 0);

  // Writes that reference org B's records
  await expectError("Sale on org B's tank is rejected",
    `insert into sales(tank_id, litres, payment_type) values ('${B_TANK}', 1, 'cash')`, "Tank not found");
  await expectError("Credit sale for org B's customer is rejected",
    `insert into sales(tank_id, litres, payment_type, customer_id) values ('${A_TANK}', 1, 'credit', '${B_CUST}')`,
    label === "attendant" ? "Customer not found" : "Customer not found");
  await expectError("Payment against org B's customer is rejected",
    `insert into credit_payments(customer_id, amount, method) values ('${B_CUST}', 1, 'cash')`, "Customer not found");
  await expectError("Cannot write org_id directly",
    `insert into drivers(org_id, name) values ('${ORG_B}', 'Spoof')`, "permission denied");
  await expectError("Cannot call internal trigger helpers",
    `select public.assert_same_org('tanks', '${B_TANK}', '${ORG_B}', 'x')`, "permission denied");
  await expectError("Cannot close org B's shift", `select * from end_shift('${B_SHIFT}', 0)`, "No open shift found");

  if (label !== "attendant") {
    const stock = (tank, sup, truck, fuel = A_PETROL) => `select add_stock(p_fuel_type_id := '${fuel}', p_litres := 1, p_cost_per_litre := 1,
      p_tank_id := '${tank}', p_supplier_id := '${sup}', p_truck_id := '${truck}')`;
    await expectError("Adding stock with org B's truck is rejected", stock(A_TANK, A_SUP, B_TRUCK), "Truck not found");
    await expectError("Adding stock from org B's supplier is rejected", stock(A_TANK, B_SUP, A_TRUCK), "Supplier not found");
    await expectError("Adding stock into org B's tank is rejected", stock(B_TANK, A_SUP, A_TRUCK), "Tank not found");
    await expectError("Adding stock of org B's fuel type is rejected", stock(A_TANK, A_SUP, A_TRUCK, B_PETROL), "Fuel type not found");
    await expectError("Cannot cancel org B's sale", `select void_sale('${B_SALE}', 'x')`, "Sale not found");
    await expectError("Cannot mark org B's sale delivered", `select mark_sale_delivered('${B_SALE}')`, "Scheduled sale not found");
    await expectError("Dip reading on org B's tank is rejected",
      `insert into stock_adjustments(tank_id, dip_litres, reason, system_litres) values ('${B_TANK}', 1, 'x', 0)`, "Tank not found");
    await expectError("Expense tagged to org B's truck is rejected",
      `insert into expenses(category, amount, truck_id) values ('truck_repairs', 1, '${B_TRUCK}')`, "Truck not found");
    await expectError("Truck with org B's driver is rejected",
      `insert into trucks(plate_number, capacity_litres, driver_id) values ('KZZ 999Z', 1, '${B_DRIVER}')`, "Driver not found");
    await expectError("Tank with org B's fuel type is rejected",
      `insert into tanks(name, fuel_type_id, capacity_litres) values ('X', '${B_PETROL}', 1)`, "Fuel type not found");
    await expectError("Sale recorded for org B's attendant is rejected",
      `insert into sales(tank_id, litres, payment_type, attendant_id) values ('${A_TANK}', 1, 'cash', '${B_ATT}')`, "");
  }

  // Edits and voids aimed at org B
  const edits = {
    organizations: `update organizations set name = 'Hacked' where id = '${ORG_B}'`,
    profiles: `update profiles set active = false where id = '${B_ATT}'`,
    trucks: `update trucks set notes = 'hacked' where id = '${B_TRUCK}'`,
    drivers: `update drivers set name = 'hacked' where id = '${B_DRIVER}'`,
    suppliers: `update suppliers set name = 'hacked' where id = '${B_SUP}'`,
    fuel_types: `update fuel_types set current_selling_price = 1 where id = '${B_PETROL}'`,
    tanks: `update tanks set low_stock_level = 1 where id = '${B_TANK}'`,
    customers: `update customers set credit_limit = 1 where id = '${B_CUST}'`,
    expenses: `update expenses set amount = 1 where id = '${B_EXPENSE}'`,
    "sales (void)": `update sales set deleted_at = now() where id = '${B_SALE}'`,
    "purchases (void)": `update purchases set deleted_at = now() where id = '${B_PURCHASE}'`,
    "credit_payments (void)": `update credit_payments set deleted_at = now() where id = '${B_PAYMENT}'`,
  };
  const editLeaks = [];
  for (const [t, sql] of Object.entries(edits)) if (!(await expectRlsBlock(sql))) editLeaks.push(t);
  checkTrue(`Cannot edit or void anything in org B (${Object.keys(edits).length} attempts)`, editLeaks.length === 0, editLeaks.join(","));
}
await asAdmin();

section = "Cross-tenant: org B unaffected and still private";
checkTrue("Org B data is byte-for-byte unchanged after all attacks", (await bSnapshot()) === B_BEFORE);
await asUser(B_OWNER);
const bTotals = await one(`select sum(sales) s from daily_summary`);
check("Org B's daily_summary shows only its own sales (1,000 L x 190)", bTotals.s, 190000);
checkTrue("Org B owner sees 0 org A rows in every table", await (async () => {
  for (const t of TABLES) if ((await count(`select count(*) n from ${t} where org_id = '${ORG_A}'`)) > 0) return false;
  return true;
})());
checkTrue("Org B owner sees only org B in audit log",
  (await count(`select count(*) n from audit_log where org_id <> '${ORG_B}'`)) === 0 && (await count(`select count(*) n from audit_log`)) > 0);
await asUser(A_OWNER);
checkTrue("Org A daily_summary / monthly_summary / daily_sales_summary exclude org B sales", await (async () => {
  const d = Number((await one(`select sum(sales) s from daily_summary`)).s);
  const m = Number((await one(`select sum(sales) s from monthly_summary`)).s);
  const ds2 = Number((await one(`select sum(sales) s from daily_sales_summary`)).s);
  await asAdmin();
  const own = Number((await one(`select sum(total) s from sales where org_id = '${ORG_A}' and deleted_at is null`)).s);
  await asUser(A_OWNER);
  return d === own && m === own && ds2 === own;
})());

// =====================================================================================
// Truck Business module (spliced into test-db.mjs before "Signed out and deactivated").
section = "Truck business: roles and trips";
const A_FLEET = "a0000000-0000-0000-0000-000000000004";
const A_DRIVER_USER = "a0000000-0000-0000-0000-000000000005";
const A_DRV = "a7000000-0000-0000-0000-000000000001";
const B_DRV = "b7000000-0000-0000-0000-000000000002";
const B_TRIP = "bd000000-0000-0000-0000-000000000001";
await asAdmin();
await db.exec(`insert into drivers(id, org_id, name, licence_expiry) values ('${A_DRV}', '${ORG_A}', 'Driver A', current_date + 400)`);
await db.exec(`insert into auth.users(id, email, raw_app_meta_data) values
  ('${A_FLEET}', 'fleet@alpha.ke', '{"org_id":"${ORG_A}","role":"fleet_manager"}'),
  ('${A_DRIVER_USER}', 'drv@alpha.ke', '{"org_id":"${ORG_A}","role":"driver","driver_id":"${A_DRV}"}')`);
checkTrue("Fleet manager and driver accounts join org A", (await one(`select role from profiles where id = '${A_FLEET}'`)).role === "fleet_manager");
checkTrue("Driver login is linked to its driver record", (await one(`select profile_id from drivers where id = '${A_DRV}'`)).profile_id === A_DRIVER_USER);

// Trip T1: goods for a client, fee in SDG (rate 3,000), extras and expenses in USD/SSP (rate 5,000).
await asUser(A_FLEET);
const T1 = (await one(`insert into trips(truck_id, driver_id, customer_id, route_from, route_to, cargo_type, currency, fee_original)
  values ('${A_TRUCK}', '${A_DRV}', '${A_CUST}', 'Port Sudan', 'Khartoum', 'goods', 'SDG', 3000000) returning id, fee, trip_no`));
check("Trip fee 3,000,000 SDG at 3,000 is 1,000.00 USD", T1.fee, 1000);
checkTrue("Trips are numbered per organization", Number(T1.trip_no) === 1);
await db.exec(`insert into trip_lines(trip_id, kind, category, currency, original_amount) values
  ('${T1.id}', 'income', 'waiting_time', 'USD', 50),
  ('${T1.id}', 'expense', 'fuel', 'SSP', 500000),
  ('${T1.id}', 'expense', 'tolls_border', 'USD', 30)`);
await expectError("A fleet manager cannot record driver pay",
  `insert into trip_lines(trip_id, kind, category, currency, original_amount) values ('${T1.id}', 'expense', 'driver_pay', 'USD', 70)`,
  "Only the owner can record staff pay");
await asUser(A_OWNER);
await db.exec(`insert into trip_lines(trip_id, kind, category, currency, original_amount, driver_id) values ('${T1.id}', 'expense', 'driver_pay', 'USD', 70, '${A_DRV}')`);
await asUser(A_FLEET);
await db.exec(`select start_trip('${T1.id}', 1000)`);
await db.exec(`select record_delivery('${T1.id}', null, 1800)`);
await asUser(A_OWNER);
const tp1 = await one(`select income, trip_expenses, profit, km, profit_per_km from trip_profit where trip_id = '${T1.id}'`);
check("Trip income in USD: 1,000 fee + 50 waiting time", tp1.income, 1050);
check("Trip expenses in USD: 500,000 SSP (100) + 30 tolls + 70 driver pay", tp1.trip_expenses, 200);
check("Trip profit in mixed currencies = 1,050 − 200 = 850.00 USD", tp1.profit, 850);
check("Profit per km over 800 km", tp1.profit_per_km, 850 / 800);

section = "Truck business: fleet manager cannot see profit or pay";
await asUser(A_FLEET);
checkTrue("Fleet manager sees no rows in trip_profit / trip_financials / truck_daily_summary",
  (await count(`select count(*) n from trip_profit`)) === 0 && (await count(`select count(*) n from trip_financials`)) === 0 &&
  (await count(`select count(*) n from truck_daily_summary`)) === 0);
checkTrue("Fleet manager can't see the driver pay line (sees 3 of 4 lines)",
  (await count(`select count(*) n from trip_lines where trip_id = '${T1.id}'`)) === 3);
checkTrue("Fleet manager can't read the depot's sales or margins",
  (await count(`select count(*) n from sales_safe`)) === 0 && (await count(`select count(*) n from stock_value`)) === 0);
await expectError("Fleet manager can't record a driver salary",
  `insert into truck_expenses(truck_id, category, currency, original_amount) values ('${A_TRUCK}', 'driver_salary', 'USD', 300)`, "Only the owner");
await asUser(A_OWNER);
await db.exec(`insert into truck_expenses(truck_id, category, currency, original_amount, driver_id) values ('${A_TRUCK}', 'driver_salary', 'USD', 300, '${A_DRV}'),
  ('${A_TRUCK}', 'tyres', 'SDG', 600000, null)`);
check("Truck expense of 600,000 SDG is 200.00 USD", (await one(`select amount from truck_expenses where original_amount = 600000`)).amount, 200);
await asUser(A_FLEET);
checkTrue("Fleet manager sees the tyres but not the salary", (await count(`select count(*) n from truck_expenses`)) === 1);

section = "Truck business: fuel haulage";
await asUser(A_FLEET);
const T2 = (await one(`insert into trips(truck_id, driver_id, customer_id, route_from, route_to, cargo_type, currency, fee_original,
  fuel_type_id, litres_loaded, loaded_from, loading_ticket)
  values ('${A_TRUCK}', '${A_DRV}', '${A_CUST}', 'Kosti depot', 'El Obeid', 'fuel', 'USD', 2000, '${A_DIESEL}', 30000, 'Kosti depot', 'LT-1001') returning id`)).id;
await db.exec(`select start_trip('${T2}')`);
await db.exec(`select record_delivery('${T2}', 29700)`);
const h2 = await one(`select shortage_litres, shortage_pct, haulage_status from trips where id = '${T2}'`);
check("Shortage = 30,000 loaded − 29,700 delivered = 300 L", h2.shortage_litres, 300);
check("Shortage % = 1.000%", h2.shortage_pct, 1);
checkTrue("1% is above the 0.5% tolerance → Disputed", h2.haulage_status === "disputed");
const T3 = (await one(`insert into trips(truck_id, customer_id, route_from, route_to, cargo_type, currency, fee_original,
  fuel_type_id, litres_loaded) values ('${A_TRUCK}', '${A_CUST}', 'Kosti', 'Rabak', 'fuel', 'USD', 500, '${A_DIESEL}', 10000) returning id`)).id;
await db.exec(`select record_delivery('${T3}', 9980)`);
checkTrue("0.2% shortage is within tolerance → OK", (await one(`select haulage_status s from trips where id = '${T3}'`)).s === "ok");
await asUser(A_OWNER);
await db.exec(`update organizations set haulage_tolerance_pct = 0.1`);
await asUser(A_FLEET);
await expectError("Delivered litres can't exceed loaded litres", `select record_delivery('${(await one(`insert into trips(truck_id, customer_id, route_from, route_to, cargo_type, currency, fuel_type_id, litres_loaded)
  values ('${A_TRUCK}', '${A_CUST}', 'A', 'B', 'fuel', 'USD', '${A_DIESEL}', 100) returning id`)).id}', 101)`, "can't be more than loaded");
await db.exec(`select set_haulage_status('${T2}', 'resolved', 'Driver paid for 300 L')`);
checkTrue("A dispute can be resolved with a note", (await one(`select haulage_status s, dispute_note n from trips where id = '${T2}'`)).n === "Driver paid for 300 L");

section = "Truck business: own-depot fuel goes into stock exactly once";
await asAdmin();
const tankBefore = Number((await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l);
await asUser(A_FLEET);
const T4 = (await one(`insert into trips(truck_id, driver_id, for_own_depot, route_from, route_to, cargo_type, currency, fee_original,
  fuel_type_id, litres_loaded, supplier_id, tank_id)
  values ('${A_TRUCK}', '${A_DRV}', true, 'Supplier depot', 'Our depot', 'fuel', 'USD', 0, '${A_PETROL}', 5000, '${A_SUP}', '${A_TANK}') returning id`)).id;
await db.exec(`select start_trip('${T4}')`);
// The driver reports litres first: this must NOT put fuel into stock.
await asUser(A_DRIVER_USER);
await db.exec(`select record_delivery('${T4}', 4990, null)`);
await asAdmin();
check("Driver's report alone doesn't change the tank", (await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l, tankBefore);
await asUser(A_FLEET);
await db.exec(`select record_delivery('${T4}', null, null, null, null, null, 1.0, null, 'USD')`);
await asAdmin();
check("Delivering own-depot fuel adds the 4,990 L delivered to the tank", (await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l, tankBefore + 4990);
checkTrue("One stock purchase is linked to the trip", (await count(`select count(*) n from purchases where trip_id = '${T4}' and deleted_at is null`)) === 1);
await asUser(A_FLEET);
await expectError("Delivering the same trip again is refused",
  `select record_delivery('${T4}', null, null, null, null, null, 1.0, null, 'USD')`, "already been delivered");
await asAdmin();
check("…and the tank is unchanged (fuel counted exactly once)", (await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l, tankBefore + 4990);
await expectError("The database refuses a second purchase for the same trip",
  `insert into purchases(org_id, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_id)
   values ('${ORG_A}', '${A_SUP}', '${A_TRUCK}', '${A_TANK}', 1, 1, '${T4}')`, "duplicate key");

section = "Truck business: voiding a trip";
await asUser(A_FLEET);
await expectError("Voiding needs a reason", `select void_trip('${T4}', ' ')`, "Give a reason");
await db.exec(`select void_trip('${T4}', 'Entered against the wrong truck')`);
await asAdmin();
const v4 = await one(`select deleted_at, void_reason from trips where id = '${T4}'`);
checkTrue("Voided trip keeps its reason and is not deleted", !!v4.deleted_at && v4.void_reason === "Entered against the wrong truck");
check("Voiding an own-depot trip takes its fuel back out of the tank", (await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l, tankBefore);
await expectError("Trips can't be hard-deleted", `delete from trips where id = '${T4}'`, "Hard delete is not allowed");
checkTrue("The void is in the audit log",
  (await count(`select count(*) n from audit_log where table_name = 'trips' and record_id = '${T4}' and action = 'SOFT_DELETE'`)) === 1);

section = "Truck business: documents block starting a trip";
await asAdmin();
await db.exec(`insert into truck_documents(org_id, truck_id, doc_type, expires_on) values ('${ORG_A}', '${A_TRUCK}', 'insurance', current_date - 1)`);
await asUser(A_FLEET);
const T5 = (await one(`insert into trips(truck_id, driver_id, customer_id, route_from, route_to, currency, fee_original)
  values ('${A_TRUCK}', '${A_DRV}', '${A_CUST}', 'Khartoum', 'Atbara', 'USD', 400) returning id`)).id;
await expectError("Expired insurance blocks a fleet manager from starting the trip", `select start_trip('${T5}')`, "Insurance expired");
await asUser(A_OWNER);
await expectError("The owner must give a reason to override", `select start_trip('${T5}')`, "Only the owner can start this trip, with a reason");
await db.exec(`select start_trip('${T5}', null, 'Renewal paid, certificate on the way')`);
await asAdmin();
checkTrue("Owner override is recorded with its reason",
  (await one(`select status, start_override_reason r from trips where id = '${T5}'`)).r === "Renewal paid, certificate on the way");

section = "Truck business: driver phone view";
await asUser(A_DRIVER_USER);
checkTrue("Driver sees their own trips in driver_trips", (await count(`select count(*) n from driver_trips`)) >= 2);
checkTrue("Driver can't read the trips table (fees stay hidden)", (await count(`select count(*) n from trips`)) === 0);
await db.exec(`insert into trip_lines(trip_id, kind, category, currency, original_amount) values ('${T5}', 'expense', 'meals', 'SDG', 30000)`);
checkTrue("Driver can add an expense to their own trip", (await count(`select count(*) n from trip_lines where trip_id = '${T5}'`)) === 1);
await expectError("Driver can't add an expense to someone else's trip",
  `insert into trip_lines(trip_id, kind, category, currency, original_amount) values ('${T3}', 'expense', 'meals', 'USD', 5)`, "row-level security");
await expectError("Driver can't add income", `insert into trip_lines(trip_id, kind, category, currency, original_amount) values ('${T5}', 'income', 'extra_drop', 'USD', 5)`, "");
await db.exec(`select record_delivery('${T5}', null, 2400)`);
await asAdmin();
checkTrue("A driver's delivery report completes a client trip", (await one(`select status from trips where id = '${T5}'`)).status === "delivered");

section = "Truck business: clients and money owed";
await asUser(A_FLEET);
// Delivered for A_CUST: T1 1,050 + T2 2,000 + T3 500 + T5 400 = 3,950 USD
check("Client owes 3,950.00 USD for delivered trips", (await one(`select owed from trip_client_balances where customer_id = '${A_CUST}'`)).owed, 3950);
await db.exec(`insert into trip_payments(customer_id, trip_id, method, currency, original_amount) values ('${A_CUST}', '${T1.id}', 'bank', 'SDG', 3000000)`);
check("A 3,000,000 SDG payment (1,000 USD) leaves 2,950.00 USD owed", (await one(`select owed from trip_client_balances where customer_id = '${A_CUST}'`)).owed, 2950);
await expectError("A client can't pay more than they owe",
  `insert into trip_payments(customer_id, method, currency, original_amount) values ('${A_CUST}', 'cash', 'USD', 5000)`, "more than the client owes");
await asUser(A_OWNER);
checkTrue("Trucks P&L feeds the dashboard toggle (owner)", (await count(`select count(*) n from truck_daily_summary`)) >= 1);

section = "Truck business: repeating expenses and reminders";
await asUser(A_OWNER);
await db.exec(`insert into truck_recurring_expenses(truck_id, category, currency, original_amount, next_due) values ('${A_TRUCK}', 'insurance', 'USD', 120, current_date - 40)`);
const posted = Number((await one(`select post_recurring_expenses() n`)).n);
checkTrue("Overdue monthly item posts one expense per month due (2)", posted === 2, `(${posted})`);
checkTrue("Posting again does nothing (idempotent)", Number((await one(`select post_recurring_expenses() n`)).n) === 0);
await db.exec(`insert into service_reminders(truck_id, name, every_km, last_done_km) values ('${A_TRUCK}', 'Oil change', 10000, 0)`);
const rem = (await one(`select id from service_reminders where name = 'Oil change'`)).id;
await db.exec(`select mark_service_done('${rem}', 2500)`);
checkTrue("Marking a service done records the odometer and moves the truck's odometer forward",
  Number((await one(`select last_done_km k from service_reminders where id = '${rem}'`)).k) === 2500 &&
  Number((await one(`select odometer_km k from trucks where id = '${A_TRUCK}'`)).k) >= 2500);

section = "Truck business: cross-tenant isolation";
await asAdmin();
await db.exec(`
  insert into drivers(id, org_id, name) values ('${B_DRV}', '${ORG_B}', 'Driver B');
  insert into trips(id, org_id, truck_id, driver_id, customer_id, route_from, route_to, currency, fee_original)
    values ('${B_TRIP}', '${ORG_B}', '${B_TRUCK}', '${B_DRV}', '${B_CUST}', 'Juba', 'Nimule', 'USD', 900);
  select deliver_trip_internal('${B_TRIP}', null, null, null, null, null, null, null, null, null, true);
  insert into trip_lines(org_id, trip_id, kind, category, currency, original_amount) values ('${ORG_B}', '${B_TRIP}', 'expense', 'fuel', 'USD', 100);
  insert into truck_expenses(org_id, truck_id, category, currency, original_amount) values ('${ORG_B}', '${B_TRUCK}', 'tyres', 'USD', 50);
  insert into truck_recurring_expenses(org_id, truck_id, category, currency, original_amount, next_due) values ('${ORG_B}', '${B_TRUCK}', 'insurance', 'USD', 10, current_date + 5);
  insert into truck_documents(org_id, truck_id, doc_type, expires_on) values ('${ORG_B}', '${B_TRUCK}', 'licence', current_date + 10);
  insert into service_reminders(org_id, truck_id, name, every_days) values ('${ORG_B}', '${B_TRUCK}', 'Inspection', 90);
  insert into trip_payments(org_id, customer_id, trip_id, method, currency, original_amount) values ('${ORG_B}', '${B_CUST}', '${B_TRIP}', 'cash', 'USD', 100);
  insert into driver_advances(org_id, trip_id, driver_id, kind, currency, original_amount) values ('${ORG_B}', '${B_TRIP}', '${B_DRV}', 'given', 'USD', 40);`);
const FLEET_TABLES = ["trips", "trip_lines", "truck_expenses", "truck_recurring_expenses", "truck_documents",
  "service_reminders", "trip_payments", "driver_advances"];
const FLEET_VIEWS = ["trip_financials", "trip_profit", "trip_client_balances", "driver_trips"];
const fleetSnapshot = async () => {
  await asAdmin();
  const parts = [];
  for (const t of FLEET_TABLES) parts.push(JSON.stringify((await db.query(`select * from ${t} where org_id = '${ORG_B}' order by id`)).rows));
  return parts.join("|");
};
const FLEET_B_BEFORE = await fleetSnapshot();
for (const [label, uid] of [["owner", A_OWNER], ["fleet manager", A_FLEET], ["driver", A_DRIVER_USER]]) {
  await asUser(uid);
  const leaks = [];
  for (const t of FLEET_TABLES) if ((await count(`select count(*) n from ${t} where org_id = '${ORG_B}'`)) > 0) leaks.push(t);
  for (const v of FLEET_VIEWS) if ((await count(`select count(*) n from ${v} where org_id = '${ORG_B}'`)) > 0) leaks.push(v);
  checkTrue(`Org A ${label} reads 0 org B rows from ${FLEET_TABLES.length} new tables and ${FLEET_VIEWS.length} views`, leaks.length === 0, leaks.join(","));
  if (label === "driver") continue;
  await expectError(`Org A ${label} can't create a trip with org B's truck`,
    `insert into trips(truck_id, customer_id, route_from, route_to, currency) values ('${B_TRUCK}', '${A_CUST}', 'x', 'y', 'USD')`, "Truck not found");
  await expectError(`Org A ${label} can't create a trip for org B's client`,
    `insert into trips(truck_id, customer_id, route_from, route_to, currency) values ('${A_TRUCK}', '${B_CUST}', 'x', 'y', 'USD')`, "Client not found");
  await expectError(`Org A ${label} can't add lines to org B's trip`,
    `insert into trip_lines(trip_id, kind, category, currency, original_amount) values ('${B_TRIP}', 'expense', 'fuel', 'USD', 1)`, "Trip not found");
  await expectError(`Org A ${label} can't add a truck expense to org B's truck`,
    `insert into truck_expenses(truck_id, category, currency, original_amount) values ('${B_TRUCK}', 'tyres', 'USD', 1)`, "Truck not found");
  await expectError(`Org A ${label} can't take a payment from org B's client`,
    `insert into trip_payments(customer_id, method, currency, original_amount) values ('${B_CUST}', 'cash', 'USD', 1)`, "Client not found");
  for (const fn of [`start_trip('${B_TRIP}')`, `record_delivery('${B_TRIP}', 1)`, `cancel_trip('${B_TRIP}', 'x')`,
                    `void_trip('${B_TRIP}', 'x')`, `set_haulage_status('${B_TRIP}', 'ok', null)`]) {
    await expectError(`Org A ${label} can't run ${fn.split("(")[0]} on org B's trip`, `select ${fn}`, "not found");
  }
  const edits = [
    `update trips set notes = 'x' where id = '${B_TRIP}'`,
    `update trip_lines set description = 'x' where org_id = '${ORG_B}'`,
    `update truck_expenses set description = 'x' where org_id = '${ORG_B}'`,
    `update truck_recurring_expenses set active = false where org_id = '${ORG_B}'`,
    `update truck_documents set notes = 'x' where org_id = '${ORG_B}'`,
    `update service_reminders set notes = 'x' where org_id = '${ORG_B}'`,
    `update trip_payments set deleted_at = now() where org_id = '${ORG_B}'`,
    `update driver_advances set deleted_at = now() where org_id = '${ORG_B}'`,
  ];
  const editLeaks = [];
  for (const sql of edits) if (!(await expectRlsBlock(sql))) editLeaks.push(sql.split(" ")[1]);
  checkTrue(`Org A ${label} can't edit or void anything in org B's truck business (${edits.length} attempts)`, editLeaks.length === 0, editLeaks.join(","));
}
checkTrue("Org B's truck business data is unchanged after all attempts", (await fleetSnapshot()) === FLEET_B_BEFORE);
await asAdmin();

// =====================================================================================
// Migration 008: dip losses in profit, sales ledger, sale history.
section = "Dip losses count in net profit (bug fix)";
await asUser(A_OWNER);
const netBefore = Number((await one(`select coalesce(sum(net_profit), 0) n from daily_summary`)).n);
await asAdmin();
const tankNow = Number((await one(`select current_litres l from tanks where id = '${A_TANK}'`)).l);
const avgNow = Number((await one(`select avg_cost_per_litre a from tank_costing where tank_id = '${A_TANK}'`)).a);
await asUser(A_MANAGER);
await db.exec(`insert into stock_adjustments(tank_id, dip_litres, reason, system_litres) values ('${A_TANK}', ${tankNow - 100}, 'Dip: 100 L missing', 0)`);
await asUser(A_OWNER);
const adj = await one(`select value_change, cost_per_litre from stock_adjustment_values order by date desc limit 1`);
check("A 100 L loss is valued at the tank's average cost", adj.value_change, (-100 * avgNow).toFixed(2));
const netAfter = Number((await one(`select coalesce(sum(net_profit), 0) n from daily_summary`)).n);
check("Net profit drops by the value of the fuel lost", netAfter - netBefore, (-100 * avgNow).toFixed(2));
await asUser(A_MANAGER);
await expectError("A sales manager can't read what the lost fuel was worth", `select cost_per_litre from stock_adjustments`, "permission denied");
checkTrue("…and sees no rows in stock_adjustment_values", (await count(`select count(*) n from stock_adjustment_values`)) === 0);
checkTrue("…but can still read the dip readings", (await count(`select count(*) n from stock_adjustments where tank_id = '${A_TANK}'`)) >= 1);

section = "Depot and truck summaries don't double count";
await asAdmin();
const depotExp = Number((await one(`select coalesce(sum(amount), 0) s from expenses where org_id = '${ORG_A}' and deleted_at is null`)).s);
const truckExp = Number((await one(`select coalesce(sum(amount), 0) s from truck_expenses where org_id = '${ORG_A}' and deleted_at is null`)).s);
await asUser(A_OWNER);
check("daily_summary expenses = depot expenses only", (await one(`select coalesce(sum(expenses), 0) s from daily_summary`)).s, depotExp);
check("truck_daily_summary truck costs = truck expenses only", (await one(`select coalesce(sum(truck_expenses), 0) s from truck_daily_summary`)).s, truckExp);
check(
  "Combined net = depot net + trucks net (no overlap)",
  Number((await one(`select coalesce(sum(net_profit), 0) s from daily_summary`)).s) + Number((await one(`select coalesce(sum(net_profit), 0) s from truck_daily_summary`)).s),
  Number((await one(`select (select coalesce(sum(net_profit), 0) from daily_summary) + (select coalesce(sum(net_profit), 0) from truck_daily_summary) s`)).s),
);
check("A sale in SDG is added to sales in USD, not at face value", (await one(`select total from sales where id = '${SDG_SALE}'`)).total, 180);

section = "Sales ledger and sale history";
await asUser(A_MANAGER);
const voided = await one(`select deleted_at, void_reason from sales_ledger where id = 'a8000000-0000-0000-0000-000000000001'`);
checkTrue("Sales manager sees voided sales in the ledger, with the reason", !!voided?.deleted_at && voided.void_reason === "Customer cancelled");
await expectError("The ledger has no cost columns", `select cost_total from sales_ledger`, "does not exist");
const hist = (await db.query(`select * from sale_history('a8000000-0000-0000-0000-000000000001')`)).rows;
checkTrue("Sale history shows the insert and the void", hist.some((h) => h.action === "INSERT") && hist.some((h) => h.action === "SOFT_DELETE"));
checkTrue("Sale history hides cost from a sales manager", hist.every((h) => !(h.new_data && "cost_total" in h.new_data)));
await asUser(A_OWNER);
const ownerHist = (await db.query(`select * from sale_history('a8000000-0000-0000-0000-000000000001')`)).rows;
checkTrue("The owner sees cost in the history", ownerHist.some((h) => h.new_data && "cost_total" in h.new_data));
await asUser(A_ATT);
checkTrue("An attendant sees nothing in the ledger", (await count(`select count(*) n from sales_ledger`)) === 0);
await expectError("An attendant can't read sale history", `select * from sale_history('a8000000-0000-0000-0000-000000000001')`, "Not allowed");
await asUser(A_OWNER);
checkTrue("The ledger never shows another organization's sales", (await count(`select count(*) n from sales_ledger where org_id = '${ORG_B}'`)) === 0);
await expectError("Sale history refuses another organization's sale", `select * from sale_history('${B_SALE}')`, "Sale not found");
await asAdmin();

section = "Signed out and deactivated";
await asAnon();
await expectError("Signed-out visitors cannot read tables", `select count(*) from trucks`, "permission denied");
await expectError("Signed-out visitors cannot read views", `select count(*) from sales_safe`, "permission denied");
await expectError("Signed-out visitors cannot call shift RPCs", `select start_shift()`, "permission denied");
await asUser(A_OWNER);
await db.exec(`update profiles set active = false where id = '${A_MANAGER}'`);
await asUser(A_MANAGER);
checkTrue("Deactivated manager sees nothing", (await count(`select count(*) n from trucks`)) === 0 && (await count(`select count(*) n from purchases_safe`)) === 0);
await expectError("Deactivated manager cannot insert", `insert into drivers(name) values ('x')`, "not linked to an active organization");
await asAdmin();

// =====================================================================================
// Upgrade path: migration 005 applied on top of a database that already has data
// (this is what happens on the hosted project).
section = "Upgrade from single-currency data";
{
  const up = new PGlite();
  await up.exec(AUTH_STUB);
  const files = readdirSync(join(root, "supabase/migrations")).sort();
  for (const f of files.slice(0, 4)) await up.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
  await up.exec(`insert into auth.users(id, email, raw_user_meta_data) values ('${A_OWNER}', 'old@x.ke', '{"business_name":"Old Co"}')`);
  const org = (await up.query(`select org_id from profiles`)).rows[0].org_id;
  const pet = (await up.query(`select id from fuel_types where name = 'Petrol'`)).rows[0].id;
  await up.exec(`
    update fuel_types set current_selling_price = 1.5 where id = '${pet}';
    insert into tanks(id, org_id, name, fuel_type_id, capacity_litres) values ('${A_TANK}', '${org}', 'T', '${pet}', 5000);
    insert into suppliers(id, org_id, name) values ('${A_SUP}', '${org}', 'S');
    insert into trucks(id, org_id, plate_number, capacity_litres) values ('${A_TRUCK}', '${org}', 'KXX 1X', 1000);
    insert into purchases(org_id, supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost) values ('${org}', '${A_SUP}', '${A_TRUCK}', '${A_TANK}', 1000, 1.2, 50);
    insert into sales(org_id, tank_id, litres, payment_type, mpesa_ref, attendant_id) values ('${org}', '${A_TANK}', 100, 'mpesa', 'OLD1', '${A_OWNER}');
    insert into expenses(org_id, category, amount) values ('${org}', 'rent', 40);`);
  const before = (await up.query(`select total, cost_total from sales`)).rows[0];
  try {
    await up.exec(readFileSync(join(root, "supabase/migrations", files[4]), "utf8"));
    const s = (await up.query(`select total, cost_total, currency, fx_rate, original_total, payment_type, payment_ref, delivery_status from sales`)).rows[0];
    const p = (await up.query(`select currency, fx_rate, original_total, fuel_cost, landed_cost_per_litre from purchases`)).rows[0];
    checkTrue("Existing sale is kept as USD at rate 1 with the same totals",
      s.currency === "USD" && Number(s.fx_rate) === 1 && Number(s.total) === Number(before.total) &&
      Number(s.original_total) === Number(before.total) && Number(s.cost_total) === Number(before.cost_total), JSON.stringify(s));
    checkTrue("M-Pesa becomes Mobile money and keeps its reference", s.payment_type === "mobile" && s.payment_ref === "OLD1");
    checkTrue("Existing sale counts as delivered", s.delivery_status === "delivered");
    checkTrue("Existing delivery is kept as USD with the same cost",
      p.currency === "USD" && Number(p.original_total) === 1250 && Number(p.fuel_cost) === 1200 && Number(p.landed_cost_per_litre) === 1.25, JSON.stringify(p));
    checkTrue("Existing organizations get placeholder SDG/SSP rates", Number((await up.query(`select count(*) n from exchange_rates where is_placeholder`)).rows[0].n) === 2);
  } catch (e) {
    checkTrue("Migration 005 applies on top of existing data", false, `(${e.message})`);
  }
}

// =====================================================================================
// Demo seed applies to its own org on a fresh database, separate from other sign-ups.
section = "Demo seed";
db = await freshDb();
await db.exec(`insert into auth.users(id, email, raw_user_meta_data) values
  ('${A_OWNER}', 'demo@petrotrack.test', '{"business_name":"Demo","full_name":"Demo Owner"}'),
  ('${B_OWNER}', 'real@customer.ke', '{"business_name":"Real Customer","full_name":"Real"}')`);
try {
  await db.exec(readFileSync(join(root, "supabase/seed_demo.sql"), "utf8"));
  const demoOrg = (await one(`select org_id from profiles where id = '${A_OWNER}'`)).org_id;
  const realOrg = (await one(`select org_id from profiles where id = '${B_OWNER}'`)).org_id;
  const c = await one(`select (select count(*) from trucks where org_id = '${demoOrg}') t,
    (select count(*) from tanks where org_id = '${demoOrg}') k, (select count(*) from purchases where org_id = '${demoOrg}') p,
    (select count(*) from sales where org_id = '${demoOrg}') s, (select is_demo from organizations where id = '${demoOrg}') d`);
  checkTrue("Seed: demo org has 3 trucks, 3 tanks, purchases and sales, flagged is_demo",
    Number(c.t) === 3 && Number(c.k) === 3 && Number(c.p) > 0 && Number(c.s) > 0 && c.d === true, JSON.stringify(c));
  const fleet = await one(`select (select count(*) from trips where org_id = '${demoOrg}') trips,
    (select count(*) from trips where org_id = '${demoOrg}' and haulage_status = 'disputed') disputed,
    (select count(*) from purchases where trip_id is not null and org_id = '${demoOrg}') own_fuel,
    (select count(*) from drivers where org_id = '${demoOrg}') drivers`);
  checkTrue("Seed: 6 trips, one disputed fuel haulage, own-depot fuel in stock, 2+ drivers",
    Number(fleet.trips) === 6 && Number(fleet.disputed) === 1 && Number(fleet.own_fuel) === 1 && Number(fleet.drivers) >= 2, JSON.stringify(fleet));
  checkTrue("Seed: other organizations untouched",
    (await count(`select count(*) n from trucks where org_id = '${realOrg}'`)) === 0 &&
    (await one(`select is_demo from organizations where id = '${realOrg}'`)).is_demo === false);
  await expectError("Seed refuses to run twice", readFileSync(join(root, "supabase/seed_demo.sql"), "utf8"), "already");
} catch (e) {
  checkTrue("Seed applies cleanly", false, `(${e.message})`);
}

// =====================================================================================
let current = "";
for (const r of results) {
  if (r.section !== current) {
    current = r.section;
    console.log(`\n== ${current}`);
  }
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  -> got ${r.actual}, expected ${r.expected}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
