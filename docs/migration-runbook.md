# Production migration runbook

Application code that references a new table or column is not deployable until
the matching migration is applied to the same database. The runtime role
`kitchenbooks_local` is intentionally unable to create schema objects, so this
is a database-owner step, not something the web process can perform.

## Approved order

Apply the migrations in this order from the Supabase SQL Editor, one file at a
time, checking for `Success` after each file:

1. `multi_restaurant_memberships.sql`
2. `purchase_order_approvals.sql`
3. `stock_adjustment_approvals.sql`
4. `recipe_versions.sql`
5. `pos_sync_runs.sql`
6. `pos_credentials.sql`
7. `accounting_journal.sql`
8. `restaurant_invitations.sql`
9. `purchase_quotes.sql`
10. `salary_structures.sql`
11. `staff_holidays.sql`
12. `views_security_invoker.sql`
13. `stock_transfers.sql`
14. `recurring_journal_entries.sql`
15. `accruals.sql`
16. `fixed_assets.sql`
17. `pos_statement_imports.sql`
18. `payroll_statutory_config.sql`
19. `opening_balance_batches.sql`
20. `production_recipe_versions.sql`
21. `purchase_invoice_matches.sql`
22. `leave_policies.sql`
23. `attachment_lifecycle.sql`
24. `production_yield_variance.sql`
25. `stock_lots.sql`
26. `leave_requests.sql`
27. `recipe_line_substitutions.sql`
28. `production_variance_reviews.sql`
29. `pos_reconciliation_reviews.sql`
30. `leave_carry_forward_ledger.sql`
31. `demo_environment.sql`

The following maintenance migrations are independent of the numbered feature
sequence and should also be applied by the database owner when their related
workflow is enabled: `attachments_rls.sql`,
`business_day_in_thirty_day_windows.sql`, `business_date_tenant_scope.sql`,
`po_fulfilment_skips_voided_bills.sql`,
`pos_prune_superseded_fetch_bodies.sql`, and
`pnl_monthly_cash_voucher_months.sql`.

`pos_credentials.sql` must be applied before enabling the scheduled cron. The
deployment also needs `KB_POS_CREDENTIALS_KEY` and `CRON_SECRET`; these are
different secrets with different blast radii and must not be substituted for
the database password or exposed to the browser.

Newly provisioned restaurants receive an explicit `pos_stock_policy=reconcile`
default. Owners can change it to `none` from Settings before the first POS
fetch if the restaurant wants stock issues to remain entirely manual.

The other migrations are independent and can be applied before or after this
sequence. Do not run a migration twice in parallel. Every file is written to
be repeatable with `if not exists`/`create or replace` where appropriate.

## Repeatability check (disposable database only)

Before a first rollout, replay the complete migration directory against a
fresh disposable copy of the target schema. This is a schema-owner test, not a
production command: it may replace views, policies, functions, and grants but
must not be pointed at a live database. Every file must return `Success`; a
partial application must be safe to resume.

## Gate after each migration

Run the application checks locally:

```text
npx tsc --noEmit
npm run lint -- --quiet
npm run audit:migrations
npm run audit:migration-references
npm run audit:migration-safety
npm run audit:deployment
npm run preflight:production # deployment environment only
npm run audit:tenancy -- --strict
npm run audit:schema
npm run smoke:phase-a
npm run audit:stock-lots

# database-backed acceptance suite; set an explicit tenant and probe tenant
# in the private local environment before running this against a shared DB
KB_LIVE_TENANT=<restaurant id> KB_PROBE_TENANT=<different restaurant id> npm run smoke:a2
```

The schema gate must be clean before the corresponding feature flag or route
is enabled. For the journal migration, configure the restaurant's own chart
of accounts first; KitchenBooks does not invent tax, bank, or country-specific
accounts.

`smoke:a2` must not guess a tenant from the database or use a deployment-wide
default. It is intentionally refused when either explicit tenant variable is
absent, and the probe tenant must be a different restaurant for the isolation
checks to mean anything.

After `stock_lots.sql`, run `npm run audit:stock-lots` with
`KB_LIVE_TENANT` set. A clean result proves the lot ledger agrees with the
aggregate quantity. It does not claim to reconstruct historical FIFO order;
the seeded `LEGACY-*` lot remains the honest representation of pre-migration
stock until source documents are reviewed.

## Data-safety boundary

Do not reset the database password to apply these files. A password reset is a
credential rotation that can disconnect every client using that database role;
it is unrelated to schema migration. Use an existing database-owner session,
the Supabase SQL Editor, or a separately managed migration credential.

Do not apply source-workflow journal posting until the chart of accounts has
been reviewed by the restaurant's accountant. Until then, operational records
remain in their existing append-only registers and the journal page honestly
shows that no journal accounts are configured.
