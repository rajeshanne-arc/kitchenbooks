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

**items.yield_pct — SUPERSEDED TWICE. See "Where yield lives" at the end of
this file for the current ruling.** The rule as written here (gross
quantities in the recipe, no yield field anywhere) is no longer in force.

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

## Phase B — Store first (2026-08-11)

**THE POOL WAS TOO SMALL AND IT DEADLOCKED.** `src/lib/db.ts` ran `max: 4`.
A group layout checks out connections (session, restaurant, tab list, tab
badges) at the same time as the page it wraps, and the heaviest page — the
item master — needed more than four at once. Postgres showed every `kb_app`
connection parked at `wait_event ClientRead` while the request waited
forever for a free one, until a statement timeout (57014) killed it.
`/store/masters/items/[id]` hung on EVERY load, in dev and in production,
and it predated Phase B. Now `max: 12`. **Raise it again before adding
another concurrent read to a layout** — this failure is invisible in
isolation (every query is fast on its own) and only appears under the real
layout+page fan-out.

**pnl_monthly was renamed and /owner/pnl 500'd on every load.** The view now
says `food_beverage` / `off_book` / `net_sales`, `total_labour`,
`total_expenses`; the query still asked for `revenue`, `labour`, `expenses`,
`gross_margin`, `net_before_purch_overheads` and `sections_pending_closing`.
The honesty column moved into its own view, `pnl_diagnostics`
(month, severity, what), which the page now renders in words. Read the view
before editing this page; the schema has moved under it once already.

**The three reported bugs, and what each really was:**

1. *Payment mode picker* — REAL, and it was two faults. `list_options`
   `payment_mode` was empty (fixed in the database, not here), AND
   `PaymentForm` carried `modes = MODES`, a hardcoded default. A JS default
   only applies to `undefined`, so the caller passing the genuinely empty
   list got an empty `<select>` and no fallback, while the vendor page —
   which omitted the prop entirely — silently offered a hardcoded "Other"
   that the list does not contain. Two call sites, two different sets of
   modes, neither of them the list. `modes` is now REQUIRED with no
   fallback; an empty list says so and refuses to save.
2. *Issue autofill "lands nowhere"* — REAL, and purely client-side. The
   server prefill was always correct. Tapping "fill it →" is a SOFT
   navigation to the same route: the server re-rendered with the new indent,
   but React kept the existing `IssueEntry` instance, and that component
   seeds its state from `initialIndent` inside `useState`, which only runs on
   mount. The URL changed and the form did not. Fixed with
   `key={prefill?.id ?? 'blank'}` so the component remounts.
3. *Dashboards not visible* — REAL, and it was navigation, not the pages.
   `/kitchen` and `/store` ARE dashboards and were built and deployed; no tab
   in `tabs.ts` pointed at either, so the only way in was the top-level nav
   link and no tab ever lit while you were on one. `TabStrip`'s own comment
   already anticipated a Dashboard tab. Both groups now have one, first in
   the strip.

Also found and fixed: **the legacy shims dropped their query strings.**
`goLegacy` took only a pathname, so a bookmarked `/issue?indent=<id>` landed
on a blank form — the same symptom as bug 2 from a different cause. Every
shim now forwards `searchParams`.

**Masters cover every column the grant allows.** Vendor: Identity / Contact /
Banking / Terms & opening balance / Notes. Item: Identity / Units &
conversion / Costing / Ordering / Notes. `opening_balance` is fillable at
last — `vendor_dues` is opening + purchased − paid, so carried-over debt was
unrepresentable before. Locked-with-reason: vendor `code`,
`primary_category`; item `code`, `category`, `purchase_unit`. **`yield_pct`
has an UPDATE grant and stays OUT of the UI** — recipes state gross
quantities and an item-level yield field must not come back.

**Vendor profile** leads with what people came for: balance, then a BANKING
CARD with per-field copy buttons (an account number is retyped into a bank
app under time pressure — the machine does the copying), then contact, then
payment and bill history, then the editor.

