# Implementation worklog

## 2026-09-13 — full hosted demo environment and midnight reset

- Added a dedicated demo-environment migration with a guarded tenant reset
  function and a comprehensive seed function.
- Seeded representative restaurant settings, role accounts, departments,
  locations, vendors, items, staff, recipes, substitutions, purchases, PO
  approvals, quotes, invoice evidence, stock issues, lots, production variance,
  Petpooja-shaped POS orders, sync history, accounting mappings, cash/bank
  accounts, expenses, vouchers, payroll, attendance, leave, holidays, salary
  structures, statutory configuration, meters, accruals, and fixed assets.
- Added `/api/cron/demo-reset`, protected by a separate server-only secret.
- Added a systemd service and timer that reset only the explicitly marked demo
  tenant every midnight in `Asia/Kolkata`.
- Preserved the demo owner identity while resetting all other tenant data and
  recreated dates relative to the current day so dashboards remain useful.
- Executed the reset endpoint and the systemd service successfully on the
  hosted server. Verified the separate acceptance-probe tenant was unchanged.
- Documented the environment in `docs/demo-environment.md`.

## 2026-09-13 — release-gate boundary verification

- Re-ran the static gates: TypeScript, lint (zero errors), migration inventory,
  migration-safety audit, and production dependency audit all pass.
- A gate run using the existing `.env.local` correctly stopped at the schema
  audit because that file points to the shared Supabase database, where the
  pending migrations have not been applied. No shared schema or data was
  changed.
- A run against the complete disposable PostgreSQL schema resolved all 5,771
  checked column references. Its later behavioural assertions are stateful and
  require a freshly loaded fixture; an already-used disposable database is not
  presented as a fresh green run.
- The release checklist remains the source of truth: shared migration,
  provider configuration, live acceptance, and irreversible deployment
  approval are still owner-controlled gates.
- Found and corrected a real multi-tenant boundary defect in `business_date()`:
  its settings subqueries were not tenant-qualified and failed when an owner
  connection could see two restaurants. Added the repeatable
  `business_date_tenant_scope.sql` maintenance migration; it uses the
  announced tenant and retains a deterministic UTC fallback without a session.
- Applied that migration only to the disposable acceptance database and reran
  the behavioral suite through the restricted `kb_test` role (RLS enabled):
  `npm run gates` and `npm run audit:stock-lots` are green. The suite now
  proves the two-tenant business-day, attendance-action, and POS-generation
  paths under the same privilege boundary as the app.
- Rebuilt with `NEXT_DISABLE_WEBPACK_CACHE=1 npm run build -- --webpack` after
  the fix; compilation, TypeScript, route generation, trace collection, and
  `BUILD_ID` generation passed. The generated `.next` directory was removed
  afterward as a local build artifact because the workstation is at 100% disk
  usage; source and database state were untouched.
- Corrected stale security comments and the attachment decision record that
  still referred to a nonexistent pending RLS migration and described
  attachment RLS as disabled. The current boundary is
  `attachments_rls.sql`, with forced RLS verified by the tenancy gate; payroll
  identity comments now accurately describe the existing authenticated,
  role-gated path.
- Added `npm run audit:migration-references` and included it in `npm run gates`
  so a stale migration filename in source or release documentation becomes a
  failing check instead of another manual discovery.
- The new gate initially found two more obsolete migration names in the
  repository's working instructions. Those references were corrected to the
  current attachment and sequence-grant boundaries; the gate now checks 596
  repository files successfully.
- The first consolidated run with the new reference check also exposed a
  false positive in the existing SQL-read sweep: a backticked filename ending
  in `.sql` looked like a raw sql template. Removed that ambiguous comment
  formatting and reran `npm run gates` under the restricted role; migration
  reference, schema, tenancy, Phase A, and Phase A-2 gates all pass.
- Strict tenancy review found two migration-hardening omissions in the
  disposable schema: restaurant memberships had forced RLS without a policy,
  and pnl_monthly was missing from the security-invoker list. Added the
  idempotent membership policy and view option, then applied both maintenance
  migrations only to the disposable database before rechecking strict mode.
- Promoted strict tenancy mode into the default `npm run gates` command and
  updated the runbook/checklist. It now requires forced RLS plus a policy on
  all 112 tenant tables and security-invoker execution on all 82 views.
- Replayed every migration file against the disposable schema with
  `ON_ERROR_STOP=1`; all 36 completed successfully. This verifies the
  repeatability requirement after hardening the membership trigger and policy,
  without touching the shared Supabase database.
- Repeated the check in the exact numbered order from the production runbook,
  then replayed all six maintenance migrations; every file completed
  successfully. The earlier alphabetic replay is superseded by this stronger
  release-order evidence.
- Rechecked the shared Supabase connection read-only: strict tenancy passes for
  its current 72 tenant tables and 82 views, but the schema audit still fails
  on pending feature columns and there is no restaurant seed row. No live
  schema, data, credential, or provider state was changed.
- Replayed the exact production migration order again after the strict-tenancy
  hardening. Maintenance migrations that replace views now restore the
  `security_invoker` option after replacement; the complete `npm run gates`
  run is green with zero lint warnings. `git diff --check` is also clean.
- Ran the tenant isolation acceptance as the restricted local application role:
  no-tenant reads, cross-tenant unfiltered reads, cross-tenant writes,
  provisioning privilege, independent second-restaurant login, session tenant
  stamping, and all 82 tenant-scoped views passed. The reusable fixture now
  includes a clearly labelled local-only owner identity so the existing-user
  tenant-resolution assertion is exercised rather than reported untested.
- Re-ran the consolidated `npm run gates` against the current fixture after the
  isolation-test correction: all migration, schema, strict-tenancy, matrix,
  Phase A, and Phase A-2 checks passed again. The shell wrapper reported an
  unrelated reserved-variable error after the gate had completed; the captured
  gate log contains the complete green result and no assertion failures.
- Completed the local SOP/localization workstream: all 17 role moments now have
  reviewed Telugu title, timing, reason, and refusal copy; `/sops/<role>` reads
  the existing language cookie and follows the global EN/తెలుగు toggle. Added a
  Phase A content gate for every Telugu field and updated the SOP proposal and
  feature ledger so they no longer describe this as pending.
- Completed the reusable historical purchase-batch slice. Added a grouped CSV
  preview/commit route keyed by vendor plus supplier bill number, duplicate
  reference and master validation, source `bill_no` retention, and an
  all-or-nothing outer transaction around the existing stock, lot, dues, tax,
  and journal writer. Added a deliberate rollback probe; the full gate passes
  after fixing nullable purchase-order UUID typing and the vendor-scoped
  grouping edge case.
- Strengthened the batch evidence by asserting the supplier reference is
  retained before the deliberate rollback, and added a Phase A contract check
  for vendor-scoped grouping. The batch transaction probe and Phase A suite
  both pass on the current disposable fixture.
