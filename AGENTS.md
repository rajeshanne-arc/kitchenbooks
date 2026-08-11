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

## Phase 6 — Sales (the Petpooja mirror)

Migration `sales_cash_counts_snapshots` (also phases 7–8): `pos_fetches`,
`pos_orders`, `pos_lines`, `pos_item_map`, views `latest_fetches`,
`sales_current`, `sales_by_day`, `sales_by_section`, `unmapped_pos_items`,
and `section_costs` regained sales + margin.

**Credentials are env vars in Vercel, names exactly:** `PP_APP_KEY`,
`PP_APP_SECRET`, `PP_ACCESS_TOKEN`, `PP_REST_ID` (Sensitive — write-only).
Values come from Rajesh directly into Vercel, NEVER through chat or the
repo; local dev has none, so the adapter (`src/server/petpooja.ts`, endpoint
`/V1/thirdparty/generic_get_orders/`) refuses loudly and smoke uses fixture
payloads.

Hard-won API facts, each from a real bug — do not relearn them:
- Get Orders returns TWO days (D and D-1). Filter on `order_date ==
  business_date`. Never assume T+1.
- Order IDs restart daily: every key is (business_date, pos_order_id);
  duplicate ids within one payload are skipped and counted on the fetch.
- **STATUS IS A WHITELIST:** 'Success' → revenue; 'Cancelled' → cancelled;
  'Complimentary' → complimentary; ANYTHING ELSE → unknown — surfaced
  loudly, never banked. C-prefixed order ids are a secondary comp signal;
  status wins, every disagreement is logged in pos_fetches.note.
- Comps: out of the money, IN orders and covers — already encoded in
  sales_by_day; never re-derive client-side.

A fetch is an EVENT: one pos_fetches row + orders + lines in one
transaction; a re-fetch is a NEW fetch and the latest wins
(latest_fetches) — nothing is ever edited. Mapping points a POS item at a
DISH (the dish carries the section); pos_item_map upsert rides the only
UPDATE grants (recipe_id, item_name). The mapping queue is ordered by
revenue desc — the top rows are half the money.

## Phase 7 — Cash (the cashier's close)

Tables `cash_vouchers`, `other_income`, `day_closes` (INSERT-only), views
`day_close_current` (latest filing per date wins, corrected marker),
`day_close_ladder`, `owners_owed`; `settings` key `first_opening_cash`.

**PAID BY is load-bearing:** owner-funded vouchers NEVER touch the drawer
math — day_close_ladder already filters `paid_by = 'cashier'`; do not
re-add them in code. Owner money opens a debt in owners_owed; the
reimbursement is itself a cashier voucher, category `owner_reimbursement`
— one log, netted, lands on that day's ladder for free. An owner-paid
reimbursement is refused as nonsense. Owner names come from pickers
(prior entries + optional settings `owner_names` CSV) — free text breaks
the netting on "Asheel" vs "Asheel Sir".

Other income: a quantity requires its unit (oil is litres — FSSAI expects
the reconciliation).

**Day close:** the cashier types ONLY extra-in, handed-over (+ to whom),
counted cash and the bank block. Opening is resolved server-side and
photographed into the row at save: previous day's COUNTED cash
(day_close_current), first day from `first_opening_cash` (Set Opening is
one-time — refuses once any close exists). **HARD STOP:** date D refuses
to save while D-1 has no close — the error names the missing date. A
shortage belongs to the day it happened. Re-filing inserts a new row that
wins; difference is red whenever non-zero.

## Phase 8 — Counts + snapshots (the photograph rule)

Tables `stock_counts`, `stock_count_lines` (book_qty + unit_cost FROZEN
server-side inside the save transaction from stock_on_hand / item_costs;
variance_qty/value are GENERATED — insert with explicit column lists),
`dish_cost_snapshots`; view `count_variances`.

Counts are blind (book qty hidden until save) and counted 0 is a real
count. Variances read the STORED generated columns, worst shortage first,
negative loud. A count never moves stock. **The first-count warning is
COMPUTED, never asserted:** days = today − first live (non-voided) issue
date + 1; under 14 → banner "book stock has only N days of consumption
behind it; variance will mostly measure missing bills, not theft" — warn,
never block.

**Photograph the menu each month-end** (button on Recipes): copies today's
dish_costs verbatim into dish_cost_snapshots, one photograph per day —
live costs rewrite history, photographs don't.

