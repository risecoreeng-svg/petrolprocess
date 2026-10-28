# PetroTrack

PetroTrack is a multi-tenant SaaS for Kenyan fuel depots. It covers deliveries, pump sales, stock, credit customers, shifts, expenses and profit. Any business can sign up and gets its own private organization. Staff accounts belong to that organization only. The app is built for phones first, because attendants use it at the pump. Currency is KES and payments are cash, M-Pesa and credit.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn-style components · Supabase (Postgres, Auth, RLS) · Recharts · ready to deploy on Vercel.

---

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Copy your keys from *Project Settings → API keys*:
   - Project URL
   - **Publishable** key (`sb_publishable_…`, or the legacy `anon` key)
   - **Secret** key (`sb_secret_…`, or the legacy `service_role` key). It is server only, so never commit it or paste it anywhere public.

## 2. Supabase Auth settings

All of these are in the Supabase dashboard under **Authentication**.

| Setting | Where | Value |
|---|---|---|
| **Allow new users to sign up** | Sign In / Providers → Email (and the general *User Signups* toggle) | **On**. Public sign-up is how businesses join. |
| **Confirm email** | Sign In / Providers → Email | **Off while testing**, **On in production** (see below) |
| **Minimum password length** | Sign In / Providers → Email | 8 (the app also enforces this) |
| **Site URL** | URL Configuration | `http://localhost:3000` while developing; your production URL once deployed |
| **Redirect URLs** | URL Configuration | `http://localhost:3000/**` plus `https://your-domain/**` (and `https://*-your-team.vercel.app/**` for preview deploys) |

### Email confirmation while testing

- **Simplest: turn "Confirm email" off.** Sign-up signs you straight in and opens the Stock screen to set pump prices.
- **If you keep it on:** Supabase's built-in email sender only sends a few emails per hour, and only to addresses in your project's team. The confirmation link returns through `/auth/callback`, so `http://localhost:3000/**` must be in the Redirect URLs. Open the link in the same browser you signed up in.
- **To test with confirmation on and without real inboxes:** confirm a user by hand in *Authentication → Users → … → Confirm user*.

### In production

- Turn **Confirm email** on.
- Set up **custom SMTP** (*Authentication → Emails → SMTP Settings*, e.g. Resend, Postmark or SES). The built-in sender is rate-limited and not meant for real customers.
- Set Site URL and Redirect URLs to your real domain.
- Consider enabling **CAPTCHA** (*Authentication → Attack Protection*) to slow down sign-up abuse.

Password reset (the "Forgot password?" link on sign-in) uses the same redirect setup and also needs working email.

## 3. Configure the app

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill it in. Use the publishable key for `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the secret key for `SUPABASE_SERVICE_ROLE_KEY`. The secret key is used only on the server, for the owner's **Users** screen. `.env.local` is git-ignored.

## 4. Run the migrations

The schema lives in `supabase/migrations/` (tables → triggers → RLS → views).

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push --linked
```

To wipe a project that has no real data and start over, run `npx supabase db reset --linked`. **This deletes all data in the linked project.** Check `supabase/.temp/project-ref` first so you know which project it will hit.

There is no manual SQL step. Each business owner signs up in the app.

## 5. Run it

```bash
npm run dev
```

Open http://localhost:3000/signup and create a business:

1. Enter the business name, your name, email and a password.
2. In one database transaction, PetroTrack creates your login, a new organization, your **owner** profile, and the fuel types Petrol, Diesel and Kerosene (priced at 0).
3. Go to **Stock**: set the pump prices, add tanks, then record a delivery.
4. Add managers and attendants under **Users**.

## 6. Demo organization (optional)

The demo data lives in its own organization, flagged `is_demo = true`, and never mixes with real sign-ups.

1. Sign up in the app with a dedicated demo email, such as `demo@yourdomain.com`.
2. Put that email in `v_demo_email` at the top of `supabase/seed_demo.sql`.
3. Run it, either with the command below or by pasting the file into the SQL editor:

```bash
npx supabase db query --linked -f supabase/seed_demo.sql
```

This renames that org to "PetroTrack Demo Depot" and loads 14 days of data:

- 3 trucks, 3 tanks (kerosene is set up to trigger the low-stock alert) and 2 suppliers
- 3 credit customers
- cash, M-Pesa and credit sales
- expenses and a credit payment

It refuses to run if the account isn't an owner or its org already has tanks.

## 7. Deploy to Vercel

1. Import the repo in Vercel.
2. Add the three environment variables.
3. Deploy.
4. Add the production URL to Supabase's Site URL and Redirect URLs.

---

## Tenancy model

