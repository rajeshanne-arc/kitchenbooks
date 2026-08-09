# KitchenBooks

Purchase-bill bookkeeping for the Thrayam kitchen. One screen: enter a vendor
bill fast enough that it actually gets entered — vendors and items are created
inline the first time they appear on a bill, and rates pre-fill from history so
re-entering a familiar bill takes under a minute.

Stack: Next.js (App Router) + Tailwind on Vercel, Supabase Postgres.

## Architecture rules (non-negotiable)

1. **All database access is server-side** — server actions and route handlers
   only. The client never holds any database credential. `src/lib/db.ts` is
   guarded with `server-only`, so importing it from client code fails the build.
2. **Events are never edited.** Purchases, purchase lines, and payments are
   append-only; a correction is a reversal row (negative values,
   `reverses_id` pointing at the original). There is no `UPDATE` in this
   codebase — and none is possible: the app's DB role has no UPDATE/DELETE
   grants (see below).
3. **Masters are born inline.** There is no vendor- or item-management page.
   A new vendor or item is created inside the bill flow, in the same
   transaction as the purchase. Codes assign automatically:
   vendors `V-<CAT>-<2-digit>`, items `<CAT>-<3-digit>`, per restaurant+category.
4. **Every displayed derived number reads from a named view** —
   `vendor_dues.balance`, `item_rates.prefill_rate` — never a client-side
   recomputation. After a save, the reveal screen shows figures read back from
   the database, not echoes of what was typed.

## Database access

The app connects as **`kb_app`**, a dedicated Postgres role, through the
Supabase Supavisor pooler (transaction mode, port 6543):

- grants: `SELECT` on everything, `INSERT` on `vendors`, `items`, `purchases`,
  `purchase_lines` — **no UPDATE, no DELETE, anywhere**. Rule 2 is enforced by
  the database, not by convention.
- `BYPASSRLS` is set so the app keeps working if RLS is enabled later.
- The Supabase service-role/publishable keys are **not used at all**; there is
  no supabase-js in the app. The single secret is `DATABASE_URL`.
- Saving a bill is one `BEGIN … COMMIT`: vendor (if new) → items (if new) →
  purchase → lines, under a per-restaurant advisory lock so code sequences
  can't race. All money math is exact integer/bigint arithmetic
  (`src/lib/money.ts`); Postgres `numeric` holds the truth.

To rotate the credential: `ALTER ROLE kb_app WITH PASSWORD '<new>'` (as
postgres), then update `DATABASE_URL` locally and on Vercel.

> Note: RLS is currently OFF on all tables (by design, phase 1). That means the
> project's anon/publishable API keys would grant full access via PostgREST if
> ever shipped — so they must never appear in any client. Longer-term, enabling
> RLS with no policies would shut that door without affecting this app
> (`kb_app` bypasses RLS).

## Development

```bash
cp .env.example .env.local   # fill in DATABASE_URL
npm install
npm run dev
```

`npm run smoke` runs an end-to-end test against the real database through the
same server modules the app uses (creates `Zz Smoke …` rows and prints their
ids as JSON for cleanup — the app role itself cannot delete). It expects an
events-empty database for its code-sequence assertions.

## Deploy

Vercel project `kitchenbooks`, deploys from this repo. `DATABASE_URL` must be
set in the Vercel environment (production + preview). Everything runs on the
default Node.js runtime — no edge, no extra config.