- Hardened statutory configuration input: effective dates are validated as real
  calendar dates and PF/ESI percentages are rejected above 100 before the
  insert is attempted. Added the corresponding Phase A contract assertion;
  provider-neutral TDS remains explicitly a filing-preparation handoff until
  an accountant approves a provider-specific contract.
- The first consolidated run correctly caught an unreadable Zod refine message;
  replaced it with a throwing transform, then reran the full gate successfully:
  36 migrations, 599 references, schema, strict tenancy, Phase A, the atomic
  purchase-batch probe, and Phase A-2 all pass.
- Rebuilt the current tree with `NEXT_DISABLE_WEBPACK_CACHE=1 npm run build --
  --webpack` after the batch, SOP, transaction, and statutory changes. Webpack
  compilation, TypeScript, page generation, route optimization, and trace
  collection passed; the generated 525 MB `.next` artifact was removed after
  verification because the workstation remains at 100% disk capacity.
- Audited the operator documentation after the new routes landed and updated
  `README.md` with the complete `npm run gates` command and the one-bill versus
  historical batch-import entry points. No stale workflow description remains
  in the top-level setup instructions.
- Exercised `saveStatutoryConfig` directly with a 101% PF input under the local
  server runtime; it returned the readable `percentage must be between 0 and
  100` error and performed no database lookup or write. The earlier harness
  failure was only a top-level-await invocation issue.
- Rechecked the configured Supabase connection read-only on 2026-09-13: strict
  tenancy remains healthy for the current 72 tenant tables and 82 views, while
  the schema audit still reports the pending feature columns (including PO
  approvals, attendance policy dates, and production expected output). No
  shared schema, data, credential, or provider state changed.
- Added that read-only shared preflight evidence to the production checklist,
  including the exact stop condition: backup and ordered migration application
  must precede live acceptance, and no live deployment approval is implied by
  the local green suite.

## 2026-09-13 — migration and acceptance-harness fixes

- Fixed the production-version backfill migration and added the missing
  tenant-qualified uniqueness prerequisite for recipe-line substitutions;
  the complete ordered migration set now applies cleanly to an isolated
  PostgreSQL acceptance database.
- Fixed the schema verifier’s CTE alias scoping so projected CTE columns are
  not checked against an inner table alias, while retaining its real-column
  checks.
- Added the voucher-only month spine migration so flagged cash vouchers appear
  in `pnl_monthly` even when no other source has a row for that month.
- Added explicit local-only database TLS opt-out support, with TLS remaining
  the production default.

## 2026-09-13 — POS statement preview gate

- POS statement CSVs now have a write-free preview that runs the same parser
  and validation as the commit path.
- Import remains disabled until preview succeeds; editing the CSV clears the
  preview, and the server validates again before the immutable statement is
  written.
- Preview totals use integer paise arithmetic rather than floating-point
  addition.

## 2026-09-13 — formal leave carry-forward ledger

- Added the tenant-scoped, insert-only `leave_carry_forward_ledger` migration.
- Leave balances and approval checks now prefer the recorded year-to-year value;
  before it is recorded, the existing calculation is visibly labelled as a
  suggestion rather than treated as final evidence.
- Added an accountant/owner control to record carry-forward, bounded by the
  source year's active policy and approved leave, with tenant locking and no
  edit grant.

## 2026-09-13 — production correction path

- Confirmed the variance correction workflow terminates in the existing
  immutable production void-and-re-file path: `voidProduction` writes a
  negative twin with the original frozen unit cost, and `ProductionEntry`
  records the corrected replacement.
- Updated the acceptance and feature ledger to describe that complete path;
  no silent production edit is introduced.

## 2026-09-13 — withholding filing handoff

- Added an accountant/owner-only provider-neutral withholding CSV export with
  date-range support, entered bases and amounts, regime codes, derived rates,
  deposit/challan status, and notes.
- The export is explicitly a handoff for the reviewed filing provider; it
  never invents a statutory rate or submits a filing.

## 2026-09-13 — mapped POS prep demand

- Added a policy-aware prep-demand surface to Kitchen › Production. It lists
  mapped dish portions sold for the current month and links to the recipe card.
- The surface is hidden when the owner selects `pos_stock_policy=none` and is
  explicitly labelled as planning signal only; it never creates stock issues
  or ingredient consumption.
- Production build compilation and page generation succeeded. The
  database-backed dashboard/group smokes remain unexecuted because the current
  shared connection has no restaurant seed row; this was recorded as an
  external database-owner dependency rather than guessed or created by a test.
- Added Phase A regression assertions for the policy-aware prep surface and
  provider-neutral withholding export; the expanded smoke suite, TypeScript,
  lint, and diff checks pass.

## 2026-09-13 — environment onboarding contract

- Added the secret-free `.env.example` template and allowed it through
  `.gitignore`; README setup instructions now match the file the runtime error
  references.
- The template separates required server values, temporary bootstrap PIN,
  local demo POS mode, and optional production-only capabilities.

## 2026-09-13 — purchase import commit gate

- Completed the import safety pass: one-bill purchase CSVs now require a
  successful write-free preview before the import button becomes available.
- Editing the file clears the preview, and the server revalidates the complete
  file before calling the normal bill transaction. Stock, dues, tax, and
  journal creation therefore remain on the existing atomic path.
- Verified TypeScript, lint, Phase A smoke, tenancy audit, route matrix, schema
  parser self-test, production webpack build, and diff whitespace checks.

## 2026-09-13 — POS stock policy

- Added an owner-controlled `pos_stock_policy` setting with explicit `none`
  and `reconcile` values.
- Kitchen and recipe sales quantities now honor that policy. Reconciliation is
  read-only and uses mapped POS recipe quantities; it never silently writes
  stock-lot movements or treats POS revenue as a store issue.

- Verified after the policy slice: optimized webpack build, TypeScript, lint,
  tenancy audit, route matrix, Phase A smoke, and diff checks all pass.
- Made the default explicit for newly provisioned restaurants in the
  provisioning migration and runbook: `reconcile` unless an owner selects
  `none`.

## 2026-09-13 — CSV parser regression coverage

- Added Phase A smoke assertions for BOMs, quoted commas, and malformed
  unclosed quoted fields in the shared RFC-4180 parser used by imports.
- The assertion protects opening-stock, staff, master, POS, payroll, and
  accounting imports from diverging CSV behavior.

## 2026-09-13 — production build boundary audit

- The production webpack build exposed synchronous helpers exported from
  `'use server'` import modules and a `server-only` module imported by a client
  action component. Converted import contract helpers to async Server Actions,
  updated their server pages, and changed the accounting mappings module to a
  server-action module.
