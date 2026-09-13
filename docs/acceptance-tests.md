# Cross-feature acceptance tests

## Reproducible local run

Use a disposable local PostgreSQL database with the complete migration set
already applied. Provision the base restaurant, sections, items, vendors,
locations, and `kb_test` grants first; then load the fixture below as the local
database owner. It is deliberately never suitable for Supabase or production:

```bash
psql -v ON_ERROR_STOP=1 -f scripts/fixtures/acceptance-data.sql "$LOCAL_DATABASE_URL"
DATABASE_URL="$LOCAL_DATABASE_URL" KB_DB_SSL=disable \
  KB_LIVE_TENANT=<fixture-restaurant-id> \
  KB_PROBE_TENANT=<different-fixture-restaurant-id> npm run gates
DATABASE_URL="$LOCAL_DATABASE_URL" KB_DB_SSL=disable \
  KB_LIVE_TENANT=<fixture-restaurant-id> npm run audit:stock-lots
```

The database URL used for these commands must resolve to the restricted
application role (the local fixture uses `kb_test`, not the database owner).
Running as an owner can bypass RLS and make tenant probes meaningless; owner
access is reserved for loading the disposable fixture and replaying migrations.
The consolidated gate and `smoke:sales` write only to `KB_PROBE_TENANT`; the
live tenant is used for non-mutation checks and is never a write target.

The fixture supplies historical purchasing, recipe, POS-time, and legacy-lot
evidence so the read-side gates do not pass vacuously. The suite still reports
an individual `UNTESTED` notice whenever the fixture cannot distinguish a
scenario; those notices are not converted into green assertions.

These are product-level gates. A workstream is not complete when its screens
exist; the relevant scenarios must pass against a realistic tenant dataset.
The older phase-specific `smoke:*` scripts are supplementary historical
scenarios and may require their own canonical fixture (for example, an empty
roster or the original 16-department seed). They must be run only with
`KB_PROBE_TENANT`; the maintained release gate is the consolidated suite above.

## Tenant and identity

- A user can belong to two restaurants and has a different role in each.
- Switching restaurants changes every visible and server-returned record.
- Direct requests cannot access the other restaurant's records.
- Invitation, password recovery, password change, retirement, and session
  invalidation work without changing unrelated users' credentials.
- An owner can create a time-limited invitation for a new username and role;
  the link is one-use, stores only a token digest, lets the invitee choose the
  password, and cannot be used to join a different restaurant.

## Financial integrity

- Closing a period blocks edits and deletes to financial records.
- A journal entry cannot be posted unless it has at least two lines, names
  active accounts from the same restaurant, and total debits equal total
  credits to two decimal places.
- A journal entry dated inside a currently closed period is refused by the
  database, even if the caller bypasses the UI.
- Journal entries and lines are append-only for the application role, and the
  source record is unique-linked so a retry cannot post it twice.
- The chart of accounts is restaurant-owned and is never silently seeded with
  country-specific tax or banking assumptions.
- An accountant can configure the supported posting concepts to active ledger
  accounts, and a missing mapping is visible as “not mapped” rather than
  defaulting to the first account.
- A correction creates an auditable reversal/replacement chain.
- A vendor payment and its journal entry commit together; if the payable or
  selected money-account mapping is missing or has the wrong account type,
  neither row is committed.
- Other income and each cash voucher commit with a matching journal entry;
  voucher purpose selects the explicitly mapped expense account, and
  owner-funded vouchers credit owner payable rather than pretending cash left
  the drawer.
- A new purchase posts inventory/input tax against vendor payable in the same
  transaction, and voiding it creates a flipped journal reversal using the
  original lines exactly.
- Marking an approved payroll run paid posts gross wages, net cash, advance
  recovery, deductions, and withholding liabilities as one balanced journal
  entry; missing mappings leave the run approved and unpaid.
- A successful POS fetch posts one balanced entry split by payment-mode
  settlement account and sales revenue. Re-fetching the same business date
  reverses every superseded fetch journal once before posting the new one, so
  the trial balance reflects only the latest POS generation.
- Each restaurant can store its own Petpooja credentials; they are encrypted
  at rest, only owners can replace them, and no credential value is returned
  to the browser or logged in a sync result.
- The scheduled POS endpoint requires its own cron secret, discovers only
  tenants with configured credentials, runs each tenant in its own RLS
  context, and records success/failure per tenant without exposing secrets.
- No server action or client bundle can invoke a function that returns
  decrypted POS credentials; credential reads are server-only.
- Repeated imports or POS syncs do not duplicate business events.
- Totals reconcile from source transaction through ledger/report.
- A POS statement difference can be acknowledged or marked correction-requested
  with a required note by an authorized sales/accounts role; the review is
  tenant-scoped and neither the provider statement nor KitchenBooks sales are
  overwritten.