**Reorder** reads `reorder_due`, grouped BY VENDOR because the trip is the
unit of work. Zero rows with zero items carrying a reorder level is an
honesty state, not an empty one: the list says the question has not been
asked rather than implying a full store. Tab badges (Reorder, Issue) are
server-rendered and **silent at zero** — a "0" is a thing to read and
dismiss every time.

**Payment opens on the QUEUE**, not a search box: `vendor_dues` sorted worst
first with days since last payment, "never paid" distinguished from "paid
long ago". Search remains underneath for vendors owed nothing.

**Multi-line entry is a TABLE.** The issue form is item / qty / unit /
on-hand / note in aligned columns; tab crosses a row then drops. Line notes
now persist (`issue_lines.note`, `return_lines.note` — both were already
INSERT-granted and unused). The shared table vocabulary lives in
`components/ui.ts` — `dataTableCls`, `thCls`/`tdCls`, `thNumCls`/`tdNumCls`,
`tdCodeCls`, `trCls` — paired so a heading always sits over its own column,
numbers right-aligned and tabular, row height fixed rather than
content-derived. Use these rather than styling a table by hand.

**The store has its own dashboard** at `/store`, sharing the owner's period
control and chart rules: goods in, stock out by section, outstanding dues,
paid out, with the alarm tiles (negative stock, reorder, open indents) above
everything measured.

**Still empty, still blocking:** `list_options` `expense_category` and
`partner` have no active rows, so the Expense form still refuses every
category and the Settlements partner picker is still empty. `payment_mode`
was seeded and works. These are Rajesh's vocabulary — add them in
Settings → Lists.

## Phase B (cont.) — partners are a MASTER, and the schema gate

**PARTNERS ARE NOT A LIST.** `list_options` was the wrong home and the
question "does Settings → Lists edit `partners` or `list_options`?" has a
blunt answer: only `list_options`, and nothing in the app read the `partners`
table at all. A list row holds a name. A partner carries `kind` and
`agreed_commission_pct` — the number the whole settlement-gap card turns on —
so partners are a master table with their own screen, **Sales → Partners**,
and the `partner` key is REMOVED from the list registry. Adding partner names
under Lists built a second, silent vocabulary the gap card could not join to.

**The settlement form never wrote the gap.** `billed_by_us` and
`claimed_by_them` existed in the schema and no form filled them, so `gap` (a
GENERATED column) was always NULL and the dashboard card could never fire.
The form now captures both sides — either may be left blank, and a
one-sided settlement is counted as `uncompared` rather than read as zero —
validates the partner against the MASTER (the refusal names Sales →
Partners), and writes `settlement_deductions` as itemised lines from the
`settlement_deduction` list. Verified end to end in a rolled-back
transaction: billed 100000 / claimed 96000 → gap 4000, agreed 24%,
effective 26.4%, two deduction lines.

**`npm run audit:schema` is the fourth gate — every column the server reads
must still exist.** It parses every `sql\`…\`` template in `src/server`,
resolves the relations each one selects from, and checks both qualified
(`p.bill_date`) and UNQUALIFIED (`coalesce(revenue, 0)`) column references
against `information_schema`. The unqualified case is the one that matters:
the pnl query named its columns bare, so an alias-only checker would have
sailed straight past the break it was written for. `--self-test` asserts it
still catches the `pnl_monthly.revenue` regression specifically. Currently
1332 references checked, all resolving.

Its limits, stated honestly: it checks statements where the relation is
resolvable, skips writes for the unqualified pass (an INSERT names target
columns before any relation is in scope), and cannot reason about CTE bodies
or dynamic `sql.unsafe` fragments. It would have caught the pnl break; it
would not catch a column whose TYPE changed.

## Phase B (cont.) — structure, the four recovered reports, activity

**PAYROLL IS NOT BUILT, DELIBERATELY.** Rajesh's Labour sheet has never run
a real payroll — its June run paid 34 days in a 30-day month. Attendance is
INSERT-only and `attendance_current` already resolves corrections, so the
data is ready whenever he is; what is missing is a proven method, not a
table. Do not build payroll, advances or salary payments from the sheet as
it stands.