- An initial build attempt was stopped by the workstation reaching 100%
  storage capacity (`ENOSPC`, about 156 MB free); the generated cache was the
  only cleanup target used before retrying.
- After removing only the generated `.next` cache, the optimized webpack build
  completed successfully: compilation, TypeScript, page generation, route
  optimization, and build-trace collection all passed. Webpack still reports
  non-fatal cache-write warnings while the workstation is nearly full.
- The generated `.next` output and npm cache were later cleared as recoverable
  local artifacts after repeated verification exhausted disk space; no source,
  database, or user data was removed.

## 2026-09-13 — Lot ledger foundation

- Added `stock_lots.sql` with tenant-scoped lots, FEFO ordering indexes,
  append-only signed lot movements, and a clearly labelled legacy lot seeded
  from current aggregate on-hand. New purchase receipts create provenance-rich
  lots, and stock issues allocate them earliest-expiry first inside the issue
  transaction; issue reversals restore the recorded allocations.
- Split-location balances and historical FIFO reconstruction remain explicit
  follow-up work; the migration does not pretend the old aggregate history was
  lot-aware.
- Vendor returns now write negative movements against their source receipt lot,
  reject over-returning that lot, and reverse the movement on void.
- Purchase-bill voids now reverse every source receipt lot through signed
  purchase-reversal movements.
- Transfers now allocate partial or whole quantities across source lots and
  append signed source/destination location movements; the lot read model shows
  split balances without editing the receipt lot.
- Recorded the approved production-output boundary: recipe outputs remain in
  the kitchen production/closing value ledger and are not fabricated as store
  item lots.
- Fixed the unplaced-lot path: lots without a storage location remain eligible
  for FEFO issue and wastage, while location transfers continue to require a
  real source location. Wastage reversals now have their own movement type.

## 2026-09-13 — Leave request and approval workflow

- Added `leave_requests.sql` with tenant isolation, overlap-safe pending and
  approved requests, and an explicit decision trail.
- Added the manager/owner request queue on Attendance. Approving a request
  writes one leave attendance fact per date and refuses to overwrite a present
  or half-day mark; rejection changes no payroll input.
- Payroll continues to read effective attendance, so approved leave enters the
  existing paid-day allowance without a second competing calculation.
- Cross-year requests are refused so annual entitlement and carry-forward are
  never silently allocated to the wrong year.
- Re-approving a day already marked leave does not create a redundant
  attendance filing; existing off/absent facts become an explicit leave
  correction instead.

## 2026-09-13 — Recipe substitutions

- Added `recipe_line_substitutions.sql` with tenant-scoped, active-item
  alternatives, positive quantity ratios, and immutable source metadata.
- Added the recipe-editor substitution panel. Substitutions are alternatives
  to a specific ingredient line, cannot target sub-recipe lines, and are
  included in the next recipe version snapshot rather than changing the
  primary recipe silently.

## 2026-09-13 — Production variance review

- Added `production_variance_reviews.sql` and a manager/owner review control
  for each monthly variance.
- Acknowledgement and correction requests require a note and preserve the
  original immutable production record; a later correction remains a separate
  filing.

## 2026-09-13 — POS difference review

- Added `pos_reconciliation_reviews.sql` and a review control beside each
  provider/book difference.
- Authorized sales/accounts roles can acknowledge a difference or request a
  correction with a note; the statement and sales ledgers remain untouched.
- POS statement imports now use the shared RFC-4180 parser, preserving quoted
  commas and rejecting malformed quoted fields instead of shifting columns.

## 2026-09-13 — Indirect cash-flow bridge

- Added the journal-backed indirect cash-flow view: period net profit plus
  non-cash working-capital asset/liability changes.
- Explicitly mapped cash, bank, and wallet accounts are excluded from the
  bridge, so it can sit beside the direct movement view without double-counting.

## 2026-09-13 — Evidence lifecycle metadata

- Added repeatable `migrations/attachment_lifecycle.sql` with active/archived
  status, optional retention date, tenant-scoped index, and narrow runtime grant.
- Added manager/owner-only archive action and controls to bill and meter evidence.
  Archiving is metadata-only: the private blob remains readable for audit and no
  destructive deletion path was introduced.

## 2026-09-13 — Purchase import preview

- Added a write-free purchase CSV preview that runs the same complete validation
  as import, reports vendor/date/line count/goods value, and requires a separate
  explicit import action before the normal bill transaction runs.

## 2026-09-13 — Production yield variance inputs

- Added `production_yield_variance.sql` and wired production filings to snapshot
  expected output from the selected recipe and capture measured waste. Voids
  reverse both quantities without changing the original evidence.
- Added a monthly production variance query and review panel showing expected,
  made, waste, and signed variance by recipe.

## 2026-09-13

- Added a parameterized PF/ESI calculation helper and extended the payroll
  export with employee/employer contribution amounts. Percentages and caps are
  read from the effective restaurant configuration; no statutory default or
  TDS rule is fabricated.
- Added `purchase_invoice_matches.sql` and an append-only invoice assessment
  written in the purchase transaction. PO bills now record matched, partial,
  or exception status with quantity/rate flags and the exact comparison
  snapshot; bills without a PO are explicitly marked unmatched.
- Completed the existing meter attachment boundary: meter saves now return the
  immutable reading ID, and the close screen offers optional evidence upload
  against `meter_reading` without delaying or rolling back the reading.
- Added tenant-scoped leave policies and effective staff assignments. Payroll
  draft pay-days now credits leave only up to the assigned policy's paid-day
  allowance; unassigned leave remains unpaid rather than silently receiving a
  default entitlement.
- Added a reusable one-bill purchase CSV importer at
  `/store/purchasing/import`. It requires existing active vendor/item codes,
  validates the complete file and shared bill metadata before writing, and
  delegates to the normal bill transaction so stock, dues, tax, and journal
  behavior cannot diverge. The source-specific historical multi-bill script
  remains the controlled path for reconciled backfills.
- Added `production_recipe_versions.sql` and pinned new production entries to
  the recipe version effective on their production date. Existing production
  rows are backfilled to available recipe history; no pre-history version is
  fabricated. Production reversals carry the same pinned version.

- Recorded Ground Rule #1: continue end to end; routine decisions do not pause
  execution; only genuinely external dependencies or irreversible live-data
  approvals may pause it.
- Added approved product specification, decisions, feature ledger, open
  questions, and cross-feature acceptance tests.
- Added self-service password change at `/account/security`.
- Prepared the global identity and restaurant-membership migration. It keeps
  `app_users` compatible while separating future multi-restaurant identity
  from membership.
- Added global-login restaurant selection behind `KB_MEMBERSHIPS=true`.
- Added owner-managed “add restaurant access” control and a database function
  that validates owner authority, role, account, and same-restaurant staff
  links.
- Added owner-managed membership listing and retire/restore controls, with a
  database-side last-active-owner safeguard.
