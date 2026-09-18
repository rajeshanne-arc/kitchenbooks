# KitchenBooks production release checklist

This is the final go/no-go record for the first restaurant rollout. A local
green gate does not authorize a live database write or deployment.

Complete the final sign-off in [`docs/production-approval.md`](production-approval.md)
only after every unchecked live item below has evidence.

## Already verified locally

- [x] TypeScript compilation and ESLint pass.
- [x] `NEXT_DISABLE_WEBPACK_CACHE=1 npm run build -- --webpack` completes and
      produces the optimized route/trace output.
- [x] `npm run audit:migrations` proves every SQL migration is documented once.
- [x] `npm run audit:migration-references` proves source and documentation do
      not name a nonexistent migration file.
- [x] `npm run audit:migration-safety` rejects destructive/broad DDL and
      unpinned `SECURITY DEFINER` functions.
- [x] `npm run audit:deployment` verifies Mumbai (`bom1`) and the hourly POS
      sync cron declaration in `vercel.json`.
- [x] The complete migration directory was replayed successfully against the
      disposable schema; no repeatability failure occurred.
- [x] `npm run audit:schema` passes against the disposable migrated database.
- [x] `npm run audit:tenancy -- --strict` proves tenant-qualified reads/writes,
      forced RLS and policies on all tenant tables, security-invoker views, and
      composite tenant foreign keys.
- [x] `npm run audit:matrix` has no ungated role links.
- [x] `npm run gates` passes with explicit live/probe fixture tenants.
- [x] The reusable historical purchase-batch transaction probe passes and
      rolls back its deliberate failure completely.
- [x] `npm run audit:stock-lots` passes against labelled disposable legacy lots.
- [x] `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.
- [x] `npm run preflight:production` passes with a non-demo, TLS-enabled,
      private-storage configuration.
- [x] Local runtime starts on Next.js 16.3.5; `/login` returns 200, protected
      routes redirect to login, and `/api/cron/pos-sync` refuses an unauthorised
      request with 401.

## Database-owner actions — shared Supabase

- [ ] Take and verify an export/backup under the owner's normal procedure.
- [ ] Apply the ordered migrations in `docs/migration-runbook.md`, one at a
      time, using the database-owner credential.
- [ ] Confirm every migration returns `Success`; do not run them concurrently.
- [ ] Verify existing users and restaurant memberships before enabling
      `KB_MEMBERSHIPS=true`.
- [ ] Set `KB_MEMBERSHIPS` explicitly to `true` or `false`; do not rely on a
      misspelled value silently falling back to the compatibility path.
- [ ] Select a separate probe restaurant; never use the production restaurant
      for write probes.
- [ ] Reconcile current aggregate stock to documented opening/receipt lots;
      run `audit:stock-lots` with the real `KB_LIVE_TENANT`.
- [ ] Configure the restaurant chart of accounts and posting mappings; do not
      invent tax or banking accounts.

## Deployment-owner actions — Vercel and providers

- [ ] Set `DATABASE_URL` for the dedicated `kb_app` runtime role with TLS.
- [ ] Set `KB_SESSION_SECRET`, `KB_POS_CREDENTIALS_KEY`, and `CRON_SECRET` as
      separate server-only secrets; do not reuse the database password.
- [ ] Set private Blob credentials (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`, or
      a valid `BLOB_READ_WRITE_TOKEN`).
- [ ] Set `PETPOOJA_DEMO=false` in production.
- [ ] Confirm Petpooja credentials/provider access and rate limits, then save
      credentials from the owner Settings screen.
- [ ] Confirm WhatsApp provider/template approval if daily close links are to
      be sent automatically.
- [ ] Run `npm run preflight:production` in the actual deployment environment.
- [ ] Deploy to Mumbai (`bom1`) and verify the hourly POS cron authorization.

## Live acceptance and approval

- [ ] Sign in with a real owner account and verify restaurant switching and
      role boundaries.
- [ ] Exercise purchasing → receipt → stock → recipe/kitchen → POS → cash →
      accounting for one real business day.
- [ ] Verify one POS fetch, one retry/re-fetch, one reconciliation review, and
      one correction path without overwriting source history.
- [ ] Verify a bill photo upload/read/archive and a WhatsApp close link.
- [ ] Obtain explicit approval for the irreversible production deployment.

Until every unchecked item is signed by its owner, the release remains
`NOT APPROVED`; local acceptance must not be presented as live verification.

## Self-hosted deployment evidence (2026-09-13)

- [x] App deployed on the authorized server without adding a Docker container.
- [x] Isolated `kitchenbooks` database created in the existing PostgreSQL 16
      cluster; runtime uses the dedicated `kb_app` role.
- [x] All 36 migrations replayed successfully.
- [x] Server `audit:schema` and strict tenancy audit pass.
- [x] Hosted acceptance-probe restaurant provisioned separately from the demo
      owner restaurant.
- [x] Hosted `audit:stock-lots` passes for the probe tenant.
- [x] Hosted probe acceptance passes purchasing atomicity, Petpooja-shaped
      sales fetch/re-fetch/mapping, store issue/waste/void, and dashboard
      business-day checks.
- [x] `systemd --user` app and database TLS-proxy services are active.
- [x] Cloudflare Tunnel route `kb.etdemo.in` → `http://localhost:3120` reaches
      the app over HTTPS.
- [x] Configure temporary private self-hosted attachment storage at the
      server-only filesystem boundary. The storage directory is mode 0700 and
      individual objects are mode 0600; R2 can replace this adapter later.
- [ ] Provide verified Petpooja credentials/provider access and WhatsApp
      credentials/template approval for those external workflows.
- [ ] Complete the live business-day acceptance workflow and owner signoff.

## Shared-environment preflight evidence (read-only, 2026-09-13)

- The current Supabase connection passes strict tenancy baseline checks: 72
  tenant tables have forced RLS and policies, 82 views are security-invoker,
  and 107 tenant foreign-key relationships are composite.
- The current connection fails the schema audit because the feature migration
  columns are absent, including purchase approvals, production variance,
  payroll policy fields, and accounting mappings.
- No restaurant seed row is visible to the current connection. The dashboard,
  group, and live workflow acceptance checks therefore cannot run yet.
- This preflight changed no schema, row, credential, storage, POS, or provider
  state. The migration owner must take the backup and apply the runbook before
  any live acceptance or deployment approval is recorded.