## Phase 9 — Kitchen truth (closings, wastage, food cost)

Migration `kitchen_truth_and_identities` (also phase 10): `kitchen_closings`
+ `kitchen_closing_current`, `kitchen_wastage`, views `section_food_cost`
and `missing_closes`, table `app_users`.

**Closing is VALUE per section, never item quantities** — onions became
gravy; value survives transformation, quantity does not. Latest row per
(section, date) wins; a correction is a re-file wearing the corrected
marker. Zero is a real closing. Closable sections = dept_group Kitchen +
Bar. Kitchen wastage: the rupee VALUE is required and chef-stated; item +
qty are optional detail, always as a pair; voids are negative twins
copying value and qty exactly.

**The pending-closing law lives in the view — never fill it in code:**
section_food_cost states consumed_total (opening + issued − closing) ONLY
when the month has an ending closing, and food_cost_pct only when mapped
sales exist. Before that the UI says "pending closing" / "no sales", never
a confident wrong number.

## Phase 10 — Identities & roles (the PIN era is over)

`app_users`: roles owner|manager|chef|store|cashier, bcrypt password_hash,
column-granted updates, retire-never-delete (no DELETE grant). Sessions:
signed httpOnly cookie, 30 days, HMAC over `KB_SESSION_SECRET` (32 random
bytes; set in Vercel + .env.local; NEVER printed anywhere). The proxy
(src/proxy.ts) enforces the ROLE MATRIX in `src/lib/roles.ts` — fail
closed, unknown paths deny for everyone; actions re-check the DB via
getSessionUser, so retiring or re-roling a user bites on their next
action, not next month. A denied route names who to ask.

Matrix (managers get everything below owner; owners also get Users +
snapshots): store = bill/issues/wastage/counts + Books bills/stock/
vendors/items; chef = kitchen/recipes + Books stock/sections/food-cost;
cashier = cash + Books sales/cash; attendance = manager+owner only.

**Bootstrap**: /setup creates the FIRST owner exactly once, gated by the
bootstrap code — the current KB_PIN env value, typed by Rajesh at the
screen, never through chat. After the first login works, DELETE KB_PIN
from Vercel; /setup refuses forever once any user exists, and the last
active owner can be neither retired nor demoted. `entered_by` on all
eleven event tables is the session username; voids stamp the voider.
Login errors stay generic and cost a small delay.

## Phases 12–14 — Role groups, lists, tabs (migration
`groups_indents_production_lists_pnl`)

**THREE GLOBAL LAWS, enforced everywhere:**

1. **STRICT INVISIBILITY.** A role never SEES a link it cannot open — nav,
   home tiles, Books tabs, group tab strips, quick links. The matrix
   (`src/lib/roles.ts`) is the single source; every surface filters through
   `canAccess`. Deep links stay server-denied naming who to ask. Books tabs
   per role: chef = recipes/stock/sections/food-cost; cashier = sales/cash;
   store = bills/store log/stock/counts/vendors/items; manager/owner = all.
   Chef LOST /books/store, /books/issues, /books/wastage. `/kitchen/indent`
   admits store (the gap page is theirs too); `/pnl` is owner-only, beside
   Users and snapshots.
2. **LISTS, NOT FREE TEXT.** Categorical fields read `list_options` (7 keys:
   waste_reason, voucher_category, payment_mode, other_income_item, partner,
   non_revenue_reason, expense_category) via `getList`. NEW modules
   (settlements, off-book, non-revenue, expenses) enforce membership
   server-side; the error points at Settings → Lists. Lists screen
   (/settings, manager+owner): add, reorder, retire — NEVER delete; grants
   are INSERT + UPDATE(value, sort_order, status), exactly. Person fields
   (handed_to, paid_to, buyers, due parties, payees, given_to) are
   picker-from-history (`getNameHistory`) + add-new.
3. **TABBED ENTRY.** Each role group is a tab strip (`GroupTabs` →
   `tabsFor`): kitchen, cashier, store, staff. ORDER and LABELS come from
   settings key `tabs.<group>` (JSON `[{key,label}]`), edited in /settings;
   `src/lib/tabs.ts` holds the defaults and is the KEY REGISTRY — a setting
   can never invent a route, drop a tab, or survive malformed (falls back
   wholesale). Tab strips are matrix-filtered too (LAW 1).