- Added a database-owned synchronization trigger so legacy account actions
  remain consistent with global identities and memberships after migration.
- Added restaurant switching in the navigation, with session revalidation
  against the selected active membership and owner membership lifecycle UI.
- Added the remaining owner lifecycle read/write actions and controls for
  listing, retiring, and restoring memberships.
- Added a server-only platform provisioning endpoint that atomically creates a
  restaurant, baseline settings, departments, and its first owner.
- Patched Next.js to 16.3.5 and sharp to 0.35.4. Production npm audit is
  currently clean.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next.js 16.3.5.
- `npm run audit:matrix`: passed with no violations.
- `npm run audit:schema`: passed.
- `npm run audit:tenancy`: passed.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `npm run lint`: zero errors; seven pre-existing unused-variable warnings.
- Membership UI and server actions compile and are included in the production
  build.

## Next execution boundary

Apply and verify the membership migration, then complete restaurant switching
and membership listing/retirement before advancing to purchasing approval and
the operational accounting loop.
## 2026-09-13 — Recovery UX and production boundary

- Added an explicit post-reset confirmation on the login screen.
- Added first-use instructions for the owner-issued one-time reset flow, so a
  person who forgot a password has a clear next action instead of a generic
  login failure.
- Confirmed the runtime database role is `kitchenbooks_local` and cannot create
  schema objects. Production migrations therefore remain a separately approved
  deployment step; application code must not pretend those tables exist before
  `migrations/multi_restaurant_memberships.sql` is applied.
- Purchasing approvals remain the next implementation slice. They require a
  new durable approval state and queue integration; no partial UI was added
  that could appear to approve an order without freezing and recording it.
- Prepared `migrations/purchase_order_approvals.sql` with tenant-scoped PO
  approval state, immutable amount snapshots, one-pending-request protection,
  and per-restaurant threshold settings. It is deliberately not applied to
  the shared database until the matching state-machine code is deployed.
- Wired the PO state machine: drafts can be submitted for approval, pending
  drafts are frozen, owner approval unlocks the normal vendor send, refusal
  restores editability, and the owner approvals queue shows the amount,
  requester, reason, and decision controls.
- Added the owner Settings control for disabling approvals or setting the
  rupee threshold. The migration and application code must ship together;
  enabling the code before the migration is applied is intentionally not
  treated as a valid production state.

## Verification after purchase approval slice

- `npx tsc --noEmit`: passed.
- `npm run lint -- --quiet`: passed.
- `npm run audit:matrix`: passed with no violations.
- `npm run audit:tenancy`: passed; all new tenant-qualified SQL paths are
  scoped. The schema audit correctly reports the approval columns/table as
  missing from the current shared database because its migration is not yet
  applied.
- `NEXT_DISABLE_WEBPACK_CACHE=1 npm run build -- --webpack`: passed on Next.js
  16.3.5; the ordinary cached build hit local disk exhaustion, not a code
  error. Generated `.next` output was removed after verification.
- Inventory review confirmed that counts already require a deliberate
  acceptance, but standalone corrections post immediately. Prepared
  `migrations/stock_adjustment_approvals.sql` for the configurable owner
  approval path; the request queue and write-through code are the next slice.
- Wired the standalone correction approval path: owner setting, frozen request
  lines with server-captured unit cost, owner approval/refusal, stock write on
  approval only, and queue presentation on the Approvals page.
- Prepared `migrations/recipe_versions.sql` and wired recipe create, header,
  line, yield, and dish-card writes to record immutable snapshots with effective
  dates. Existing recipes are backfilled as version 1; production verification
  remains after migration application.
- Added the recipe detail history panel, showing version number, effective
  timestamp, component-line count, and recorder. The screen explicitly states
  that history begins after the migration rather than displaying a fabricated
  version when the table is absent.
- Current `npm run audit:schema` failures are limited to the purchase approval
  columns/table, which are supplied by `migrations/purchase_order_approvals.sql`;
  the other new migration-backed tables are not yet resolvable because the
  shared database has not received the pending migrations. No migration was
  applied with the runtime `kitchenbooks_local` role.
- Added `migrations/pos_sync_runs.sql` and wired each Petpooja fetch attempt to
  a durable running/succeeded/failed record with attempt number and error
  visibility. The fetch screen now shows this history; successful payload
  generations remain governed by latest-fetch-wins and are not overwritten.
- Added three-attempt bounded retry handling in the Petpooja adapter for
  network errors, HTTP 429, and HTTP 5xx responses. Authentication and other
  client errors fail immediately, and persistence still happens only once
  after a successful normalized response.
- `npm run smoke:sales` remains stale: it calls `getRestaurant()` without an
  announced tenant and now fails before the sales assertions when the shared
  database has no unambiguous fallback. It does not exercise the new sync-run
  path; a tenant-aware sales smoke test is still required.
- Repaired `scripts/smoke-sales.ts` to require and wrap all assertions in
  `KB_LIVE_TENANT`, matching the tenant-explicit safety model used by the newer
  smoke suites. In the current `.env.local` it stops with the explicit missing
  tenant message; no live or guessed tenant is used.

## 2026-09-13 — Accounting journal boundary

- Added `migrations/accounting_journal.sql` with a tenant-scoped chart of
  accounts, immutable journal headers/lines, composite tenant foreign keys,
  RLS, and a database posting function that enforces balance and closed-period
  locking.
- Added the server-only `postJournalEntry` boundary and journal integrity read
  model. Existing operational writes are intentionally not claimed as posted
  until each workflow supplies its account mapping and is migrated in the
  same transaction.
- The journal migration is prepared but not applied to the shared database.
- Added the owner/accountant chart-of-accounts editor to the existing Accounts
  setup surface and added the accountant journal/trial-balance route. The
  journal remains deliberately unpopulated until the restaurant configures its
  own account codes and the source workflows are migrated to post them.

## 2026-09-13 — Attachment state reconciliation

- Verified the current database has forced RLS, the tenant policy, and SELECT /
  INSERT privileges for `attachments`; added the matching repeatable
  `migrations/attachments_rls.sql` so that protection is versioned in the repo.
- Reconciled the storage decision with the implementation: private Vercel Blob,
  server-only uploads, restaurant-first object keys, and authenticated
  streaming reads are implemented. Production Blob credentials and the meter
  evidence consumer remain deployment work, not reasons to add a database
  master key.
- Extended the journal migration with explicit tenant-scoped posting mappings
  and server-side mapping reads. Source workflows will refuse to post when a
  required mapping is absent; no first-account or country-specific default is
  allowed.
- Wired vendor payments to the journal boundary in one transaction: debit the
  configured vendor-payable liability and credit the selected money account's
  configured asset account. Missing or incorrectly typed mappings abort the
  entire payment, including its document number.