**Production split out of End of shift.** Batches are made through the day;
closing happens once at night. Different moments, different tabs — the
earlier pairing was wrong. End of shift now holds Closing and Loss.

**Kitchen tabs: Dashboard · Departments · Indent · Production · End of shift
· Recipes · Books.** **Sales tabs: Dashboard · Daily sale · Record ·
Partners · Books** — the day close moved INTO Record (it is a daily money
event like the vouchers beside it, and its own tab implied it was a
different kind of thing) and `/sales` became the cashier's dashboard.
`/cash` now redirects to `/sales/record/close`, not `/sales`.

**Departments ARE sections.** One table: the same row codes a dish (CH-001),
receives an issue and posts a staff member — so a rename lands in all three
at once with nothing else to update. The NAME is editable, the CODE is not,
and the screen says why. Each row shows how many dishes, issues and staff
already depend on it. "Section" is now "department" in UI copy; the column
is still `sections` and always will be.

**Indents carry a SESSION** (Morning / Evening / Extra / Catering, from the
`session` list). An indent is for a SHIFT, not a day: the evening kitchen
asks for different things than the morning one, and the store needs to know
which ask it is filling. `open_indents` carries it too.

**The four recovered reports**, each reading a view the migration publishes:
`gst_service_by_day` (Sales → Books → GST & service — the effective rate
against an expected 5%, captioned so nobody mistakes GST or service charge
for revenue), `cash_handovers` (who took how much, by day and period),
`slow_moving_stock` (beside Reorder as a chip, because what to buy and what
was over-bought are the same question from opposite ends), and
`daily_purchases` (Store → Books).

**The owner activity log** (`/owner/activity`, owner-only) reads
`activity_log` and records NOTHING new — `entered_by` and `created_at` have
sat on every event table since phase 10. Filters by person, type and period
come from what actually happened, not a hardcoded list. Reversals are
BADGED as corrections rather than hidden or merged: a correction is a thing
someone filed, and reading it as "they changed the number" is the difference
between a ledger and an accusation.

`npm run audit:schema` covers the new views automatically — it walks all of
`src/server`, so a new query file is gated the moment it exists.

## Phase B — commit 1: three live bugs, inline lists, four one-field gaps

**The three reported bugs, all real:**

1. *Dishes could be coded to Security.* `/kitchen/recipes/new` called
   `getSections`, which returns ALL 16 active org units — `dept_group` was
   never the right filter. `sections.codes_dishes` now exists (SI NI CH CT
   TD BK BR) and `getDishCodingSections` uses it. The dish code carries the
   department forever, so a wrong one here is permanent.
2. *Production and End of shift both showed Closing + Loss chips.* The
   production page lived at `/kitchen/shift/production`, UNDER the shift
   layout — and that layout paints the chip row for everything beneath it.
   Production moved to `/kitchen/production`; `/kitchen/shift/production`
   is now a retired URL. **Route nesting decides chrome: a page that should
   not wear a group's chips must not live inside that group's segment.**
3. *Dead space below the issue form.* Every group layout carried `pb-24`.
   Only two screens in the app have a fixed bottom bar (BillEntry,
   AttendanceSheet) and they were making every other screen pay for their
   clearance. Layouts are `pb-10`; those two reserve their own room.

**INLINE LIST ADDITIONS — LAW 2 amended.** A list field now ACCEPTS a typed
value: it saves, and the value lands in `list_suggestions` as pending. LAW 2
was right about the danger ("Asheel" and "Asheel Sir" are two people to a
computer) and wrong about the remedy — refusing the save stops the WORK, and
the person holding the receipt cannot wait for an owner to log in. The
proof it was wrong: `expense_category` was EMPTY in production, so the
Expense form refused every entry that reached it. Entry never blocks now;
the owner still decides what becomes vocabulary, in Settings → Lists.
`seen_count` is the signal — a word typed nine times is real, once is a typo.
**An expense category cannot be approved without being marked controllable
or occupancy**, because `pnl_monthly` splits on exactly that and an
unclassified category would land in neither. `list_suggestions.status` is
`pending | accepted | rejected` — 'approved' violates the CHECK constraint.