- **`organizations`** holds one row per business. Every business table, plus `profiles` and `audit_log`, has `org_id` (not null, indexed).
- **`current_org_id()`** returns the signed-in user's organization. It returns NULL for signed-out, deactivated or deleted users, so they match nothing.
- **Every RLS policy** requires `org_id = current_org_id()`. Every report view filters by it too.
- **`org_id` is never trusted from the client.** It isn't in any column grant. A trigger (`enforce_org`) stamps it on insert from the user's own profile and blocks any change afterwards.
- **Cross-org references are impossible.**
  - Triggers reject a truck, tank, customer, supplier, driver, fuel type, shift or attendant from another organization, with a clear message.
  - Composite foreign keys `(org_id, id)` back this up at the database level.
- **Uniqueness is per organization:** truck plates, fuel type names and M-Pesa codes.
- **Sign-up** runs as a trigger on `auth.users`:
  - A public sign-up always creates a **new** organization, and that user is its owner.
  - Staff are created by the owner through the server-only admin API, with `app_metadata.org_id` and a role of manager or attendant. Users can't set `app_metadata` themselves, so nobody can join someone else's organization.
- **The Users screen** only lists, creates, deactivates or resets the password of staff in the owner's own organization. It checks the target through the owner's RLS session before using the admin API.

## Roles (per organization)

| | Owner | Manager | Attendant |
|---|:-:|:-:|:-:|
| Record sales | ✓ | ✓ | ✓ (needs an open shift; price is fixed to the pump price) |
| Own shifts and cash hand-over | ✓ | ✓ | ✓ |
| Deliveries, stock, trucks, expenses, customers | ✓ | ✓ (cannot read cost figures) | — |
| Reports | ✓ full P&L | ✓ sales and expenses only | — |
| Profit, cost of fuel, landed cost, stock value | ✓ | — | — |
| Void sales, deliveries, payments, expenses | ✓ | — | — |
| Users and audit log | ✓ | — | — |

The database enforces these limits, not just the UI. Managers and attendants read sales and deliveries through the cost-free views `sales_safe` and `purchases_safe`.

## How the money is calculated

- **Landed cost per litre** = (litres × cost per litre + trip cost) ÷ litres
- **Weighted average cost** per tank is updated on every delivery: (litres in tank × old average + delivered litres × landed cost) ÷ new total litres
- Each sale stores the average cost at the moment of sale, so later deliveries don't change past profit.
- **Gross profit** = sales − cost of fuel sold
- **Net profit** = gross profit − expenses
- **Stock value** = litres in each tank × that tank's weighted average landed cost
- **Truck profit (estimate)** = litres delivered × (current pump price − landed cost) − repairs and maintenance − other truck-tagged expenses
- **Overdue** = the part of a customer's balance not covered by credit sales made within their payment terms
- **Shift variance** = cash handed in − (cash sales in the shift + cash credit payments received during it)

## Rules the database enforces

- **Deliveries** need a truck, litres and cost per litre, and cannot overfill a tank.
- **Sales** cannot exceed a tank's stock.
- **Credit sales** need a customer and must stay within that customer's credit limit.
- **M-Pesa sales** need a transaction code. Each code can be used only once within an organization.
- **Payments** cannot exceed the balance owed.
- **Soft delete only.** `DELETE` is blocked. The owner voids sales, deliveries and payments, and a void reverses its stock and balance effects.
- **Audit log.** Every insert, edit and void is written to `audit_log` with the user and organization. The log is append-only.

## Tests

```bash
npm run test:db
```

This runs all the migrations against an in-memory Postgres (PGlite) with a stubbed `auth` schema, then runs 125 checks.

**Sign-up**
- One sign-up creates the organization, owner profile and fuel types in a single transaction.
- Staff can't be created as owners or into an organization that doesn't exist.

**Profit and rules**
- Landed cost, weighted average, gross and net profit, and stock value.
- Every business rule, void reversals and the audit log.

**Roles and shifts**
- Role limits inside one organization.
- Shift variance.

**Cross-tenant isolation.** Each role in organization A (owner, manager, attendant) tries to:
- read organization B's rows from all 15 tables and every view, including lookups by id
- insert rows that reference B's records
- write `org_id` directly
- call internal helper functions
- close B's shift
- make 12 edits or voids on B's records

B's data must be unchanged afterwards. Reports for each organization must sum only that organization's own rows.

**Access control**
- Signed-out visitors can't read anything.
- Deactivated staff see nothing and can't write.

**Demo seed:** fills only its own organization and won't run twice.

## Project layout

```
supabase/migrations/   schema, triggers, RLS, views
supabase/seed_demo.sql demo organization
scripts/test-db.mjs    database test suite
proxy.ts               session refresh; signed-out visitors can only open auth pages
app/signup, app/login, app/forgot-password, app/reset-password, app/auth/callback
lib/auth.ts            server-side profile, organization and role guards
app/(app)/…            one folder per screen; page.tsx loads data, *-client.tsx handles forms
```