**Phase 12 — kitchen group** (Dashboard | Recipes | Indent | Production |
Wastage | Closing): `indents`+`indent_lines` record what was ASKED; the
issue records what was GIVEN; saveIssue takes `indentId`, stamps
`issues.indent_id`, flips status open→issued (section mismatch refused by
name; issued/cancelled indents refuse further stamps; reversal issues do
NOT carry the stamp, so the gap query ignores voids). The asked-vs-given
GAP on /kitchen/indent/[id] is the point — never hide it. Store side:
open-indents badge on home + /issue, prefill via /api/indents.
`productions` RECORD, they never move inventory; subs only (dish refused
server-side), `unit_cost` FROZEN from recipe_costs.cost_per_output_unit,
voids copy it EXACTLY. Closings are now itemized: `kitchen_closing_lines`
(item XOR recipe, qty>0, unit_cost frozen at save from
item_costs.issue_cost / cost_per_output_unit / dish_cost), header
`closing_value` = SUM of lines computed in Postgres numeric and verified
against the stored generated values inside the tx; zero lines = a real ₹0
closing; food cost still reads the header. Kitchen wastage: component is
item OR sub/dish OR value-only; with a component the value is FROZEN
(qty × cost) — the chef types a value only in value-only mode
(saveKitchenWastage now takes the discriminated `component` input).

**Phase 13 — cashier group** (Day close | Vouchers | Settlements |
Off-book | Other income | Non-revenue | Dues | Fetch day):
`partner_settlements` (partner from list; per-partner summary with
outstanding = gross − commission − deductions − received). Deep
aggregator reconciliation WAITS for a real Swiggy statement — do not build
it from imagination. `off_book_orders`: CASH mode feeds
day_close_ladder.off_book_cash and expected_cash through the VIEW — never
re-add it in code; the DayClose UI shows the rung (prefill + reveal +
WhatsApp text). `non_revenue`: reason from list; a picked dish FREEZES
cost_value from dish_costs (qty × dish_cost) — giveaways finally cost
something; description-only entries carry cost 0, no claim; voids copy the
frozen cost negated. `due_payments`: positive = credit given, negative =
received back; `dues_outstanding` nets on lower(trim(party)).

**Phase 14 — store/manager/owner.** Store group (Purchase | Payment |
Issue | Wastage | Vendors | Items): standalone createVendor/createItem in
books-actions ride the SAME V-CAT-NN / CAT-NNN series as the bill flow
(dup names refused by code); masters are still born on bills too. Vendor
payment (/store/payment) stays with the store for now — the accountant
handoff comes in a later phase. Store wastage stays store wastage,
separate from kitchen. Staff group (Employees | Attendance | Expenses):
`expenses` are NON-DRAWER only — paid_via never offers till cash and the
server refuses 'Cash' naming the Cash Voucher; category and mode from
lists. Owner: /pnl renders `pnl_monthly` verbatim —
sections_pending_closing is an honesty banner (COGS incomplete), cogs
stays NULL (never zero) until closings exist, staff_food is its own line
OUTSIDE cogs, giveaway_cost is labeled informational (already inside
consumption), and the net line is captioned "before purchase-time
overheads — not a statutory P&L".

**Deliberately deferred:** aggregator statement reconciliation (needs a
real statement), payroll/advances (money movement), accountant payment
handoff.

## Phase 11 — Owner dashboard + polish

/dashboard (manager + owner): TEN question cards, each backed by a named
view, each drilling to its source — never a chart for its own sake.
Unmapped-POS is an ACTION card; unknown statuses, negative stock, missing
closes and cash differences are red, never hidden.

Polish contracts: `formatPaise` is THE money formatter (Indian grouping —
₹1,04,500 never ₹104,500); PWA manifest + /icon.svg are public paths in
the proxy; the WhatsApp day-close summary comes from src/lib/share.ts
(plain text, the whole ladder); toasts via components/Toasts on saves
that have no reveal screen; the en/te dictionary in src/lib/i18n.ts
covers LABELS ONLY on the five staff-facing forms (Issue, store Wastage,
Kitchen closing, Kitchen wastage, Count) — adding Hindi later is adding
data, not code. Nav is matrix-filtered: you only see what you can open.

## Phase 15 — The look (the sheet legend + the honesty strip)

**The palette is a legend, not a mood.** The values are extracted from
Rajesh's live Sales day-close form — the sheet his staff have typed into
every day for months. In that sheet the fill carries meaning, so it does
here:

- **cream `#FFFBEA` = you type here.** Inputs are cream — the inverse of the
  usual white-field-on-grey-page habit. Do not "fix" it. The cream is PALE;
  that exact tint is the one the staff know, and it is why the field border
  and the doubt hatch are gold rather than a deeper cream.
- **white = a number the app worked out.** ground `#EFF3F7` = the page, and
  a field filled with the ground colour is locked, not yours.
- ground `#EFF3F7` · stone `#F3F1EC` · line `#E2DFD6` · muted `#8A8578` ·
  navy `#233043` (body) · ink `#1A2332` (headings) · green `#2F6B47`
  (primary) · gold `#C8A951` (doubt) · red `#9B2C2C` (wrong or missing).

Those ten named values are the palette. Every other ramp step is derived
from them by lightening or darkening — nothing else was invented.

Tailwind's `stone / emerald / amber / red / violet / sky` scales are
**RE-POINTED** at those ramps in `src/app/globals.css` — `emerald-700` is
the green, `amber-*` is the gold/doubt family, and `stone-*` runs cool navy
at the dark end and warm paper at the light end exactly as the sheet does.
That is how ~1,900 existing class usages speak the palette without a
rewrite. New code should prefer the semantic names: `bg-field`, `bg-cell`,
`border-rule`, `divide-rule-soft`, `text-doubt`.

Type: **Archivo** display (page titles, hero figures, micro-caps section
heads), **IBM Plex Sans** body, **IBM Plex Mono** for money columns and for
the codes — V-PLT-01, CH-001, E014 — which are the spine of the product.
**Noto Sans Telugu** is in the stack so the `te` labels are words, not
tofu. Shared class vocabulary lives in `src/components/ui.ts`; `heroNumCls`
deliberately carries NO colour (appending a second `text-*` would be a coin
flip on stylesheet order — always pass one).

**The signature is `src/components/Honesty.tsx`.** Every number that rests
on data which has not all arrived wears the same hatched cream strip: a
micro-caps verdict, one plain sentence, and — where the gap is countable —
a **meter of literal spreadsheet cells**, filled for the truth that is in,
blank for the truth still owed. `<HonestyPill>` is its inline form for list
rows, `<Doubted>` hatches the figure itself so the doubt survives when the
sentence scrolls away. `level="alarm"` is the red twin, and it stays loud.

Use it for every honesty column the views already publish — uncosted_lines,
pending closing, unassigned/unsalaried marks, unknown POS statuses,
negative stock, missing closes, thin count history, cogs NULL. **Never
compute a figure to fill a gap.** Inside a card that is itself a `<Link>`,
use Honesty WITHOUT `action` — a link inside a link is invalid.

**`npm run audit:matrix` is the LAW 1 gate — run it before every commit.**
It executes navFor / booksTabsFor / the tab strips / the home tiles once
per role and asserts every href they emit is matrix-admitted, then walks
every page in src/app, follows its imports, and asserts that every literal
internal href reachable from a page is openable by every role that can open
that page. It exits 1 on any ungated violation. It was written because
STRICT INVISIBILITY had been claimed twice and was wrong twice: it caught
four live leaks on its first run — the owner-only Photographs block on
/books/recipes (chef and manager saw it), the item links and "Enter a bill"
button on /books/stock (chef), and the /books/issues links on the indent gap
page (chef). All four now gate on `canAccess`, which is also why the
dashboard's P&L link reads `canAccess(user.role, '/pnl')` rather than a
hand-rolled role comparison — one source, every surface.