**The four one-field gaps, and why `is_stock_purchase` was not cosmetic.**
COGS is opening + purchases − closing. A market purchase paid from the
drawer never enters `purchases`, so recorded only as a voucher it dropped
out of food cost entirely — cost understated, margin overstated, nothing on
screen looking wrong. The voucher form now asks it as a plain question:
"Was this stock for the kitchen?" Also added: `off_book_orders.customer` and
`received_into`, and `partner_settlements.reference` (their statement/UTR —
what you quote when the gap is disputed).


## Where yield lives — a rule reversed twice, and why

This has moved three times. The history matters more than the conclusion,
because each move was made for a real reason and the next person will be
tempted to move it again.

1. **Phase 3 — nowhere.** Recipes would state GROSS quantities (what leaves
   the store, trim included), so yield would be baked into the quantity a
   chef wrote. `items.yield_pct` stayed as a reserved column with no UI.
   *Why it failed:* it asks the chef to do the arithmetic in their head and
   leaves no record of the assumption. Nobody can audit a number that was
   silently folded into a quantity.

2. **Commit 3 brief — on the ITEM, read-only on the line.** "The same kilo
   of mutton cannot cost two different things in two different dishes."
   Cost per usable unit = weighted average ÷ (yield ÷ 100); Basha fish at
   ₹350/kg at 55% yield costs ₹636.36 per usable kilo, and a recipe ignoring
   that undercosts every dish using it.
   *Why it failed:* it requires a yield figure on all 319 items before any
   dish costs correctly, and most of those items are never trimmed.

3. **NOW — on the RECIPE LINE, editable** (`recipe_lines.yield_pct`,
   default 100, CHECK > 0). `items.yield_pct` UPDATE is **revoked**;
   `recipe_costs` and `supplier_costs` divide by the LINE's yield.

   **The accepted trade-off, stated plainly:** the same item can now carry
   different yields in different dishes. That is a real inconsistency and it
   was chosen deliberately — only the lines actually used need a figure,
   rather than all 319 items needing one before anything is right. If two
   dishes disagree about the same fish, that is now a thing a human can see
   on the two cards and reconcile, instead of a thing nobody can enter.

**`item_costs.yield_pct` and `item_costs.usable_cost` are VESTIGIAL.** They
remain only because a view's columns cannot be dropped without cascading
nine dependents. Nothing reads them. Do not use them. The item-level read
was removed from `getItemDetail` so nothing can start.

## Commit 2 — create forms, and the indent as one table

**Create forms now carry every INSERT-granted column behind a "more
details" fold.** The Store-phase report said the masters covered every
granted column; that was true of the EDIT pages and I did not say it was
edit-only. `ItemNew` asked 5 of 19, `VendorNew` 5 of 22. A reorder level
nobody set on the way past is a reorder level nobody ever sets, and the
Reorder tab stays empty forever — so the fold is one form, not a second trip.

**The indent is ONE TABLE** reading `indent_fulfilment`: item, asked, given,
gap, returned. Request / received / return are three states of one document,
so they are three columns rather than three screens. The ad-hoc gap grid it
replaces is deleted, not left beside it. Returns are matched by item since
the indent date and captioned as CONTEXT — a return is department-level
stock going back and is not tied to one indent, so the screen says that
rather than implying a link the data does not carry.

**Line prefill was already fixed** — the `key={prefill?.id}` remount from the
Store phase. Verified against the live database: `initialIndent` arrives
with both lines and their quantities. The screenshot predated the fix.

## Commit 2 (cont.) — session, and the refusal that replaces a default

**`issues.session` has a database default of 'Morning', and that default is
what made the data wrong** — every evening issue quietly claiming to be a
morning one, with nothing on screen to notice. So:

- `SaveIssueInput.session` is REQUIRED and `saveIssue` refuses a blank one
  by name. There is no fallback anywhere on the path.
- The picker starts **empty**. Preselecting "Morning" would reproduce the
  exact bug in the UI layer — a question that answers itself is not a
  question. The form says "Pick the session before saving — it is not
  assumed" once a department is chosen.