- P&L reads only posted journal lines in the selected date range and presents
  revenue and expense accounts with their correct normal balance.
- Balance sheet reads cumulative posted journal lines through the selected end
  date and presents assets, liabilities, and equity with their correct normal
  balance.
- Cash-flow view reads only money accounts explicitly mapped to ledger asset
  accounts, shows direct inflow/outflow rows for the selected period, and does
  not infer or fabricate movements for unmapped accounts.
- Cash-flow also exposes an indirect bridge of period net profit plus changes
  in non-cash working-capital assets and liabilities; mapped cash/bank/wallet
  accounts are excluded so direct and indirect views are not double-counted.

## Operational loop

- A store user can record a vendor quotation with dated, itemized rates;
  quotation evidence does not create stock or payable entries, and a manager
  or owner can record an explicit decision.
- An accepted, unexpired quotation can create a draft PO with the quoted vendor,
  quantities, and rates; sending and any configured approval still happen only
  through the normal PO workflow.
- An approved or paid payroll run exposes a payslip statement derived from its
  frozen lines; the statement shows earnings, deductions, withholding, net pay,
  period, employee, and paid status without recalculating payroll.
- A payroll draft uses the latest salary structure effective on or before the
  selected period end; a later structure does not alter an already-prepared or
  paid run.
- An accountant or owner can export a payroll run as CSV, scoped to that
  restaurant and run, with recorded values only; the export does not calculate
  or file statutory amounts.
- That export includes the recorded employee PAN/UAN/PF/ESIC identifiers for
  filing preparation, leaves missing identifiers blank, and never derives a
  statutory number from them.
- A paid holiday in the restaurant calendar contributes one paid day to an
  unmarked employee in a payroll draft; an explicit attendance mark wins, and
  an unpaid holiday contributes none.
- An accountant or owner can record an effective-dated statutory configuration
  with optional PF/ESI percentages, wage caps, jurisdiction, TDS regime, and
  source note; malformed or out-of-range values are rejected before writing.
- Statutory configuration is tenant-scoped and retained as history. It is not
  silently applied to frozen payroll lines. The export may calculate clearly
  labelled PF/ESI contribution amounts from the selected configuration without
  changing the run.
- Payroll export includes the effective statutory configuration as filing
  preparation context, selected by the run period end; configured PF/ESI
  amounts are separate from the frozen net-pay calculation.
- Payroll export calculates PF/ESI employee and employer amounts only from the
  effective accountant-entered percentages and optional wage caps; absent
  inputs calculate zero rather than using a jurisdiction default. TDS remains
  explicitly labelled as frozen payroll withholding until a reviewed tax
  calculation contract is supplied.
- A manager or owner can create a tenant-scoped leave policy and assign an
  active policy to an active staff member from an effective date. Payroll
  credits marked leave only up to that policy's paid-day allowance; an
  unassigned leave remains unpaid and the assignment history remains visible.
- A manager or owner can record a dated leave request, approve or reject it,
  and see its decision state. Approval writes leave attendance for each day;
  approval is refused when any requested day is already marked present or
  half-day, overlapping pending/approved requests are refused, and the
  request/approval cannot exceed the assigned annual allowance. Requests stay
  within one calendar year; the screen shows base allowance, carried days,
  approved days, and remaining days for that year.
- An accountant or owner can record the reviewed prior-year carry-forward for
  an active staff member. The value cannot exceed the unused source-year
  allowance, is stored as one immutable year-to-year ledger entry, and is used
  by future balances and approval checks instead of silently recomputing it.
- A recorded carry-forward is labelled as recorded in the balance view; an
  unrecorded value is labelled as suggested, so a calculated estimate cannot
  masquerade as year-end evidence.
- A manager or owner can import a staff CSV using the exact documented header;
  malformed rows, unknown sections, invalid employment/pay modes, and bad
  dates or amounts reject the complete file before any staff row is written.
- Staff import preview validates the complete file, reports the row count,
  sections, and proposed next employee codes, and writes nothing; the explicit
  commit action reruns validation under the roster lock and inserts the batch
  atomically.
- A valid staff import writes one tenant-scoped atomic batch, assigns the next
  permanent `E###` codes under the roster lock, and excludes bank/statutory
  identifiers from the import contract.

- A store, manager, or owner can import vendors using the exact documented
  header; unknown categories, duplicate names, malformed fields, and existing
  vendors reject the complete file before any vendor is written. Valid rows
  receive sequential category-specific vendor codes in one tenant-scoped
  transaction.
- Vendor import preview performs those checks without writing, reports the row
  count and proposed codes, and requires an explicit commit that revalidates
  under the roster lock.