- Wired operating expenses to the same boundary, one journal entry per receipt
  line, and created matching journal reversals when an expense is voided. A
  missing expense mapping or unmapped physical money account rolls back the
  whole batch.
- Wired other income and cash vouchers to the journal. Income credits the
  configured revenue account; vouchers debit food, labour, or operating
  expense according to their declared purpose and credit either the selected
  asset account or the owner-payable liability for owner-funded spend.
- Wired purchase creation to post inventory and vendor payable atomically,
  separating input tax only when the restaurant's explicit tax setting and
  input-tax asset mapping say it is creditable. Purchase voids now reverse the
  exact original journal lines.
- Wired approved payroll payment to post gross wages, net wages, advance
  recovery, other deductions, and withholding liabilities atomically. A missing
  mapping keeps the run approved rather than falsely marking it paid.
- Wired POS ingest to post successful revenue by explicit payment-mode asset
  mappings and the sales-revenue account. Superseded fetch generations receive
  one exact flipped journal reversal before the new fetch is posted, preserving
  latest-fetch-wins without double-counting the ledger.
- Added encrypted per-restaurant Petpooja credentials with owner-only setup,
  a non-secret configured indicator, and fetch-time decryption. Production
  fetches no longer fall back to deployment-wide credentials; local demo mode
  remains available without real POS access.
- Added the hourly Vercel cron endpoint. It uses a separate `CRON_SECRET`, a
  narrow database function that returns tenant ids only, and `withTenant()`
  around every fetch; each attempt continues to use the existing durable sync
  run and journal idempotency boundaries.
- Split credential reads/decryption into a `server-only` module after the
  security review caught that secret-returning exports must never live in a
  `'use server'` action module. The client-facing module now exposes only the
  owner save action.
# 2026-09-13 — Secure restaurant invitations

- Added the repeatable `restaurant_invitations.sql` migration with forced RLS,
  tenant-scoped owner issuance, 48-hour expiry, one-use consumption, and
  database-side username/staff/role validation.
- Added the owner account-management invitation form and public `/invite`
  acceptance route. The browser receives the bearer link only once; the
  database stores its SHA-256 digest and the invitee chooses their password.
- Added explicit login confirmation after acceptance and kept existing-account
  membership addition separate: invitations are for new global accounts.
# 2026-09-13 — Purchasing quotations

- Added `purchase_quotes.sql`, an RLS-protected quote header/line register with
  composite tenant foreign keys and no financial side effects.
- Added the quotation capture screen under Store → Purchasing → Quotes and a
  dated quotation register. Quotes remain evidence until a person raises a PO;
  they do not silently create purchases, stock, or vendor dues.
- Added accepted-quote conversion into a draft PO, preserving the quote as
  immutable evidence and routing the new document through existing approval and
  send controls.

# 2026-09-13 — Payroll payslips

- Added a printable payslip route for every payroll run. It reads the frozen
  payroll lines, shows earnings/deductions/withholding/net payable and payment
  status, and never recalculates or writes payroll data.
- Linked payslips from the run detail page and documented the remaining
  salary-structure and statutory-export work separately from the payslip
  presentation.

# 2026-09-13 — Effective-dated salary structures

- Added `salary_structures.sql` with tenant RLS, composite staff ownership,
  positive-salary validation, and effective-date uniqueness.
- Added accountant/owner salary-structure entry and history on Payroll →
  People. Payroll drafts now select the latest structure effective by the
  period end, with the legacy staff salary as a compatibility fallback.
- Prepared and paid runs remain frozen because structures are read only while
  drafting and never joined into historical payroll lines.

# 2026-09-13 — Payroll export contract

- Added an accountant/owner-only run-specific CSV export. It uses the same
  frozen payroll line source as payslips, is tenant-scoped, formula-safe for
  spreadsheet applications, and explicitly remains a recorded-data export;
  statutory rates and filing are still accountant-configured work.

# 2026-09-13 — Holiday calendar

- Added `staff_holidays.sql` with tenant RLS and explicit paid/unpaid policy.
- Added manager/owner holiday entry and a visible attendance-calendar list.
- Payroll drafts now add paid holidays only when no attendance mark exists for
  that employee/date; explicit attendance remains authoritative and historical
  payroll lines remain frozen.

# 2026-09-13 — Journal-backed financial statements

- Added period-scoped P&L and cumulative balance-sheet queries over posted
  double-entry journal lines.
- Added direct cash-flow movement over explicitly mapped cash, bank, and wallet
  accounts; unmapped money accounts remain excluded rather than guessed.
- Added accountant-facing statement routes and register chips, with empty-state
  wording that distinguishes no posted data from operational data not yet
  migrated into the journal.

# 2026-09-13 — Role operating guides

- Implemented version-one written SOP moments at `/sops/<role>` for all six
  restaurant roles, including owner access to every guide.
- Added live route links, role-boundary redirects, and print-friendly layout.
- Kept Telugu form labels in the existing shared dictionary; Telugu SOP prose
  remains a documented review item rather than machine-generated copy.
- Added the guide to the signed-in top navigation for discoverability.

# 2026-09-13 — Opening-stock CSV import

- Consolidated opening-stock parsing onto the shared RFC-4180 reader so its
  preview and commit handle quoted fields, embedded newlines, BOMs, and
  malformed quotes consistently with the other import contracts.

- Added a write-free preview that validates duplicate-free quantities, resolves
  active items in the restaurant, and reports the current owner-approval mode
  before the explicit commit uses the normal adjustment transaction.

- Added a validated `code,quantity` opening-stock CSV flow under Stock →
  Import opening stock.
- Validation resolves every code and duplicate before invoking the existing
  atomic adjustment path; imported rates are never accepted from the file.
- Owner approval, server-side cost snapshots, tenant scope, and append-only
  stock history remain the existing workflow’s responsibility.

# 2026-09-13 — Stock location transfers

- Added `stock_transfers.sql` with forced RLS, composite tenant foreign keys,
  immutable transfer headers/lines, and indexes.
- Added Store → Stock → Transfers for full recorded-quantity moves between
  active locations, with source-location and availability checks in the
  transaction.
- Kept total stock/value unchanged and documented the remaining limitation:
  partial location allocation and lot-level balances require a location-
  balance model rather than a silent approximation.

# 2026-09-13 — Recurring journal entries

- Added tenant-scoped recurring templates, lines, and period-run records with
  forced RLS and idempotent `(template, period)` uniqueness.
- Added Accounts → Registers → Recurring entries for balanced template entry
  and deliberate current-period posting.
- Posts use the existing database journal boundary, so closed periods,
  account mappings, balance, and append-only source evidence remain enforced.

# 2026-09-13 — Accruals

- Added tenant-scoped accrual headers and append-only accrual-posting records
  with forced RLS and one-post-per-kind uniqueness.