- **Department + session together** pick out the one indent being filled: a
  department can have a morning ask and an evening ask open at once.
  `/api/indents?section=&session=` narrows it, and filling an indent adopts
  ITS session, so the store never restates what the kitchen already said.
- Session shows on the open-indents list and in the chooser.
- **"Refill from last request"** (`/api/indents?last=1&section=&session=`)
  puts the previous request for that department and shift back on the
  screen, editable, saving nothing until save is pressed.

The general rule this is an instance of: **a column default is not a
substitute for an answer.** Where the database supplies a default for
something a human is supposed to decide, the form must still ask, and the
save must still refuse.

## Commit 3, part 1 — the yield mechanic is live

`recipe_lines.yield_pct` had no route into the UI, so every line sat at the
default 100 and dish costs ignored trim entirely — the migration was inert.
The line editor now carries it.

**Where it shows and where it does not.** An ITEM line gets an editable
yield; a SUB-RECIPE line shows a dash and `updateLineYield` refuses it by
name. The trim inside a sub was already paid for when its own cost was
worked out, and applying a yield again would charge the same loss twice.

**Colour says what kind of fact it is.** Below 100 is terracotta
(`red-400`) because trim is a fact about the ingredient, not an error;
exactly 100 is greyed because it is the ordinary case. The line also states
the usable cost — "₹636.36/usable kg" — beside the purchase cost, so the
number the batch is actually charged is visible where it is caused.

The per-line arithmetic mirrors `recipe_costs` exactly
(`qty × cost ÷ yield × 100`), so the lines add up to the batch total the
view states rather than to a slightly different number. Verified in a
rolled-back transaction: ₹305 at 100% becomes ₹554.55 at 55% — ratio
1.8182 = 100/55.

Yield is capped at 100: it is a percentage of what you bought, so more than
all of it is not a thing.

## Commit 3, part 2 — the dish card

**Inputs are what a human decides; answers are what `dish_costs` works out.**
The card is split on exactly that line, and nothing in the answers block is
recomputed here — a rate change on a bill moves the card with no re-cost
step, which is the phase-4 rule still holding.

**FLAG and COLOUR answer different questions and the card keeps both:**

- the FIGURE is coloured absolutely — amber over 35%, red over 40% —
  because a dish at 44% is expensive whatever it is;
- the FLAG compares against THAT COURSE's target from `course_targets`,
  because 30% is fine for a main and poor for a beverage.

So a dish can read amber and still flag OK. That is not a contradiction, it
is the two findings being different: "expensive" and "off target" are not
the same sentence.

**CHECK is neither of those.** It means the dish costs zero — a broken link,
an ingredient with no bill behind it — and it is a repair job, never
reported as a cheap dish. Verified against the view: a dish with no costed
lines returns `dish_cost 0, food_cost_pct 0.0, flag CHECK`.

**Food cost % is ingredients only, and the card says so in words.** Overhead
is a manual figure for pricing decisions; folding it into the ratio the
kitchen is judged by would make the kitchen answer for the owner's estimate.

**No portions, no answers.** A batch cost divided by nothing is nothing, so
the answers block is replaced by an honesty strip naming what is missing
rather than four dashes or four zeroes.

## Commit 3, parts 3–6

**Sub-recipe card — and a default masquerading as an answer.** The brief
asked for "both quantity and unit required before the cost means anything".
Reading the schema first showed why that cannot be a null check:
`recipes.output_qty` is NOT NULL DEFAULT 1 and `output_unit` is NOT NULL
DEFAULT 'portion'. Neither can be missing, so the database cannot tell
"this batch makes 1 portion" from "nobody ever said what this batch makes".
A gravy that really makes 5 litres but still carries the defaults reports
its whole batch cost as the cost of one portion — five times the truth,
inherited by every dish using it, with nothing looking wrong.

So the card treats BOTH-at-default as unanswered, withholds cost-per-unit,
and names what is missing. One alone is ordinary: a sub really can make 1
litre, and a sub really can be portioned. **This is the same failure as
`issues.session` defaulting to 'Morning'** — a column default standing in
for a human answer — and it is now the second instance, so treat it as a
pattern when reading any NOT NULL DEFAULT on a column a human is meant to
decide.

