// Runs the Supabase migrations against an in-memory Postgres (PGlite) with a stubbed
// `auth` schema, then checks the profit maths, business rules and role isolation.
// Usage: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const db = new PGlite();

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

const OWNER = "00000000-0000-0000-0000-000000000001";
const MANAGER = "00000000-0000-0000-0000-000000000002";
const ATTENDANT = "00000000-0000-0000-0000-000000000003";

let passed = 0;
let failed = 0;
const results = [];

function check(name, actual, expected) {
  const ok = Number(actual).toFixed(2) === Number(expected).toFixed(2);
  results.push({ name, actual: Number(actual).toFixed(2), expected: Number(expected).toFixed(2), ok });
  ok ? passed++ : failed++;
}
function checkTrue(name, cond, detail = "") {
  results.push({ name, actual: cond ? "yes" : `no ${detail}`, expected: "yes", ok: !!cond });
  cond ? passed++ : failed++;
}
async function expectError(name, sql, match) {
  try {
    await db.exec(sql);
    checkTrue(name, false, "(no error raised)");
  } catch (e) {
    checkTrue(name, String(e.message).includes(match), `(${e.message})`);
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const asUser = async (id) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;`);
};
const asAdmin = async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
};

await db.exec(AUTH_STUB);
for (const f of readdirSync(join(root, "supabase/migrations")).sort()) {
  await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
}

// users (profiles are created by the auth trigger)
await db.exec(`
  insert into auth.users(id, email, raw_app_meta_data) values
    ('${OWNER}', 'owner@test.ke', '{"role":"owner"}'),
    ('${MANAGER}', 'manager@test.ke', '{"role":"manager"}'),
    ('${ATTENDANT}', 'att@test.ke', '{}');
`);
checkTrue("New users get a profile; default role is attendant",
  (await one(`select role from profiles where id = '${ATTENDANT}'`)).role === "attendant");

// reference data
await db.exec(`
  insert into fuel_types(id, name, current_selling_price) values
    ('10000000-0000-0000-0000-000000000001', 'Petrol', 180);
  insert into tanks(id, name, fuel_type_id, capacity_litres, current_litres, low_stock_level) values
    ('20000000-0000-0000-0000-000000000001', 'T1', '10000000-0000-0000-0000-000000000001', 25000, 99999, 2000);
  insert into suppliers(id, name) values ('30000000-0000-0000-0000-000000000001', 'S1');
  insert into trucks(id, plate_number, capacity_litres) values ('40000000-0000-0000-0000-000000000001', 'KAA 001A', 15000);
  insert into customers(id, name, credit_limit, balance) values
    ('50000000-0000-0000-0000-000000000001', 'C1', 100000, 77777);
`);
checkTrue("Tank opening litres forced to 0 (only deliveries add stock)",
  Number((await one(`select current_litres from tanks`)).current_litres) === 0);
checkTrue("Customer opening balance forced to 0",
  Number((await one(`select balance from customers`)).balance) === 0);

const TANK = "20000000-0000-0000-0000-000000000001";
const purchase = (litres, cpl, trip) => `
  insert into purchases(supplier_id, truck_id, tank_id, litres, cost_per_litre, trip_cost) values
    ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '${TANK}', ${litres}, ${cpl}, ${trip});`;
const avgCost = async () => Number((await one(`select avg_cost_per_litre a from tank_costing`)).a);
const tankLitres = async () => Number((await one(`select current_litres l from tanks`)).l);

// ---------- Case 1: landed cost ----------
await asUser(MANAGER);
await db.exec(purchase(10000, 150, 20000));
await asAdmin();
const p1 = await one(`select fuel_cost, landed_cost_per_litre from purchases order by created_at limit 1`);
check("Case 1: fuel cost 10,000 L x 150", p1.fuel_cost, 1500000);
check("Case 1: landed cost (1,500,000 + 20,000) / 10,000", p1.landed_cost_per_litre, 152);
check("Case 1: tank after delivery", await tankLitres(), 10000);

// ---------- Case 2: weighted average after second delivery ----------
await db.exec(purchase(5000, 160, 10000)); // landed 162
const expAvg2 = (10000 * 152 + 5000 * 162) / 15000; // 155.3333
check("Case 2: weighted avg (10k@152 + 5k@162)/15k", await avgCost(), expAvg2.toFixed(4));
check("Case 2: tank litres", await tankLitres(), 15000);

// ---------- Case 3: sale, gross & net profit ----------
await db.exec(`
  insert into shifts(id, attendant_id) values ('60000000-0000-0000-0000-000000000001', '${ATTENDANT}');`);
await asUser(ATTENDANT);
await db.exec(`insert into sales(tank_id, litres, price_per_litre, payment_type) values ('${TANK}', 1000, 1, 'cash');`);
await asAdmin();
const s1 = await one(`select total, cost_per_litre, cost_total, price_per_litre, shift_id from sales`);
check("Case 3: attendant price forced to pump price (tried 1.00)", s1.price_per_litre, 180);
check("Case 3: sales 1,000 L x 180", s1.total, 180000);
const avg4 = Number(expAvg2.toFixed(4));
check("Case 3: cost of fuel sold 1,000 x 155.3333", s1.cost_total, (1000 * avg4).toFixed(2));
checkTrue("Case 3: sale attached to attendant's open shift", s1.shift_id === "60000000-0000-0000-0000-000000000001");
await db.exec(`insert into expenses(category, amount) values ('electricity', 5000);`);
const ds = await (async () => {
  await asUser(OWNER);
  const r = await one(`select sum(sales) s, sum(cost_of_fuel) c, sum(gross_profit) g, sum(expenses) e, sum(net_profit) n from daily_summary`);
  await asAdmin();
  return r;
})();
check("Case 3: daily_summary gross profit 180,000 - 155,333.30", ds.g, 180000 - 1000 * avg4);
check("Case 3: daily_summary net profit (gross - 5,000 expenses)", ds.n, 180000 - 1000 * avg4 - 5000);

// ---------- Case 4: stock value ----------
await asUser(OWNER);
const sv = await one(`select value from stock_value`);
await asAdmin();
check("Case 4: stock value 14,000 L x 155.3333", sv.value, (14000 * avg4).toFixed(2));

// ---------- Case 5: avg after a delivery on top of remaining stock ----------
await db.exec(purchase(6000, 157, 6000)); // landed 158
const expAvg5 = (14000 * avg4 + 6000 * 158) / 20000;
check("Case 5: weighted avg (14k@155.3333 + 6k@158)/20k", await avgCost(), expAvg5.toFixed(4));
await db.exec(`insert into sales(tank_id, litres, price_per_litre, payment_type, attendant_id) values ('${TANK}', 2000, 185, 'cash', '${OWNER}');`);
const s2 = await one(`select total, cost_total from sales where litres = 2000`);
const avg5 = Number(expAvg5.toFixed(4));
check("Case 5: second sale gross profit 2,000 x (185 - 156.1333)", Number(s2.total) - Number(s2.cost_total), (370000 - 2000 * avg5).toFixed(2));

// ---------- Business rules ----------
await expectError("Rule: sale above tank stock is rejected",
  `insert into sales(tank_id, litres, payment_type, attendant_id) values ('${TANK}', 999999, 'cash', '${OWNER}');`,
  "Insufficient stock");
await expectError("Rule: credit sale without customer is rejected",
  `insert into sales(tank_id, litres, payment_type, attendant_id) values ('${TANK}', 10, 'credit', '${OWNER}');`,
  "need a customer");
await expectError("Rule: credit sale over limit is rejected (600 L x 180 > 100,000)",
  `insert into sales(tank_id, litres, payment_type, customer_id, attendant_id) values ('${TANK}', 600, 'credit', '50000000-0000-0000-0000-000000000001', '${OWNER}');`,
  "Credit limit exceeded");
await expectError("Rule: M-Pesa sale without reference is rejected",
  `insert into sales(tank_id, litres, payment_type, attendant_id) values ('${TANK}', 10, 'mpesa', '${OWNER}');`,
  "check constraint");
await expectError("Rule: purchase without truck is rejected",
  `insert into purchases(supplier_id, tank_id, litres, cost_per_litre) values ('30000000-0000-0000-0000-000000000001', '${TANK}', 100, 150);`,
  "null value");

await db.exec(`insert into sales(id, tank_id, litres, payment_type, customer_id, attendant_id) values
  ('70000000-0000-0000-0000-000000000001', '${TANK}', 500, 'credit', '50000000-0000-0000-0000-000000000001', '${OWNER}');`);
check("Credit: balance after 500 L credit sale (500 x 180)",
  (await one(`select balance from customers`)).balance, 90000);
await db.exec(`insert into credit_payments(customer_id, amount, method, received_by) values ('50000000-0000-0000-0000-000000000001', 30000, 'mpesa', '${OWNER}');`);
check("Credit: balance after 30,000 payment", (await one(`select balance from customers`)).balance, 60000);
await expectError("Credit: overpayment is rejected",
  `insert into credit_payments(customer_id, amount, method) values ('50000000-0000-0000-0000-000000000001', 70000, 'cash');`,
  "exceeds balance");

const litresBeforeVoid = await tankLitres();
await asUser(OWNER);
await db.exec(`update sales set deleted_at = now() where id = '70000000-0000-0000-0000-000000000001';`);
await asAdmin();
check("Void: credit sale void restores tank litres", await tankLitres(), litresBeforeVoid + 500);
// 60,000 owed - 90,000 voided sale = -30,000 (customer is now in credit)
check("Void: credit sale void reduces balance by 90,000", (await one(`select balance from customers`)).balance, -30000);

await expectError("Soft delete: hard DELETE is blocked", `delete from sales;`, "Hard delete is not allowed");
const audit = await one(`select count(*) n from audit_log where table_name = 'sales' and action = 'SOFT_DELETE'`);
checkTrue("Audit: sale void logged as SOFT_DELETE", Number(audit.n) === 1);
await expectError("Audit: audit_log cannot be edited", `update audit_log set action = 'X';`, "append-only");

// ---------- Role isolation (RLS) ----------
await asUser(ATTENDANT);
checkTrue("RLS: attendant cannot read sales base table (cost hidden)",
  Number((await one(`select count(*) n from sales`)).n) === 0);
checkTrue("RLS: attendant sees only own sales in sales_safe",
  Number((await one(`select count(*) n from sales_safe`)).n) === 1);
checkTrue("RLS: attendant cannot read daily_summary",
  Number((await one(`select count(*) n from daily_summary`)).n) === 0);
await expectError("RLS: attendant cannot record a delivery", purchase(10, 150, 0), "row-level security");
await expectError("RLS: attendant cannot set tank litres directly",
  `update tanks set current_litres = 1;`, "permission denied");
await asAdmin();

await asUser(MANAGER);
checkTrue("RLS: manager cannot read tank cost basis",
  Number((await one(`select count(*) n from tank_costing`)).n) === 0);
checkTrue("RLS: manager cannot read purchase costs (base table)",
  Number((await one(`select count(*) n from purchases`)).n) === 0);
checkTrue("RLS: manager sees deliveries via purchases_safe",
  Number((await one(`select count(*) n from purchases_safe`)).n) === 3);
checkTrue("RLS: manager cannot read stock_value / truck_performance",
  Number((await one(`select count(*) n from stock_value`)).n) === 0 &&
  Number((await one(`select count(*) n from truck_performance`)).n) === 0);
checkTrue("RLS: manager cannot read audit log",
  Number((await one(`select count(*) n from audit_log`)).n) === 0);
checkTrue("RLS: manager cannot void a sale",
  (await db.query(`update sales set deleted_at = now() returning id`)).rows.length === 0);
await asAdmin();

await asUser(OWNER);
checkTrue("RLS: owner reads audit log", Number((await one(`select count(*) n from audit_log`)).n) > 0);
await asAdmin();

// ---------- Shift variance ----------
await asUser(ATTENDANT);
const sh = await one(`select * from end_shift('60000000-0000-0000-0000-000000000001', 179500)`);
await asAdmin();
check("Shift: expected cash = cash sales in shift", sh.expected_cash, 180000);
check("Shift: variance = 179,500 - 180,000", sh.variance, -500);

// ---------- Demo seed applies cleanly on a fresh database ----------
const seedDb = new PGlite();
await seedDb.exec(AUTH_STUB);
for (const f of readdirSync(join(root, "supabase/migrations")).sort()) {
  await seedDb.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
}
await seedDb.exec(`insert into auth.users(id, email, raw_app_meta_data) values ('${OWNER}', 'o@test.ke', '{"role":"owner"}');`);
try {
  await seedDb.exec(readFileSync(join(root, "supabase/seed_demo.sql"), "utf8"));
  const c = (await seedDb.query(`select (select count(*) from trucks) t, (select count(*) from tanks) k,
    (select count(*) from purchases) p, (select count(*) from sales) s`)).rows[0];
  checkTrue("Seed: 3 trucks, 3 tanks, purchases and sales created",
    Number(c.t) === 3 && Number(c.k) === 3 && Number(c.p) > 0 && Number(c.s) > 0, JSON.stringify(c));
} catch (e) {
  checkTrue("Seed: applies cleanly", false, `(${e.message})`);
}

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  -> got ${r.actual}, expected ${r.expected}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
