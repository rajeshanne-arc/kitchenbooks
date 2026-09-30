# KitchenBooks product specification

Status: approved working specification, 2026-09-13

## Ground rule #1

Continue the KitchenBooks implementation end to end until the approved
production feature set is complete. Do not pause for routine decisions or
provide another partial analysis. Record context in the project documents,
implement each workstream, run its acceptance gates, and continue to the next
workstream. Stop only when a genuinely external dependency is required, such
as a missing production credential or an irreversible live-data approval.

KitchenBooks is an operating system for restaurants. It connects purchasing,
inventory, recipes, kitchen production, sales, staff/payroll, cash, and
accounting around one auditable business-day ledger.

## Product principles

- A person may belong to multiple restaurants and has a separate role in each.
- Restaurant data is tenant-isolated. A user can never read or mutate another
  restaurant's data through the application.
- Owner is the highest restaurant role. Platform administration is a separate
  control plane and is not a restaurant role.
- Financial history is append-only. Corrections are reversals or replacement
  entries, never silent edits.
- Every operational workflow must show its status, owner, next action, and
  exception state.
- The first production rollout must work end to end for one restaurant before
  consolidated multi-restaurant reporting is enabled.

## Approved scope

### Identity and tenancy

Support multiple restaurants from day one, multi-restaurant membership, an
external platform-admin role, invitations, password recovery, user retirement,
restaurant onboarding, and per-restaurant role assignment.

The existing six restaurant roles remain: owner, manager, chef, store, cashier,
and accountant.

### Purchasing and inventory

Support vendors, quotations, purchase orders, configurable approvals, partial
receipts, invoice matching, returns, vendor statements, stock locations,
transfers, batches/lots, expiry, reorder levels, valuation, stock counts,
adjustment approvals, and opening-balance imports. Barcode support is deferred
until after the first production rollout.

### Recipes and kitchen

Recipes require versioning with effective dates. Kitchen planning must compare
planned versus actual production, track yield and waste variance, support
substitutions, and expose prep lists and exception queues.

### Sales

Petpooja is the first POS integration. Provide manual entry, scheduled and
on-demand sync, idempotency, retry/status visibility, reconciliation, and
correction handling. Other POS systems must fit an adapter boundary.

### Accounting and compliance

Build toward complete double-entry accounting: chart of accounts, journals,
trial balance, profit and loss, balance sheet, cash flow, opening balances,
period closing/locking, reversals, recurring entries, accruals, fixed assets,
GST, TDS, and vendor statements.

### Payroll and people

Provide salary structures, attendance inputs, overtime, deductions, leave,
holidays, statutory calculations, payslips, payroll exports, and staff
self-service where appropriate.

### Documents and language

The first rollout supports bill photos, private attachments, WhatsApp links,
SOPs, English, Telugu staff flows, and CSV imports. Offline operation is a
later phase.

## Operating cadence

Business-day cutoff is configurable. Cashier closes daily; kitchen closes
nightly; store performs critical counts daily and full counts weekly; managers
review exceptions daily; accountants review weekly; owners review weekly.

## Release sequence

1. Foundation: tenancy, memberships, onboarding, identity recovery, and
   permission boundaries.
2. One-restaurant operational loop: purchasing → stock → recipe/kitchen → POS
   sales → cash → accounting.
3. Payroll, documents, SOPs, imports, and statutory workflows.
4. Multi-restaurant switching and consolidated reporting.