- Added Accounts → Registers → Accruals for expense/liability entry and a
  deliberate dated reversal.
- Both sides post through the existing balanced journal function; failed or
  duplicate runs roll back or refuse without creating partial records.

# 2026-09-13 — Fixed assets

- Added tenant-scoped fixed-asset register and append-only depreciation records
  with forced RLS, composite account ownership, and one-post-per-asset-period
  uniqueness.
- Added Accounts → Registers → Fixed assets for explicit asset registration
  and deliberate straight-line depreciation posting.
- Useful life, salvage value, dates, and ledger accounts are recorded inputs;
  the journal enforces balanced postings and closed-period protection.

# 2026-09-13 — POS statement reconciliation

- Added immutable provider-statement headers and lines with forced RLS.
- Added Sales → Books → POS reconciliation with validated CSV evidence and
  daily comparison against the latest revenue sales generation.
- Differences remain explicit review items; the import never overwrites POS
  orders or silently creates a correction.
## 2026-09-13 — statutory payroll configuration

- Added `payroll_statutory_configs` as an effective-dated, tenant-scoped
  register for accountant-entered jurisdiction, PF/ESI percentage/cap, TDS
  regime, and source-note context.
- Added the owner/accountant People-screen editor with range validation and
  immutable history-by-insert semantics.
- Added the period-effective configuration context to the payroll CSV export.
- Deliberately did not calculate or overwrite payroll withholding: statutory
  rules and filing formats remain an accountant-approved product dependency.
- TypeScript, lint, tenancy audit, route matrix, and `git diff --check` pass.
- Added a narrow pre-migration read fallback so this new panel does not make
  the existing People route unavailable during staged rollout.

## 2026-09-13 — validated staff import

- Added an RFC-4180 CSV reader and an all-or-nothing staff import for manager
  and owner roles.
- Validates the exact header, row count, employment/pay modes, amounts, dates,
  and active section references before assigning permanent roster codes under
  the same restaurant lock used by manual staff creation.
- Kept bank and statutory identifiers outside the CSV contract; they remain
  role-gated fields on the People screens.

## 2026-09-13 — staff import preview

- Added a write-free staff CSV preview that runs complete import validation,
  reports row count, sections, and proposed next employee codes, and keeps
  commit disabled until preview succeeds.
- The commit path reparses and revalidates inside the transaction under the
  restaurant advisory lock, so a stale preview cannot bypass validation or
  create a partial batch.

## 2026-09-13 — validated vendor import

- Added an atomic vendor-master CSV import for store, manager, and owner roles.
- Validates the exact header, row count, active categories, duplicate names,
  field lengths, and existing vendor names before assigning sequential
  category-specific vendor codes under the restaurant lock.

## 2026-09-13 — vendor and item import previews

- Added write-free previews for vendor-master and item-master CSV files. Each
  preview runs the complete validation, resolves active references, reports
  row count and proposed codes, and makes no database writes.
- Explicit commit actions reparse and revalidate under the restaurant lock
  before the existing atomic inserts run.

## 2026-09-13 — validated item import

- Added an atomic item-master CSV import for store, manager, and owner roles.
- Validates categories, purchase units, optional storage locations, rates,
  expiry flags, duplicate names, and existing item names before assigning
  sequential category-specific item codes.

## 2026-09-13 — sales CSV through POS ingestion

- Added a single-business-date sales CSV importer that normalizes rows into
  the existing `persistFetch` boundary rather than creating a second sales
  ledger.
- Duplicate IDs, mixed dates, future dates, and malformed numeric fields are
  rejected before persistence; valid imports retain latest-fetch replacement,
  status classification, and configured accounting mappings.

## 2026-09-13 — purchase import boundary reviewed

- Reviewed the existing historical purchase importer. It requires whole-sheet
  day/count/vendor-grain reconciliation and supports dry-run, rehearse, and
  commit modes; it must not be replaced by a generic upload that can partially
  write multiple bills or bypass those checks.
- Kept it as the controlled source-specific path until a reusable purchase
  import contract can provide the same all-file atomicity and reconciliation.

## 2026-09-13 — sales import preview

- Added a write-free sales CSV preview for the exact single-date contract. It
  validates IDs, status, dates, amounts, and future-date rules without creating
  a POS generation.
- The explicit commit reparses the file and then uses the existing immutable
  `persistFetch` and journal path.

## 2026-09-13 — payroll CSV through prepare workflow

- Added a write-free payroll preview that validates the complete one-period
  file, resolves staff codes within the restaurant, and checks duplicates before
  the explicit commit creates a draft through `preparePayrollRun`.

- Added a one-period payroll CSV importer that resolves staff codes within the
  active tenant, validates all frozen components, rejects duplicates, and
  delegates to `preparePayrollRun` so overlap checks and the approval boundary
  remain intact.

## 2026-09-13 — atomic chart-account import

- Added an owner/accountant CSV importer for `code,name,type` chart accounts.
- Added a write-free preview that reports the validated row count; commit
  reparses and rechecks existing codes under the restaurant lock.
- Validates supported account types and duplicate codes before one tenant-
  scoped insert; posting mappings and opening balances remain explicit follow-
  up configuration rather than hidden import side effects.

## 2026-09-13 — balanced opening-balance import

- Added a write-free opening-balance preview that checks the full file, exact
  debit/credit balance, one-date scope, and active account codes before the
  explicit commit posts the immutable evidence batch and journal entry.

- Added a one-date opening-balance CSV importer with immutable batch evidence,
  exact balancing validation, tenant-local account resolution, and journal
  posting through the existing balanced/closed-period function.
## 2026-09-13 — acceptance harness and migration hardening

- Fixed two migration defects found by loading the complete schema and all
  migrations into an isolated PostgreSQL 17 database: production recipe
  version pinning now uses a valid correlated lookup, and substitutions now
  have the composite recipe-line key they reference.
- Added the repeatable `pnl_monthly_cash_voucher_months.sql` view correction so
  a month containing only flagged cash vouchers still appears in P&L.
- Added local-only `KB_DB_SSL=disable` support for disposable PostgreSQL
  acceptance runs; TLS remains mandatory by default.
- Corrected acceptance privilege assertions to use PostgreSQL privilege
  functions/catalogue data rather than role-filtered information-schema views.
- The local acceptance tenant now proves the role, tenancy, migration, period,
  accounting, payroll, inventory, and UX gates. Historical purchasing, POS,
  issue, recipe, and day-close scenarios remain explicitly untested until a
  dedicated fixture or real tenant history exists; no shared Supabase rows
  were changed.
- Fixed JSON journal-line binding at the postgres.js boundary. Passing a
  stringified array made PostgreSQL receive one scalar JSON value and reject
  otherwise valid POS refresh journals as having fewer than two lines.
# 2026-09-13 — final acceptance tightening

