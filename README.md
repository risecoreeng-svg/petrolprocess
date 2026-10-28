# PetroTrack

Fuel depot manager for a Kenyan petrol business: deliveries, pump sales, stock, credit customers, shifts, expenses and profit. Built for phones first, because attendants use it at the pump. Currency is KES and payments are cash, M-Pesa and credit.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn-style components · Supabase (Postgres, Auth, RLS) · Recharts · ready to deploy on Vercel.

---

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com). Pick the closest region (e.g. `eu-west`, or `af-south-1` if available).
2. **Turn off public sign-ups:** *Authentication → Sign In / Providers → Email*, then switch **Allow new users to sign up** off. Staff accounts are created by the owner inside the app.
3. Copy your keys from *Project Settings → API*:
   - Project URL
   - `anon` / publishable key
   - `service_role` / secret key (server only; never commit it)

## 2. Configure the app

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the three values:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## 3. Run the migrations

The schema lives in `supabase/migrations/` (tables → triggers → RLS → views). Use either option.

**Option A: Supabase CLI (recommended)**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

**Option B: SQL editor.** Open each file in `supabase/migrations/` in order (`…0001` → `…0004`), paste it into *SQL Editor* and run it.

## 4. Create the first owner account

1. In Supabase go to *Authentication → Users → Add user → Create new user*. Enter your email and a password and tick **Auto confirm user**.
2. A profile is created automatically with the role `attendant`. Promote it in the *SQL Editor*:

```sql
update public.profiles
set role = 'owner', full_name = 'Your Name'
where id = (select id from auth.users where email = 'you@example.com');
```

From then on, create every other account from **Users** in the app. The owner picks the role, and the role is stored in `app_metadata`, which users cannot edit.

## 5. Load the demo data (optional)

After the owner exists, run `supabase/seed_demo.sql` in the *SQL Editor*. It creates:

- 3 fuel types with pump prices, and 3 tanks (the kerosene tank is set up to trigger the low-stock alert)
- 3 trucks with drivers, 2 suppliers and 3 credit customers
- 14 days of deliveries, cash, M-Pesa and credit sales, expenses and a credit payment

Demo sales are recorded against the owner account. The seed refuses to run twice.

Without the demo data, start in **Stock**: set pump prices, add tanks, then record a delivery. Tanks always start empty, and stock only enters through deliveries, so every litre has a cost.

## 6. Run it

```bash
npm run dev
```

Open http://localhost:3000 and sign in.

## 7. Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. Add the same three environment variables in *Project → Settings → Environment Variables*.
3. Deploy. No other configuration is needed.

---

## Roles

| | Owner | Manager | Attendant |
|---|:-:|:-:|:-:|
| Record sales | ✓ | ✓ | ✓ (needs an open shift; price is fixed to the pump price) |
| Own shifts and cash hand-over | ✓ | ✓ | ✓ |
| Deliveries, stock, trucks, expenses, customers | ✓ | ✓ (cannot read cost figures) | — |
| Reports | ✓ full P&L | ✓ sales and expenses only | — |
| Profit, cost of fuel, landed cost, stock value | ✓ | — | — |
| Void sales, deliveries, payments, expenses | ✓ | — | — |
| Users and audit log | ✓ | — | — |

**The database enforces this, not just the UI.** RLS policies, column-level grants and role-filtered views decide what each account can read or write. Managers and attendants read sales and deliveries through `sales_safe` and `purchases_safe`, which have no cost columns. The underlying `sales`, `purchases` and `tank_costing` tables are owner-only.

## How the money is calculated

- **Landed cost per litre** = (litres × cost per litre + trip cost) ÷ litres
- **Weighted average cost** per tank is updated on every delivery: (litres in tank × old average + delivered litres × landed cost) ÷ new total litres
- Each sale stores the tank's weighted average at the moment of sale as `cost_per_litre`, so later deliveries don't change past profit.
- **Gross profit** = sales − cost of fuel sold
- **Net profit** = gross profit − expenses
- **Stock value** = litres in each tank × that tank's weighted average landed cost
- **Truck profit (estimate)** = litres delivered × (current pump price − landed cost) − repairs/maintenance − other expenses tagged to the truck. Trip cost is already inside the landed cost, so it is not subtracted twice. If you also log a truck's delivery fuel as a separate `truck_fuel` expense, it will be counted twice.
- **Overdue** = the part of a customer's balance not covered by credit sales made within their payment terms (payments clear the oldest debt first).
- **Shift variance** = cash handed in − (cash sales in the shift + cash credit payments received during it). Attendants enter the cash before they see the expected figure.

## Rules the database enforces

- A delivery needs a truck, litres and cost per litre, and cannot overfill the tank.
- A sale cannot exceed the tank's stock.
- A credit sale needs a customer and cannot push them over their credit limit.
- An M-Pesa sale needs a transaction code, and each code can only be used once.
- Payments cannot exceed the balance owed.
- **Nothing is hard-deleted.** `DELETE` is blocked by a trigger and not granted to anyone. Sales, deliveries and payments can't be edited, only voided by the owner. A void reverses its stock and balance effects.
- **Every insert, edit and void is written to `audit_log` by triggers.** The log is append-only.

Two limitations to know about:

- Voiding a delivery removes its litres but does not recompute the tank's average cost.
- Dip readings are final. To correct a wrong reading, take a new one.

## Tests

```bash
npm run test:db
```

This runs all the migrations against an in-memory Postgres (PGlite) with a stubbed `auth` schema. It then checks:

- the landed and weighted-average cost maths
- gross profit, net profit and stock value
- every business rule above
- void reversals
- the audit log
- RLS isolation between owner, manager and attendant
- shift variance
- that the demo seed applies cleanly

## Project layout

```
supabase/migrations/   schema, triggers, RLS, views
supabase/seed_demo.sql demo data
scripts/test-db.mjs    database test suite
proxy.ts               session refresh + sign-in redirect (Next 16 "proxy", formerly middleware)
lib/auth.ts            server-side profile + role guards
app/(app)/…            one folder per screen; page.tsx loads data, *-client.tsx handles forms
```