**Supplier exposure** (`supplier_costs`, Kitchen → Books) is sorted by
DISHES, and the ordering is the report's argument: if the big-money supplier
fails you pay more; if the thirty-dish supplier fails, a third of the menu
stops. Captioned EXPOSURE, not spend — it counts what the cooking depends
on, not what was bought, so a supplier who sold nothing this month can still
be the reason thirty dishes are possible.

**Kitchen wastage quantity was already built** — component (item | sub |
dish) → qty → value frozen from the component's cost, with value-only kept
as the fallback for "half a tray of gravy", reason from `waste_reason`.
Verified rather than rebuilt.

**Departments are two tabs** on `dept_kind`. Same table, same editing rules;
the split is only so a chef looking for Tandoori does not scroll past
Security. Creating one sets `dept_kind` from the active tab, and
`codes_dishes` is a deliberate tick shown only for kitchen departments —
the server refuses it for operational ones, because the code becomes part of
every dish code and cannot be moved afterwards.

## Commit 4 — partners as a section, and a NOT NULL DEFAULT sweep

**Settlements live INSIDE Partners now.** They were sibling tabs, which put
the master and the thing it governs in two places and made the agreed rate
read as trivia rather than the number every settlement is measured against.
`/sales/settlements` is a retired URL redirecting into the section.

**Variance is stated BOTH ways and the screen refuses to collapse them:**

- the **rupee gap** is `billed_by_us − claimed_by_them` — money we say we
  earned and they have not accepted. An argument about one number.
- the **effective rate** is `commission ÷ gross` against
  `partners.agreed_commission_pct` — what they actually kept against what
  they said they would. An argument about the deal, which can be wrong
  while every individual invoice reconciles perfectly.

A small gap on a large period can hide a rate that drifted a point; a large
gap can be one disputed invoice charged at exactly the agreed rate. Showing
only one would answer the wrong question half the time.

The panel LEFT JOINs from `partners`, so a partner with no settlement still
appears — "we have never reconciled Zomato" is a finding, and an absent row
cannot say it.

## Commit 5a — contract bills and casual labour

Both feed the P&L's labour line: `pnl_monthly` reads `contract_vendors`
from `contract_bills` and `casual_labour` from `casual_labour`. Both tables
were empty, so `total_labour` counted only salaried staff and understated
what labour actually costs.

**The drawer rule applies here too, and it is CHECKABLE rather than a
habit.** `day_close_ladder` reads `cash_vouchers` and does NOT read either
of these tables — verified against the view definition. Money paid out of
the till and recorded only here would leave the drawer short at close with
nothing to explain it. So till cash is refused by name, exactly as on an
expense, and both forms say where it belongs.

**This is a judgement call worth revisiting:** casual labour in an Indian
restaurant is very often paid in cash from the drawer, and today that means
two entries — a Cash Voucher for the drawer, and nothing here. Either
`day_close_ladder` learns to read `casual_labour`, or a cash voucher grows
a "this was casual labour" flag the way it grew `is_stock_purchase`. The
second is the smaller change and matches the precedent. Not decided here.

Casual labour's department is OPTIONAL — blank means the whole place, which
is a real answer for a day's unloading, not a missing one.

## Casual labour paid from the drawer — one payment, one record

`cash_vouchers.is_casual_labour` (migration `casual_labour_voucher_flag`).

**The drawer reconciles against reality, and reality is ONE payment.**
Requiring both a voucher and a `casual_labour` row for the same ₹800 is
double entry with nothing checking the halves — the same fault removed from
owner reimbursements. One payment, one record, read twice.
`is_stock_purchase` set this precedent, so the shape is one the cashier
already knows rather than a new idea.

**`pnl_monthly.casual_labour` now has TWO SOURCES** — the `casual_labour`
table UNION cash vouchers flagged `is_casual_labour`. **This is a standing
risk and both sides carry a comment saying so:** a total fed from two places
can silently halve when either changes, and neither TypeScript nor the
schema gate would notice, because both sides would still be valid SQL over
existing columns.