- Re-ran the typecheck, lint, tenancy/schema audits, Phase A smoke suite, and
  Phase A-2 database-backed acceptance suite after the final UI acknowledgement
  review. Phase A and Phase A-2 pass; the action-acknowledgement audit now
  records every remaining inline/list-refresh/import/navigation case with an
  explicit, self-expiring rationale rather than silently ignoring it.
- Confirmed `npm audit --omit=dev --audit-level=high` reports zero production
  vulnerabilities and `git diff --check` is clean.
- The local stock-lot audit is intentionally backed by labelled legacy lots;
  it does not pretend to reconstruct historical FIFO provenance. Before
  production enablement, reconcile each live item's aggregate on-hand to
  documented opening/receipt lots and then rerun `audit:stock-lots` with
  `KB_LIVE_TENANT` set.
- The expanded fixture now removes the prior read-side `UNTESTED` notices for
  voided-bill refusal, recipe/party filtering, POS order times, and the
  two-active-recipes merge-repoint scenario; the final Phase A-2 run proves all
  of those paths on disposable data.
- Loaded the expanded disposable fixture into the local acceptance database and
  reran the consolidated `npm run gates` plus `audit:stock-lots`; both passed.
  The fixture now proves time-aware POS grouping, active recipe cost rows, and
  aggregate-to-legacy-lot reconciliation. The reproducible load/run commands
  are recorded in `docs/acceptance-tests.md`.
- Added `npm run preflight:production`, which fails closed when deployed
  environments lack TLS, session/POS/cron secrets, private Blob access, or
  still have demo POS mode enabled. A synthetic non-secret configuration passes
  the preflight; no secret values are printed.
- Strengthened the consolidated `gates` script to run TypeScript compilation
  before lint and the acceptance checks; the updated single command passes with
  the explicit disposable live/probe tenants.
- Added a voided purchase reversal pair, a settled vendor, and a second dish
  with deliberately different cost/order characteristics to the local fixture.
  The resulting final run has no `UNTESTED` notices in the A-2 data probes;
  `npm run gates` and `audit:stock-lots` both pass.
- Updated the shared smoke-account helper to use `tsql`, so its lookup and
  creation participate in the same tenant announcement/RLS contract as the
  application. The older phase-specific smoke scripts remain separate legacy
  fixtures with their own canonical-seed prerequisites; they are not folded
  into the consolidated production gate.
- Added `docs/production-release-checklist.md` as the explicit first-rollout
  go/no-go record. It marks the local evidence already obtained and keeps
  shared Supabase migrations, live lot reconciliation, provider setup, live
  acceptance, and irreversible deployment approval visibly outstanding.
- Added `npm run audit:migrations` and included it in `npm run gates`; it
  verifies every SQL migration file appears exactly once in the approved
  runbook, including the independent maintenance migrations.
- Re-ran the strengthened consolidated gate after the migration-audit change;
  TypeScript, lint, migration inventory, schema, tenancy, role matrix, Phase A,
  and Phase A-2 all pass with the explicit disposable tenants.
- Converted the manual migration safety review into `npm run
  audit:migration-safety` and included it in `npm run gates`; it rejects
  destructive/broad DDL and requires every `SECURITY DEFINER` function to pin
  `search_path`.
- Expanded the disposable fixture with the canonical `VEG`/`NONVEG` ingredient
  categories, starter-library entries, unified-section baseline, and
  `PLT-001`/`PLT-002` stock expected by the phase-specific operational smokes.
  The fixture remains local-only; the consolidated A-2 and stock-lot audits
  pass after loading it.
- Re-ran the production webpack build after removing only generated `.next` and
  npm caches to address local disk exhaustion. Compilation, TypeScript,
  static-page generation, route optimization, and trace collection completed;
  `.next/BUILD_ID` was present. The generated `.next` output was then removed
  to leave the workspace clean.
- Started the application against the disposable local database and verified
  runtime behavior: `/login` returned 200, `/` and `/owner` redirected to the
  login flow, and the POS cron endpoint rejected an unauthorised request with
  401. No async panic appeared in the server log; the dev server was stopped
  after the probe.
- Corrected the withholding-deposit acknowledgement so it accurately states
  that the selected money account is recorded and remains available for
  cash/bank reconciliation. TypeScript, lint, diff checks, and the full
  restricted-role local gate suite pass, including all Phase A-2 assertions.
  The stock-lot audit also passes. Documented that acceptance gates must use
  the restricted local role rather than the database owner, whose RLS bypass
  would make cross-tenant probes invalid.
- Hardened `preflight:production`: a deployment `DATABASE_URL` must now be a
  PostgreSQL URL using the dedicated `kb_app` runtime role. Verified both the
  accepted `kb_app` case and rejection of a `postgres` owner URL without
  exposing any credential value.
- Formalized the Petpooja Get Orders adapter contract in
  `docs/petpooja-contract.md`. The adapter now rejects a successful-looking
  JSON response without `order_json` before normalization; the Phase A smoke
  proves both the accepted envelope and the fail-closed shape error. Live
  provider-account verification remains external.
- Strengthened the dedicated Petpooja sales smoke to choose an unused month
  and unique item IDs on every run, preserving append-only evidence without
  cleanup. That repeat run exposed and fixed a real picker defect: active
  dishes can no longer be selected when their department is inactive, which
  would otherwise hide mapped sales from the active department cost view.
- Moved `smoke:sales` from `KB_LIVE_TENANT` to the explicitly required
  `KB_PROBE_TENANT`, adapted its fixture to provision a dish when needed, and
  added it to `npm run gates`. The full POS fetch/mapping/re-fetch smoke now
  cannot target the production tenant by configuration convention.
- Final consolidated gate run completed through the new probe-only sales
  smoke: TypeScript, lint, migration/reference/safety audits, schema and RLS
  checks, role matrix, Phase A, purchase-batch atomicity, all Phase A-2
  assertions, and the full sales/Petpooja workflow all passed.
- Added a shared `smoke-context` guard and wrapped the legacy write-capable
  phase smokes so they require `KB_PROBE_TENANT` and reject a probe equal to
  `KB_LIVE_TENANT`. Their old canonical-fixture assumptions remain explicit;
  they are supplementary and are not promoted into the maintained release
  gate until those fixtures are rebuilt, rather than weakening their checks.
- Added `audit:deployment` to protect the checked-in Vercel deployment
  contract: Mumbai `bom1` and the hourly `/api/cron/pos-sync` declaration must
  remain present, and the audit now runs as part of `npm run gates`.
- Re-ran the complete gates with the deployment audit included. The restricted
  local run passed migration/reference/safety/deployment audits, schema and
  RLS checks, role matrix, Phase A, purchase-batch atomicity, Phase A-2, and
  probe-only Petpooja sales smoke.
