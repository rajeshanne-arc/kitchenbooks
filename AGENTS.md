<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# KitchenBooks — rules for working in this repo

Purchase-bill bookkeeping for one restaurant (Thrayam). Supabase Postgres
project `xvnreydzveicnzmhkire`; the schema lives in the database — read it from
there (`supabase_migrations.schema_migrations` holds the DDL), never invent
columns.

Hard rules — these mirror database-level enforcement, do not soften them:

1. **DB access is server-side only** (server actions / route handlers via
   `src/lib/db.ts`, which is `server-only`). No Supabase key exists in this
   app; the one secret is `DATABASE_URL` (.env.local, never committed). The
   `kb_app` role it connects as has SELECT + INSERT only.
2. **Never UPDATE or DELETE events** (`purchases`, `purchase_lines`,
   `payments`). Corrections are reversal rows: negative values with
   `reverses_id` pointing at the original. The DB role physically cannot
   UPDATE/DELETE — don't add code that tries.
3. **Masters are born inline** in the bill flow (no vendor/item admin pages in
   this phase). Codes auto-assign inside the save transaction:
   vendors `V-<CAT>-NN`, items `<CAT>-NNN`, sequential per restaurant+category.
4. **Displayed derived numbers come from named views** (`vendor_dues.balance`,
   `item_rates.prefill_rate`) — never recompute them client-side. Post-save
   figures are read back from the DB, not echoed from input.

Money math: exact integers only (`src/lib/money.ts`) — paise for amounts,
milli-units for quantities, bigint 10⁻⁵₹ for line values; decimal strings in
and out of Postgres `numeric`. `amount`, `landed`, and `bill_total` are
GENERATED columns — always insert with explicit column lists.

Transport allocates pro-rata by line value at 2 dp, residual paise on the
largest line so shares always sum exactly (`allocateTransport`).

Testing: `npm run smoke` — end-to-end against the real DB; prints created ids
for manual cleanup (expects an events-empty DB for its code assertions).

The app must stay first-class with an empty database: zero vendors and zero
items is the normal starting state, not an error.

## Phase 2 — Books

Migration `books_views_and_master_edit_grants` added the `bills` and
`item_purchase_history` views (SELECT-granted) plus column-level UPDATE for
`kb_app` on exactly: vendors (name, gstin, phone, payment_terms, supplies,
status) and items (name, brand, gst_rate, yield_pct, par_level,
conversion_factor, stock_unit, opening_rate, status), and INSERT on payments.
Nothing else is updatable — vendor/item `code`, `category`, `purchase_unit`
are deliberately locked (shown in the UI as locked-with-reason, never hidden),
and events stay INSERT-only.

Corrections are VOIDs: one transaction inserting a reversal purchase
(negative goods/gst/transport, `reverses_id` set, bill_no = original +
`-VOID`, same bill_date so months cancel cleanly) plus negative-qty lines.
`bills.is_voided` / `is_reversal` drive the badges.

Retire, never delete: `status = 'inactive'` is the only removal path for
masters.

**Deliberately deferred — do not add casually:** gst_rate write-back on bill
save. The UPDATE grant exists, but the mechanic waits for per-line GST entry
(a future phase). Until then `items.gst_rate` is reference-only metadata
edited on the item page.

## Phase 3 — Store actions (consumption spine)

Migration `consumption_spine_sections_issues_wastage` added `sections`
(8 seeded, uuid ids, issues reference `section_id`), `issues` + `issue_lines`
(`value` GENERATED qty × unit_cost), `wastage` (flat, same value mechanics),
and views `item_costs` (issue_cost = weighted-average landed/qty over all
purchase lines, falling back to opening_rate), `stock_on_hand`, and
`section_consumption` (monthly). kb_app: INSERT on the three event tables;
sections column-UPDATE on name/sort_order/status only (no UI yet).

**The cost rule.** `unit_cost` on issue/wastage rows is snapshotted from
`item_costs.issue_cost` server-side at save, full precision. The store
manager never sees or types a cost — no rate field exists on those screens.
**Voids copy each original line's `unit_cost` EXACTLY** (SQL
`insert … select -qty, unit_cost`); never re-snapshot, or a rate change
between entry and void leaves a residue in section_consumption.