**So `npm run smoke:a2` asserts the money MOVES**, not that the column
exists: a flagged voucher must shift `pnl_monthly.casual_labour` by its
amount, and an unflagged one must not shift it at all. The negative case is
the one that catches a broken `WHERE`. Both run inside a transaction that
deliberately rolls back — the only way to prove money reaches a total is to
move some.

The casual-labour form still refuses till cash, but no longer as a dead end:
it names the voucher question that does the job in one entry.

## Drawer-paid stock reaches COGS — and why UNIONing is correct here

`is_stock_purchase` recorded the intent and nothing carried it into the sum,
so vegetable money sat outside cost of goods entirely. The same unfinished
shape as the casual-labour flag, one commit earlier: **a flag that records
an intention is not the same as a journey completed, and the second commit
is the one that matters.**

**Why UNIONing flagged vouchers into `purchases` is CORRECT, not a fudge.**
COGS = opening + purchases − closing, and the CLOSING side is a PHYSICAL
COUNT — `store_stock_by_month` reads `stock_counts × stock_count_lines`, not
`stock_on_hand`. So:

- vegetables consumed → not on the shelf → closing unchanged → COGS
  correctly carries the cost;
- vegetables still there → the counter counts them → closing rises too →
  COGS nets back out.

Either way the arithmetic lands right. It would NOT if closing came from
`stock_on_hand`, where these goods never appear — COGS would be permanently
overstated. **Read which side of a subtraction is measured and which is
derived before deciding a UNION is safe.**

**The rejected option:** making a flagged voucher write a real `purchases`
row. It demands a vendor and item lines for a ₹400 market run at 6am, buys
nothing COGS does not already get right, and would help inventory *badly* —
approximate lines typed under pressure create ghost stock the physical count
then contradicts.

**The limitation is on screen, twice** — on the voucher form when the flag
is ticked, and on the P&L under the table. The money counts, the stock does
not: no vendor, no item lines, so these goods never reach `stock_on_hand`,
never trigger a reorder, and never appear in slow-moving. If something needs
tracking as stock, it is a purchase bill.

`pnl_monthly` now has TWO two-source totals — `purchases` and
`casual_labour`. Both CTEs name their other half in a comment, and
`smoke:a2` asserts each moves by the flagged amount and does not move on an
unflagged voucher.

## Commit 5b — catering and off-book lines

**Catering costs itself from the issues, and the stamp is not optional.**
`catering_summary.food_cost` sums ONLY `issue_lines` whose issue carries
`catering_id`. An event with no stamped issue therefore reads
margin = revenue, which looks like a wildly profitable job rather than an
uncosted one. So the stamp had to ship WITH the module — a picker that
appears on the store issue form when the session is Catering — or the
screen would have been a confident lie. **The same flag-without-journey
fault as `is_stock_purchase`, caught before shipping this time.**

Verified in a rolled-back transaction: an unstamped catering issue leaves
food_cost at 0; a stamped one moves it to 610 and margin from 5000 to 4390.

Where an event has nothing stamped the table prints "none stamped" and
"not real" rather than a margin, and an honesty strip says an uncosted job
is not a profitable one.

**NO MENU PRICE ANYWHERE in catering**, deliberately: a job is costed from
what actually left the store, not from what those dishes would have sold
for. Revenue collected is the one editable figure — the cheque clears days
after the food goes out — and cost never is, because cost is the issues.

**Off-book lines** answer a question a lump sum cannot: what was given, and
how far under the menu. `at_menu` and `agreed_value` are GENERATED and so
are absent from the insert column list by necessity; `cost_value` is FROZEN
from `dish_costs` at save, the same rule as a non-revenue giveaway — a
discount still consumed real food, and that cost must not drift when the
recipe changes later. Lines are optional: a lump sum is still a true record
of money.

## Commit 6 — the count is a SHEET

Rajesh's paper count lists every item with a box against it and you work
down. A screen that makes you search for each item in turn is slower than
the paper it replaces, so the entry list is now a table on the shared
column vocabulary — item · code · category · counted · unit — with a
running `filled / total` so a counter knows where they are on a long sheet.
The filter narrows the sheet; it never gates entry.