- Extended the same probe-only guard to the three group smokes and changed
  their direct tenant read to `tsql`. All write-capable supplementary smoke
  entry points now require an explicit disposable probe and reject a probe
  equal to the live tenant before any application action can run.
- Moved the purchase-batch smoke from `KB_LIVE_TENANT` to the shared
  probe-context guard as well. Its rollback probe now cannot write its test
  bills to a production tenant, and the consolidated gate uses the same
  protected path.
- Re-ran the complete gate chain after the smoke-safety changes. Migration,
  deployment, schema, strict-tenancy, matrix, Phase A, purchase-batch,
  Phase A-2, and probe-only sales/Petpooja checks all passed.
- Audited the environment contract: all deployed runtime variables are
  documented in `.env.example`, the removed `KB_TENANT` mechanism is not read
  by the application, and the deployment preflight continues to enforce the
  production-only secret/demo/TLS rules. No live environment value was
  printed or modified.
- Added `docs/production-approval.md`, a blank evidence-and-signature record
  for the irreversible rollout. It names the live checks and owners required
  before the release can change from `NOT APPROVED`; no approval is implied by
  the local gate results.
- Hardened the production preflight to reject malformed `KB_MEMBERSHIPS`
  values instead of silently disabling restaurant switching on a typo. The
  check is configuration-only and changes no live state.
- Verified the new preflight boundary: a synthetic `KB_MEMBERSHIPS=maybe`
  environment fails, while synthetic `KB_MEMBERSHIPS=true` with TLS, dedicated
  `kb_app`, non-demo mode, server secrets, and private storage passes.
- Re-ran `npm run gates` on the current worktree against the disposable
  restricted `kb_test` role. The current run passed all migration, deployment,
  schema, forced-RLS/tenant-key, role-matrix, Phase A, purchase-batch,
  Phase A-2, and sales/Petpooja assertions; no live tenant was written.
- Rechecked the shared Supabase database with `npm run audit:schema` in
  read-only mode. It still fails on migration-backed columns such as
  accounting mappings, attachment lifecycle, production variance, payroll
  policy, and purchase approvals. No schema, row, credential, storage, POS,
  or provider state was changed.
- Started a self-hosted deployment on the authorized `mushaf-server`
  (`100.64.33.51`) without creating a new Docker container. The app runs as
  the `sccm` user under `systemd --user` on loopback port 3120; its isolated
  `kitchenbooks` database is hosted in the existing PostgreSQL 16 cluster, and
  the app uses a dedicated `kb_app` role through a loopback TLS proxy.
- Loaded the sanitized schema and replayed all 36 migrations into the
  isolated database. Created only the compatibility roles required by the
  migration grants (`anon`, `authenticated`, `service_role`) and did not
  restart or modify existing application containers.
- Fixed the first deployment ACL issue by applying the local acceptance
  role's exact grants to `kb_app`; broad unrestricted table access was not
  granted. The server now passes `audit:schema` and
  `audit:tenancy -- --strict`.
- Generated a server-side owner account for the hosted demo restaurant
  (`sunny`) and stored its credentials in the server-only credentials file.
  Local route probes pass: `/login` 200, protected `/owner` 307, and the POS
  cron endpoint returns 401 without its secret.
- Added the Cloudflare Tunnel public hostname route `kb.etdemo.in` to the
  existing tunnel, targeting `http://localhost:3120`. HTTPS now reaches the
  app and redirects `/` to `/login`; no DNS A/AAAA record or existing tunnel
  route was changed.
- Diagnosed the first hosted post-login 500. The membership session lookup was
  requesting identity columns that its narrow membership function does not
  return, and the first business-day render could run without an explicit
  tenant context. Fixed both paths without weakening RLS: identity now uses
  the narrow account and membership definer functions, while business-day
  rendering verifies the signed tenant claim before opening its transaction.
  TypeScript and lint pass; the rebuilt hosted app returns HTTP 200 for the
  authenticated `/owner` dashboard with no new server errors.
- Created a separate hosted acceptance-probe restaurant through the protected
  provisioning endpoint and kept its tenant id server-side. The hosted owner
  tenant remains separate from write-capable acceptance work. Re-ran the live
  deployment, schema, strict-tenancy, and stock-lot gates: all pass. The only
  current self-hosted preflight failure is the intentionally missing private
  Blob credential; Petpooja/WhatsApp provider credentials also remain external
  rollout dependencies.
- Added a self-hosted private filesystem attachment backend as the temporary
  storage provider. It accepts only an absolute server directory, constrains
  keys beneath that directory, writes files with mode 0600, and preserves the
  existing authenticated attachment route and database records. The server
  directory is mode 0700; production preflight now passes with this backend.
  R2/Blob can replace it later at the single storage boundary.
- Ran hosted acceptance probes after the storage deployment: owner, kitchen,
  store, sales, staff, accounts, user setup, and recurring-register routes all
  returned HTTP 200 over Cloudflare HTTPS; both systemd services remained
  active and no new application errors were logged.
- The final irreversible approval was deliberately not self-signed. Technical
  acceptance evidence is now recorded, but real owner/accountant signoff and
  real Petpooja/WhatsApp credentials remain external approvals or dependencies.
- Replaced the self-hosted attachment blocker with the temporary local private
  filesystem provider and updated the storage decision/preflight contract.
  Production preflight passes with `KB_FILE_STORAGE_DIR`; the adapter enforces
  absolute-root keys, mode-0700 storage, mode-0600 objects, and the same
  authenticated read route used by Blob.
- Seeded the isolated acceptance probe with a chart of accounts, posting
  mappings, categories, units, vendor, items, purchase stock, and lot records.
  The real server modules then passed the purchase-batch atomicity smoke and
  the full Petpooja-shaped sales workflow: date filtering, status handling,
  idempotent re-fetch, mapping, section costing, and quantity-sold checks.
- The dashboard smoke exposed an outdated test assumption that all 16
  organizational sections are issue destinations; the current product code
  correctly exposes only `receives_stock` sections (12 for the provisioned
  defaults). No production behavior was weakened to make that stale assertion
  pass. The probe retains only its isolated acceptance evidence.
- Updated the dashboard and store smoke assertions to follow those actual
  invariants: lot-tracked stock rejects an over-issue before a negative lot
  balance, and only receiving sections are issue destinations. TypeScript and
  lint pass; hosted probe acceptance now passes purchase-batch, sales,
  store, and dashboard/business-day smokes.
- Replaced the authenticated-only root with a public production landing page
  describing the complete KitchenBooks feature set: purchasing, inventory,
  recipes, kitchen production, POS/sales, cash close, accounting, payroll,
  owner controls, evidence, imports, SOPs, localization, roles and tenant
  accountability. The existing signed-in root still routes each role to its
  correct dashboard. TypeScript, lint and the production build pass; public
  `/` returns 200 and an authenticated owner is redirected to `/owner`.