Quality floor, kept quietly: 40px+ touch targets in nav and tab strips,
`:focus-visible` outlines app-wide, `prefers-reduced-motion` honoured (the
meter's cell-by-cell fill is the one animated moment in the app).


## Phase A — URL restructure, consolidation (2026-08-11)

**Each group owns its books. A chef never leaves /kitchen.**

    /kitchen  /kitchen/books    chef
    /store    /store/books      store
    /sales    /sales/books      cashier
    /staff    /staff/books      manager
    /owner                      owner (Dashboard is manager+owner)

`/` is the front door: a role with exactly ONE group is redirected into it
and never sees a chooser; manager and owner get group tiles. The group
layout renders the tab strip once — pages no longer carry `<GroupTabs>` or
their own `<main>`.

**Tabs group by PERSON AND MOMENT, not by data shape.** The sheets needed 28
tabs because a Sheets tab holds one form shape; that constraint is gone. A
consolidated tab carries a CHIP ROW, and each chip is a real URL holding ONE
small focused form — never one large form with conditional fields. One
question at a time still rules.

    kitchen  Indent · End of shift [Production|Closing] · Loss · Recipes · Books
    store    Receive [Purchase|Pay vendor] · Issue · Loss · Count ·
             Masters [Vendors|Items] · Books
    sales    Day close · Record [Voucher|Other income|Off-book|Non-revenue|Due] ·
             Settlements · Books
    staff    People [Employees|Attendance] · Money out [Expense] · Books
    owner    Dashboard · P&L · Users · Lists · Settings

`src/lib/tabs.ts` is the KEY REGISTRY and the fallback; settings key
`tabs.<group>` may reorder, RELABEL and HIDE a tab and can never invent a
route. The LABEL is editable, the KEY and URL never are. Hidden tabs matter:
a restaurant with no bar should not see Bar.

**Retired URLs redirect, permanently and role-aware** (`src/lib/legacy.ts`,
`components/LegacyRedirect.tsx`). Phones have the old links bookmarked. Two
are role-aware because two groups mount the same view: `/books/stock` and
`/books/sections`; `/books` itself means "my books". The legacy prefixes are
open to every signed-in role in the matrix — they carry no data and decide
nothing, and the target they land on is matrix-checked like any other page.

**Two views are mounted in two groups** (`src/components/views/`): Stock
(chef reads, store owns) and Sections (chef and manager). One file, two thin
route files — never a copy.

**Money-out is five tables** — payments, cash_vouchers, expenses,
contract_bills, casual_labour — an artefact of porting the sheets one tab at
a time. The chips hide that from the user. Merging them is a later refactor,
deliberately not Phase A.

**The schema has moved ahead of this app.** `returns`/`return_lines`,
`contract_bills`, `casual_labour`, `partners` (with `agreed_commission_pct`),
`settlement_deductions`, `catering_events`/`catering_expenses`,
`off_book_lines`, `expense_category_kinds` and several new views all exist
with no UI. They belong to Phase B — do not build forms for them casually,
and do not invent columns: read the schema first.

**Two gates run on every build, both because invisibility was claimed fixed
and was not:**

- `npm run audit:matrix` — every route × every role, plus every literal href
  reachable from every page. Exits 1 on any ungated violation.
- `npm run smoke:phase-a` — the nav list per role BY VALUE (a rule can be
  satisfied by a wrong list), Indian grouping on every rupee figure, no stray
  hex outside the token set in globals.css, and every retired URL resolving
  to a live route for every role.

WhatsApp's green is a named token (`--color-whatsapp`) rather than an
exception in the hex gate: every colour in the app is either a token or a bug.

## Phase A-2 — the dashboard, the gap, and two-way stock (2026-08-11)

**The dashboard is ordered by what is most wrong.** `/owner` builds an array
of question cards, each computing its own `urgency` from what it actually
found, and sorts on it — a broken thing rises to the top of the screen the
day it breaks and sinks when it is fixed. The weights live in one `URGENCY`
table at the top of the file (impossible 900 → people 100); a healthy card
scores 0. Ties break on the card key so a quiet dashboard does not reshuffle
between reloads.

**Every card carries a SENTENCE**, not just a figure — "Kitchen costs more
than it earns", "₹4,200 of what we billed has not been accepted by Swiggy".
A number alone makes the owner do the interpreting.

**ONE period control** (`?period=this-month|last-month|last-3-months`),
`src/lib/period.ts`, above everything it scopes — never a filter per card, or
two cards answer about two different months. `resolvePeriod` is PURE (takes
today as an argument) and returns BOTH a date range and the month-starts it
covers: event tables filter on the range, monthly views are read per month
and summed. A three-month period reports food cost for its LAST month only,
named on screen — a blended percentage across months would be a lie.

**Charts, in `src/components/dashboard/Charts.tsx` (recharts).** Four named
forms chosen by the job the data does; deliberately no generic `<Chart type=>`,
because picking the form is the design decision. A single day renders as a
hero figure, not a one-point line. Colours are `var(--color-*)` only — a hex
here is a bug the smoke gate catches.

**RED AND GREEN NEVER CARRY MEANING ALONE.** Measured with the dataviz
palette validator, `emerald-700` against `red-600` separates by ΔE 4.2 under
deuteranopia — indistinguishable. The palette is Rajesh's sheet and does not
change, so every diverging chart encodes the same fact three ways: which side
of the zero baseline the bar sits on, the sign printed in the label, and
colour last. `emerald-700` against `amber-400` (the only two-series chart)
passes at ΔE 23.8, but gold fails contrast on white, so both series are
direct-labelled and repeated as text.

**The honest empty state is the common case.** With two bills and no sales
the page says so — `getEntryPulse` counts what was actually entered, and the
dashboard leads with "Nothing entered for this period" or "Costs are in,
sales are not" rather than drawing nine zeroes that read as a catastrophic
month.

**The aggregator gap card** reads `partner_settlements.gap` (a GENERATED
column, `billed_by_us − claimed_by_them`, so positive = money they have not
accepted) joined to `partners.agreed_commission_pct`. It states the effective
commission they actually took beside the rate agreed, and never picks one and
calls it truth. Settlements with only one side filled in are counted as
`uncompared` and wear an honesty strip — they are not treated as zero.

**Stock moves both ways through ONE form.** `/store/issue` carries a
direction toggle (Out to section / Back to store); "back" writes `returns` +
`return_lines` via `saveReturn`, reason from the `return_reason` managed list.
`unit_cost` is snapshotted from `item_costs.issue_cost` exactly as an issue
is, because `section_consumption` computes issued − returned and both sides
must be valued on the same scale. A return is NOT a void: the trip out really
happened and stays on record. Turning the form around drops any indent stamp —
an indent is a request to be given something and has no meaning backwards.
`stock_on_hand` already adds `returned_qty` back and `section_consumption`
already subtracts return value; the views own that arithmetic, nothing
recomputes it.

**Recurring expenses offer last month's figure.** `getRecurringExpenseOffers`
returns every category that had money last month with its payee and mode, and
whether this month already has one. Tapping fills the form and stops — the
figure lands in an editable field and nothing is written until save.

`npm run smoke:a2` is the third gate: the period maths asserted BY VALUE
(including the January year-roll and February in a leap year), then every new
query executed against the real database. It is read-only and safe against
live data. It caught an invented column (`kitchen_closing_current.closing_date`
— the real name is `close_date`) on its first run, which is the whole reason
it exists.

## Phase B worklist — schema that exists with no UI

Read the schema before building any of these; do not invent columns.

| Table | State | What is missing |
|---|---|---|
| `returns` / `return_lines` | **UI shipped in A-2** (direction toggle) | no VOID path, and the store log does not list returns |
| `contract_bills` | no UI | contract-vendor billing; `pnl_monthly.contract_vendors` already reads it |
| `casual_labour` | no UI | daily-wage labour; `pnl_monthly.casual_labour` already reads it |
| `catering_events` / `catering_expenses` | no UI | `catering_summary` view exists; `issues.catering_id` is already a column |
| `off_book_lines` | header only has UI | per-line detail under `off_book_orders` |
| `settlement_deductions` | no UI | itemised deductions under a settlement; the `settlement_deduction` list is already seeded |
| `expense_category_kinds` | no UI | classifies expense categories (controllable vs occupancy) for the P&L |
| `list_suggestions` | no UI | unknown |
| `starter_library` | no UI | unknown |

**The list registry in `src/lib/lists.ts` has drifted from the database** and
this is load-bearing, not cosmetic. The DB holds 14 `list_key` values; the
code declared 7 (8 after A-2 added `return_reason`). Three keys the code reads
have **no active rows at all**, which silently disables the forms that need
them:

- `expense_category` — the Expense form's dropdown is empty and
  `saveExpense` refuses every category, so **no expense can be recorded**
- `payment_mode` — empty "paid via" on Expense, Off-book and Vendor payment
  (the DB instead has `off_book_payment_mode`, seeded with six values)
- `partner` — empty picker on Settlements (the `partners` TABLE, 5 rows with
  agreed rates, has superseded it)

Seeded in the DB but unknown to `lists.ts`: `bank`, `card_machine`,
`cash_handler`, `off_book_payment_mode`, `order_type`, `other_income_unit`,
`session`, `settlement_deduction`, `upi_machine`. Deciding which of these
replace the three dead keys is Rajesh's call — the values are his restaurant's
vocabulary, and the Lists screen exists so nobody has to guess them in code.