Issues/wastage typeahead over EXISTING items only — an issue cannot invent
an item; the empty state says "enter the bill first". Items with NULL
issue_cost are un-issuable until a bill exists.

Negative stock is shown loudly (red, "a bill is probably missing"), never
hidden or clamped.

**items.yield_pct is retired from the UI** (column stays, reserved): recipes
will state GROSS quantities (what is taken from the store, trim included), so
trim yield lives in the recipe quantities themselves; batch yield is a
sub-recipe's output quantity. Do not resurface an item-level yield field.

## Phase 4 — Recipes (gross quantities, live costing)

Migration `recipes_gross_quantities_live_costing` added `recipes` (kind
dish|sub; dish requires `section_id`; `selling_price` dish-only;
`output_qty`/`output_unit` — a sub's output IS its batch yield) and
`recipe_lines` (component_item_id XOR component_recipe_id, qty > 0), plus
views `recipe_costs` (recursive expansion, depth-capped at 12,
`uncosted_lines` honesty column) and `dish_costs` (section join,
`food_cost_pct`).

**Dish codes carry the section** — CH-001, TD-014 — the same seven codes as
issues and labour; that join is the product's spine. A dish is coded by
picking its section; the app assigns `<SECTION>-<next 3-digit per
restaurant+section>` in-transaction. Subs are `SUB-###`.

**Costs are LIVE, never stored.** recipe_costs/dish_costs read
item_costs.issue_cost at query time; a rate change on bills moves every
recipe cost with no re-cost step. Never cache or write a recipe cost.
Uncosted ingredients price at 0 with `uncosted_lines > 0` — UIs must show
the honesty message instead of a confident wrong number. Monthly dish-cost
snapshots (the photograph rule) are deliberately a LATER phase — do not add
snapshot tables casually.

**The gross rule, verbatim and load-bearing** (top of every lines editor):
"Enter what you take from the store, including what gets trimmed away."
If a chef writes net quantities, costs understate silently.

**The DELETE exception.** `recipe_lines` carries the system's only DELETE
grant: recipes are masters and lines are editable detail — removing an
ingredient from a card is normal chef editing, not history erasure. Nothing
else may ever gain DELETE.

**Cycle guard is server-side**: before inserting a sub component, walk the
component graph (recursive CTE) and refuse loops. The view's depth cap is
blast-radius control, not the guard.

## Phase 5 — Labour (org units, staff, attendance)

Migration `labour_org_units_staff_attendance`: `sections` is now the unified
org-unit table (16 units, `dept_group` ∈ Management|Support|Kitchen|Service|
Bar) — the same row that codes a dish and receives an issue now posts a
staff member. `staff` (code `E###` flat, zero-padded, PERMANENT — a move is
one field, never a new identity; column-granted edits, retire-never-delete),
`attendance` (INSERT-only event stream), views `attendance_current` (latest
row per staff per day wins — corrections are new rows, history never
hidden), `labour_cost_by_section` and `section_costs`.

**The pay law lives in the view, follow it, don't restate it in code:**
present = 1, half = 0.5, off = 1 (off is PAID — a stated assumption),
leave and absent = 0, divided by the real days of that month. Contract
staff are excluded entirely ("billed by their vendor"). `unassigned_marks`
and `unsalaried_marks` are honesty columns — surface them whenever
non-zero, same law as uncosted_lines.

**The roster order is computed, never stored**: dept_group in fixed order
(Management, Support, Kitchen, Service, Bar), then section sort_order, then
grade L1→L7, then name. Unassigned renders LAST and loud. Nothing is ever
renumbered.

**PIN gate** (`src/proxy.ts`): everything behind a shared PIN from env
`KB_PIN`, cookie per device, fail-closed. This is the MINIMUM DOOR, not the
auth phase — roles/login come later.

**Deliberately excluded this phase — do not add casually:** payroll runs,
advances, and salary payments (unproven in the sheets; money movement waits
for real auth), and aadhaar/pan/bank columns (no such columns exist until
real auth — the form must not collect what the DB refuses; say "ID and bank
details arrive with the login phase").

**Staff import: build nothing.** The corrected staff master lives in
Rajesh's Labour sheet and supersedes every earlier extract — never seed
staff from any file in the repo or a transcript; import arrives when Rajesh
provides the corrected master.
