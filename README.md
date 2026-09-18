# KitchenBooks

KitchenBooks is a restaurant operating system connecting purchasing, inventory,
recipes, kitchen production, POS sales, staff/payroll, cash, and accounting
around one auditable business-day ledger.

Stack: Next.js App Router, Tailwind, Vercel Node runtime, and Supabase Postgres.

## Architecture rules

1. Database access is server-side only. The browser receives no database
   credential or Supabase service key.
2. Financial and operational events are append-only. Corrections are reversals
   or replacement records, never silent edits.
3. Every tenant read and write is scoped to the active restaurant, with forced
   RLS, composite tenant foreign keys, and server-side role checks.
4. Derived figures come from named database views or read-back records; the
   client does not recalculate accounting or stock truth.
5. The six restaurant roles are `owner`, `manager`, `chef`, `store`, `cashier`,
   and `accountant`. Platform administration is separate from those roles.

## Local development

Copy `.env.example` to `.env.local`, then fill in the server-only values:

```text
cp .env.example .env.local
```

Optional production capabilities are documented in
[`docs/open-questions.md`](docs/open-questions.md): memberships,
platform provisioning, POS credential encryption, cron authentication, and
private Blob storage each have separate secrets and must not be substituted for
the database password. `NEXT_PUBLIC_SUPABASE_URL` and a publishable key are not
used by this application.

```bash
npm install
npm run dev
```

The local app supports a demo POS adapter without live Petpooja credentials.
Use the owner setup screens to configure a restaurant, users, mappings, and
operational masters.

## Verification

```bash
npx tsc --noEmit
npm run lint -- --quiet
npm run audit:tenancy
npm run audit:matrix
npm run smoke:phase-a
npm run audit:schema
# Complete disposable acceptance gate (requires explicit fixture tenants)
npm run gates
```

The database-backed smoke suites require explicit `KB_LIVE_TENANT` and, for
write probes, a different `KB_PROBE_TENANT`. Never point a write probe at a
shared live restaurant. See [`docs/acceptance-tests.md`](docs/acceptance-tests.md)
for the product acceptance contract.

For one supplier bill use `/store/purchasing/import`. For a historical export
containing several bills, use `/store/purchasing/import/batch`: preview the
complete file first; commit is all-or-nothing and preserves each supplier
invoice reference.

## Database migrations

The application runtime role is intentionally not a schema owner. Apply the
ordered migrations from the Supabase SQL Editor using the database-owner
credential, then run the gates above. The complete sequence, maintenance
migrations, and live-data boundary are in
[`docs/migration-runbook.md`](docs/migration-runbook.md).

Do not reset the database password to make the application work. Rotate the
dedicated `kb_app` credential only through the database owner and update the
server environment in the same controlled change.

## Deployment

Vercel is pinned to the Mumbai region (`bom1`) and runs the hourly POS sync
cron. Production deployment is not complete until migrations, environment
secrets, Petpooja/provider access, Blob storage, and the explicitly named live
acceptance tenant have all been verified. The remaining external dependencies
and approval points are recorded in [`docs/open-questions.md`](docs/open-questions.md).

The complete first-rollout go/no-go record is
[`docs/production-release-checklist.md`](docs/production-release-checklist.md).

Run `npm run preflight:production` in the deployment environment before
releasing. It checks server-only secret presence, secret length, TLS, disabled
demo mode, and private Blob authentication without printing secret values. It
is expected to fail on a normal local `.env.local`.