- A store, manager, or owner can import items using the exact documented
  header; unknown categories, units, locations, duplicate names, and invalid
  rates or flags reject the complete file before any item is written. Valid
  rows receive sequential category-specific item codes and default conversion
  factors in one tenant-scoped transaction.
- Item import preview performs those checks without writing, reports the row
  count and proposed codes, and requires an explicit commit that revalidates
  under the roster lock.
- An authorized sales/accounts user can import a single-date sales CSV using
  the documented header; duplicate order IDs, invalid dates or amounts, mixed
  dates, and future dates reject it before writing. A valid import uses the
  same immutable POS fetch, latest-generation, status-classification, and
  mapped journal path as Petpooja.
- Sales import preview performs the complete validation without creating a POS
  generation; explicit commit reparses and then uses the immutable persistence
  and journal path.
- An accountant or owner can import one-period payroll CSV using the exact
  documented header; duplicate or unknown staff codes, mixed periods, invalid
  days, and malformed money reject the complete file before the normal frozen
  payroll prepare transaction runs. The result is a draft and cannot bypass
  owner approval.
- Payroll import preview performs complete validation and same-restaurant staff
  resolution without creating a draft; explicit commit reruns validation and
  then calls the normal frozen payroll preparation workflow.
- An accountant or owner can import chart accounts using the exact documented
  header; duplicate codes, invalid names, and unsupported account types reject
  the complete file before any account is written. A valid import is atomic,
  tenant-scoped, and does not create posting mappings or opening balances.
- Chart-account import preview performs those checks without writing, reports
  the row count, and requires an explicit commit that revalidates under the
  restaurant lock.
- An accountant or owner can import one-date opening balances using the exact
  documented header; unknown accounts, invalid rows, mixed dates, and an
  unbalanced file reject before writing. A valid file creates one immutable
  tenant-scoped evidence batch and one balanced journal entry; no balancing
  account is guessed and a closed period remains locked.
- Opening-balance preview performs the full validation, balance check, and
  active-account resolution without creating evidence or journal rows; explicit
  commit revalidates before posting the immutable batch.
- A store user, manager, or owner can import one purchase bill using the exact
  documented purchase header; every row must resolve to an active vendor and
  active item in the current restaurant, and mixed bill metadata or malformed
  values reject the complete file. A valid file delegates to the normal bill
  transaction so stock, vendor dues, tax, and journal effects are recorded
  together; historical multi-bill loads remain a separately reconciled import.

- A purchase order below the restaurant's configured approval threshold can be
  sent by an authorized purchaser and becomes immutable.
- A purchase order at or above the threshold cannot be sent directly; it
  creates one pending approval containing an immutable amount snapshot, and
  edits are blocked while it is pending.
- Only an owner can approve or refuse the order. Approval freezes and records
  the sender; refusal leaves the order editable and records the decision.
- A purchase receipt increases stock at the selected location.
- Each received purchase creates one append-only invoice assessment. A bill
  without a PO is explicitly `unmatched`; a PO bill is `matched` only when all
  ordered quantities and rates reconcile, `partial` while quantities remain,
  and `exception` for over-delivery, an unlisted item, or a rate difference.
  The assessment retains the compared line snapshot and never edits the bill.
- An opening-stock CSV rejects malformed quantities, duplicate codes, and
  unknown or inactive items before writing anything; valid rows become one
  append-only adjustment batch and obey the configured owner-approval rule.
- Opening-stock preview resolves every active item, reports the row count and
  whether owner approval will apply, and writes nothing; explicit commit then
  revalidates through the normal adjustment approval path.
- A stock transfer requires active, different source and destination
  locations, requires each item to be recorded at the source with its full
  available quantity, writes an immutable transfer event, and changes the
  item’s recorded location without changing total stock or value.
- A recurring template requires balanced lines and valid dates; posting a
  period creates one journal entry, and repeating the same template/period is
  refused by a unique idempotency key.
- An accrual requires an expense account, liability account, positive amount,
  and valid dates; posting creates one balanced journal entry, and its stated
  reversal can be posted only once through the same idempotent boundary.
- A fixed asset requires explicit asset, depreciation-expense, and accumulated-
  depreciation accounts, a positive cost, useful life, and valid dates; each
  period’s straight-line depreciation is capped at depreciable cost and can be
  posted only once.
- A POS statement import offers a write-free preview of the complete file,
  requires an explicit import after that preview, and clears the preview when
  the CSV is edited. The commit validates again, retains the statement as
  immutable tenant evidence, and compares the latest imported statement per
  day with the latest revenue sales generation without changing POS rows
  automatically.
- A fixed asset requires explicit asset, depreciation-expense, and accumulated-
  depreciation accounts, a positive cost, useful life, and valid dates; each
  period’s straight-line depreciation is capped at depreciable cost and can be
  posted only once.