**Blind, and the reason is on screen:** book quantities appear only in the
reveal after save. `CountableItem` does not even carry `book_qty`, so the
entry screen cannot leak it — seeing the book figure while counting turns a
count into a confirmation of it.

Already correct and left alone: `book_qty` and `unit_cost` are FROZEN
server-side inside the save transaction from `stock_on_hand` and
`item_costs`; `variance_qty` and `variance_value` are GENERATED; zero is a
real count; the first-count warning is COMPUTED from
`getIssueHistoryDays` and warns without blocking.

**Why this screen matters more than it looks.** `store_stock_by_month`
reads `stock_counts × stock_count_lines`, and that closing figure is what
makes BOTH COGS branches correct — including the drawer-paid market
purchases UNIONed into `purchases`. Verified in a rolled-back transaction:
a count of 3 short froze book 19 / cost 305, generated variance −3 /
−₹915, and moved `store_stock_by_month.closing_value` to 4880 immediately.
**Making counting fast is the same job as making COGS trustworthy.**

## Phase C — Accountant + payroll

**The global rule: capture the shape, configure the rules.** Nothing in the
schema encodes one country's tax law. Accounts are user-named. Withholding
records what was withheld. The staff fund works whether the local word is
service charge or tips. Anywhere the code is tempted to hardcode "GST" or
"TDS" or "April", it reads a setting or a list instead. That is what makes
the product sellable outside the country it was built in.

Two deciding principles:

1. **Whoever touches the money records it; the accountant reviews everything
   and owns the books.** Entry follows the hands, ownership follows the
   responsibility.
2. **The accountant works from home. Their home screen is a QUEUE, not a
   form.**

### Commit 1 — money accounts, the hinge

`money_accounts` is the master every money form points at: user-named,
tagged by KIND — cash · bank · wallet · card_settlement · owner · other.
Kinds are SHAPES, never brands, which is what lets the same code run in a
country whose banks and wallets nobody here has heard of. **Seed nothing**:
zero accounts is the normal first screen, and the empty state says so.

`/owner/accounts` is the master (owner-only; every other role uses the
picker, never the list). `kind` is the only field with no UPDATE grant and
the screen says why in a `LockedField` — every register groups by kind, so
re-typing a bank as cash would move that account's whole history into
another column. Retire and open a new one. Balances come from
`account_balances`, which covers ACTIVE accounts only — a retired row
therefore reads "retired", never a dash that would look like "nothing ever
moved here".

**`account_id` is NULLABLE by design and the app REFUSES a blank.** History
predates accounts and must not be rewritten, so the column has to allow
NULL; new entries are refused by name in `assertAccount`
(`src/server/accounts-queries.ts` — deliberately NOT in the `'use server'`
file, where it would become a client-callable action). This is the third
time the same lesson has been paid for: `issues.session` and
`recipes.output_qty` both had a column default standing in for a human
answer, and both lied quietly for months. **There is no default account and
there never will be.** `AccountPicker` preselects nothing.

Nine write paths ask for it: `recordPayment`, `saveOtherIncome`,
`saveVoucher`, `closeDay`, `saveOffBook`, `saveSettlement`, `saveExpense`,
`saveContractBill`, `saveCasualLabour`. Two are CONDITIONAL, because money
may not have moved at all: a settlement filed before the money arrives
(`amountReceived === ''`) and a day close with an empty bank block name no
account, and demanding one would be inventing a journey. `AccountRefusal`
is recognised by all four `fail()` handlers so the refusal reaches the user
in its own words instead of wearing the generic "Failed — nothing was
written" apology.

Guarded in `smoke:a2`, four ways: the refusal fires by name; an id that is
not on the active list is refused; a voucher naming an account moves
`account_balances.balance` by exactly minus its amount and appears once in
`money_movements` (rolled back); and — statically, because the real risk is
a form shipped LATER without the refusal — every one of those nine
functions is read from source and asserted to call `assertAccount`.