- When standalone adjustment approval is enabled, a store correction creates
  a frozen pending request and does not change stock until an owner approves;
  refusal changes no stock and records the reason.
- A recipe production run consumes inputs and records output, yield, and waste.
- Editing a recipe creates a new immutable version with an effective timestamp;
  historical production remains readable against the version that was used.
- A production entry selects the recipe version effective on its production
  date and stores that version reference immutably; later recipe edits do not
  change the version shown on the production record. Existing records are
  backfilled only to available recorded history.
- A production entry captures the recipe’s expected-output snapshot and the
  chef’s measured waste quantity; a reversal negates the measured quantities
  while preserving the expected snapshot, and the production list exposes the
  frozen values for later variance review.
- After the lot migration, a new receipt creates a tenant-scoped lot with its
  expiry, received date, cost, and location; an issue allocates earliest-expiry
  lots first, records signed immutable movements, and an issue reversal restores
  the exact lot quantities. Existing aggregate stock appears only as a clearly
  labelled legacy lot.
- Stock on hand exposes current positive lot balances in earliest-expiry order,
  including lot code, location, and expiry or an explicit legacy/no-expiry label.
- An item without a shelf assignment still issues and records FEFO movements
  against its unplaced lot; transfers remain unavailable until a source
  location is known.
- A vendor return linked to a receipt reduces that receipt lot, refuses a return
  beyond its available lot balance, and its reversal restores the exact lot
  movement.
- Voiding a purchase bill writes a signed movement against each receipt lot so
  its lot balance follows the same reversal as aggregate stock.
- A partial or whole-item transfer records signed source and destination
  movements for the affected lots; the lot readout shows split balances while
  total quantity/value remains unchanged.
- The production page summarizes expected versus made-plus-waste quantities for
  the current month, excluding voided filings and keeping recipes separate.
- Production output is not duplicated into store-item lot stock: kitchen
  closings remain the reader of produced dishes/sub-recipes, while purchased
  items remain the lot-controlled inventory ledger.
- A manager or owner can acknowledge a monthly production variance or request
  a correction with a required note; the review is tenant-scoped and updating
  it never edits or deletes the original production filing.
- A requested production correction is executed by voiding the original entry
  through its immutable negative twin and recording a replacement through the
  normal production form; the frozen unit cost is copied into the reversal and
  the original remains visible as voided.
- The production screen shows mapped POS dish portions as prep demand when the
  owner policy is `reconcile`; when the policy is `none`, it explicitly hides
  POS-derived demand. The list is labelled as planning signal only and never
  creates a stock movement.
- A chef, manager, or owner can attach an active substitute item to an
  ingredient line with a positive quantity ratio and optional usage note; a
  sub-recipe line cannot receive an item substitution, duplicates are refused,
  and the substitution is included in the next immutable recipe version.
- POS sales follow the owner-configured stock policy: `none` leaves stock
  untouched and hides POS-derived kitchen quantities, while `reconcile` shows
  mapped POS recipe quantities in the kitchen/recipe views. Neither policy
  silently mutates the lot ledger; store issues remain the stock source of
  truth.
- Cashier close produces an exception when expected and actual cash differ.
- After saving a meter reading, an authorized user can attach an optional
  private evidence photo to that immutable reading; the reading remains saved
  if upload fails, and the photo is readable only through the authenticated
  tenant-scoped attachment route.
- A manager or owner can archive bill or meter evidence with an optional
  retention date; no file is deleted, archived evidence remains readable for
  audit, and cashier/store roles cannot see or invoke the archive control.
- Owner and accountant reports agree on the same closed business day.
- An accountant or owner can export a provider-neutral withholding CSV for a
  date range. It contains the entered amount, payment base, customer regime
  code, derived display rate, deposit/challan status, and note; it does not
  invent a statutory rate or claim to submit a filing.
- Purchase CSV preview validates the complete file, resolves active vendor and item
  codes, reports the bill summary, and writes nothing; the explicit import action
  then creates exactly one bill through the normal posting path. Editing the CSV
  clears the preview and requires validation again.
- Historical purchase batch preview groups repeated bill metadata by the source
  `bill_no`, rejects missing or duplicate references and unresolved masters, and
  writes nothing. Its explicit commit preserves the source bill number while
  allocating KitchenBooks `doc_no` values and commits every bill through the
  normal stock, lot, dues, tax, and journal path in one transaction; any failure
  rolls back the whole batch.

- `/sops/<role>` opens the current role’s written operating guide; owners may
  open any role guide, while other roles are redirected to their own guide.
- Every SOP moment links to a registered application route and remains behind
  the same role access boundary as the destination.
- SOP pages print without application chrome and state that live field/refusal
  details remain on the linked screen.
- The signed-in shell exposes a `Your day` link to the current user’s guide.
