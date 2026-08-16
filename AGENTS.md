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

**The DELETE exception.** `recipe_lines` may be deleted: removing an
ingredient from a card is normal chef editing, not history erasure. This
was written as "the system's only DELETE grant, nothing else may ever gain
one" — see **"Editable, then frozen"** at the end of this file for the
general rule that superseded it. There are now three, and the count is not
the point; the reason is.

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

### Commit 2 — document numbers

`next_doc_no(restaurant, type, fy)` is a SECURITY DEFINER function: one
upsert on `doc_sequences` that increments and returns in a single
statement, so the series is gapless by construction. Eight series —
**PUR** purchase · **PAY** vendor payment · **EXP** expense · **VCH** cash
voucher · **CON** contract bill · **CAS** casual labour · **ADV** staff
advance · **RUN** payroll run. ADV and RUN arrive with payroll; the other
six are live.

**Call it on the TRANSACTION handle, never the pool.** `nextDocNo`
(`src/server/doc-numbers.ts`) takes `tx` as its first argument for exactly
this reason: the number and the row it numbers commit or roll back
together. Allocating before `sql.begin` would burn a number on every failed
save, and a hole in a numbered series is precisely what an auditor asks
about. `recordPayment` was rewritten to open a transaction it did not
previously need — that is why.

The FY label is the other half of every number and it is a SETTING, not a
constant: `settings.fy_start_month`, 1–12. April is India, July is
Australia, October is the US federal year, January is most of the rest.
`src/lib/fy.ts` is pure so it can be asserted by value, and it is — for
four different start months, in `smoke:a2`. The label is always four
characters so numbers stay aligned in a column: a year that SPANS two
calendar years wears both (`2627`), a year that IS a calendar year wears
itself (`2026`). **A missing or malformed setting falls back to January,
never April** — defaulting to April would hardcode one country's tax law
in the very place the setting exists to avoid it.

**A void keeps its number; the reversal takes its own.** Never reused,
never renumbered. A document number is what a question names months later,
so it has to mean exactly one thing forever — including when that thing was
a mistake. Every reversal written as `insert … select … from <table>` puts
its new number in as a LITERAL in the select list; copying `doc_no` along
with the rest of the row is the failure this rule exists to prevent.

`doc_no` is nullable because rows predate the numbering. Nothing is
backfilled and nothing is rewritten; an unnumbered row shows a dash.

Guarded in `smoke:a2`: the FY label by value for start months 1/4/7/10 and
for the fallback; `next_doc_no` handing out a sequential, non-repeating
series; a ROLLED-BACK draw consuming no number; and — statically, over all
of `src/server` — every `insert into` one of the six numbered tables
carrying `doc_no` in its column list, with at least as many `nextDocNo`
calls as there are numbered insert sites, so a reversal cannot be quietly
wearing someone else's number.

**Found while building it, and fixed here because Commit 1 made it
material:** the three void paths in `expenses-actions.ts` did not copy the
original's `account_id`. `money_movements` negates a reversal too, so a
void that named no account left the ORIGINAL account permanently short by
the amount, with nothing on screen to say so. Voids now copy `account_id`
EXACTLY — the same discipline as `unit_cost` on issue voids. Guarded twice
in `smoke:a2`: a rolled-back probe asserting a voided expense nets its
account back to zero across two `money_movements` rows, and the static
sweep now requires `account_id` on every insert into the five accounted
tables (all the numbered ones except `purchases` — a purchase is a
liability, the PAYMENT is the money).

**Known and deliberately not fixed here:** `voidContractBill` and
`voidCasualLabour` still read the original row and run the already-voided
guard on the pooled `sql`, OUTSIDE their transaction — a TOCTOU race that
`voidExpense` does not have. The doc-number law is still satisfied (the
number is allocated on the same tx as the insert it numbers). Pre-existing,
unrelated to this commit, and moving those boundaries is exactly where a
regression would hide.

### Commit 3 — the query loop

**The most valuable thing in this phase, and it is one rule.** Real
accountants send a list of questions at month end, usually over WhatsApp,
where they get lost. This puts the list in the data — and then makes it
matter:

**A PERIOD CANNOT CLOSE WHILE A QUERY IS OPEN.** Without that, a query is a
comment box: someone types a question, nobody answers, the month closes
anyway and the question was decoration. With it, the month is the deadline,
and the deadline is what makes anyone reply. `closePeriod` counts the
blockers rather than waving vaguely — a number is something you can finish
— and re-reads them INSIDE its advisory lock, so a query raised while the
form was open still stops the close.

**Answered is not resolved.** `queries.status` is open → answered →
resolved, and `closePeriod` blocks on anything that is not resolved. The
accountant asked the question, so the accountant decides whether the answer
settles it; closing around an unread answer is the same as never asking.
Both halves stay on the record forever — in a month's time the answer is
the only thing that explains the number.

Three roles, three verbs. The ACCOUNTANT raises and resolves. The ASSIGNED
ROLE answers, because they are the hands that touched the money — plus
manager and owner, who may answer anything, because a loop that stalls on
one person's day off is a loop nobody uses. `queries.assigned_role`'s CHECK
excludes the accountant deliberately: they ask, they do not answer.
`ASSIGNABLE_ROLES` mirrors it and `smoke:a2` asserts the database refuses
the other case.

**The sixth role.** `accountant` joins the matrix and `/accounts` joins the
groups — Review and Close now, the rest of the registers with the rest of
the accountant phase. They have exactly one group, so `/` sends them
straight in and they never see a chooser: they work from home and their
screen is a QUEUE, not a form. `ALL_ROLES` is read by the proxy, the user
admin and `auth-core` alike, so the role needed no edits in any of them —
that is the matrix being one source, as designed. The owner is in
`/accounts` too, because someone must be able to work the loop before
there is an accountant to work it.

The queue's other half is `<MyQueriesPanel />` on the kitchen, store, sales
and owner homes — what the accountant is asking THIS role, on the screen
they already open every morning. It renders NOTHING when nothing is asked;
a permanent "Questions: 0" is a thing to read and dismiss every day, and
absence says the same thing more quietly.

`entity_id` is nullable on purpose and the UI honours it: half of a real
month-end list is "why was Tuesday short?", which has no single row behind
it. `src/lib/query-entities.ts` is a KEY REGISTRY like `tabs.ts` —
structural, not a business list, so a settings row can never invent one
and point a question at nothing. Picking what a query is about SUGGESTS who
answers; it never decides.

**Deliberately not built here:** raising a query FROM a record. The
accountant reaches records through the registers, and the registers are the
next commit; a half-wired deep link now would be a worse answer than the
entity picker.

### Commit 4 — the accountant's group

Seven tabs, all under `/accounts`: **Review · Registers · Parties · Tax ·
Money · Close · Export.**

**Registers are ONE table, seven times.** date · doc · party · narration ·
debit · credit, totalled at the foot, with the view it came from named
under the title. That shape is not a design choice — it is the shape every
accountant on earth already reads, and the app's contribution is putting
the right rows under the right word. One route (`registers/[key]`) serves
all seven, because seven pages would have been seven chances to drift
apart. Sources: `purchase_register`, `sales_register`, and `money_movements`
filtered by kind (payment · expense · wages) or by ACCOUNT KIND (cash ·
bank). The wages register unions casual labour, contract bills and staff
advances: the five money-out tables are an artefact of porting the sheets
one tab at a time, and the register is where that artefact must not show.

**Export is generic tabular, deliberately.** Every accounting package on
earth takes a CSV and none of them agree on anything more specific;
Tally/Zoho/QuickBooks layouts arrive as configuration the restaurant
chooses, never as an assumption about which software they bought. Numbers
go out UNFORMATTED — ₹1,04,500.00 is a string to every one of them. Two
details in `src/lib/csv.ts` that are not fussiness: a leading `=`, `+`, `-`
or `@` makes Excel treat a cell as a FORMULA (a vendor called "-Sons
Traders" would execute), so those are prefixed; and the BOM makes Excel
read UTF-8 instead of mangling every rupee sign. Both are asserted.

**The one tax assumption, made configurable.** `settings.input_tax_creditable`
— anything but the exact string `'true'` means input tax is a COST, which
is the conservative reading and the only one safe in a country nobody has
configured yet. The Tax screen STATES which way it is set rather than
quietly assuming, and offers the toggle. **The screen never prints a net
tax payable figure**: output minus input is a filing position, and this app
does not take filing positions.

**Withholdings: record what was withheld, NEVER compute a rate.** This is
the phase's global rule in one function. TDS in India, PAYG withholding in
Australia, backup withholding in the US — every country has the shape
(someone kept part of a payment and owes it to a revenue authority) and no
two agree on rates, thresholds or codes. The form takes the amount paid and
the amount withheld; `rate_pct` is DERIVED server-side for display from
those two, and is not an input. If it were, the next question would be
"which rate applies?", and answering that is filing advice. `regime_code`
is free text the customer names, never a dropdown of one country's
sections. The only UPDATE grant is deposited_on / challan_ref / note — the
amounts are what was withheld and never move.

**The staff fund is a LIABILITY, not income** — collected on behalf of the
staff, less what has been handed to them. The local word may be "service
charge" or "tips"; the shape is identical, so `source` is a free-text
column rather than a concept in the schema. A distribution moves real
money, so it names its account like every other payment.

**Bank payments follow the hands.** `/accounts/money` carries a Pay-a-vendor
form calling the SAME `recordPayment` as the store's — one action, one
`payments` table, one PAY series. Two screens exist because two people are
in two places, not because there are two kinds of payment: the store
manager hands cash to a vegetable vendor at the door and records that; the
accountant makes the transfer at eleven at night and records this.

**Opening balances** are on the money-account master, and the accountant is
admitted to `/owner/accounts` rather than given a second copy of the same
master. The owner tab strip filters to that single tab on its own, which is
LAW 1 doing its job rather than a special case.

**NOT BUILT, and the screen says so: reconciliation.** There is no
reconciliation table in the schema — nothing can record that a statement
line was matched. `/accounts/money` therefore carries an honesty strip
saying that comparing a bank statement against these movements needs a
table to remember what was matched, and until it exists the balances shown
are what the app knows rather than what the bank confirms. No fake UI, no
local-only state. **The migration it needs is the one thing this commit is
missing** — say so rather than shipping a button that forgets.

Gated in `smoke:a2`: all seven registers executed against the live database
with a debit-XOR-credit assertion on every row (both sides filled would
double the totals); every `money_movements.kind` claimed by exactly one
register, so money can never appear in none; the CSV formula and BOM
guards; the input-tax setting defaulting to cost; and — statically — that
**every exported accountant action calls the role gate**, because a server
action is a public endpoint and the route gate is not the check.

**Two things the verify pass caught, both the same fault:** a column of
zeroes reading as good news. The Parties screen showed every delivery
partner at ₹0.00 outstanding when the truth was that nothing has arrived to
compare, and the Tax screen showed "collected on sales ₹0.00" when no POS
day had been fetched. Both now wear an honesty strip instead. **A sum over
no rows is not a zero**, and the difference is the whole product.

**Printing was carrying the app chrome.** The vendor statement is the one
screen in this app genuinely printed — vendors ask for their account on
paper — and the nav and tab strip came out across the top of it. `globals.css`
now has a print block keyed on `nav` and `data-chrome="true"`, written as
"app furniture does not print" rather than "this page hides these three
things", so the next printable screen inherits it.

**The schema gate cried wolf once and was fixed rather than worked around.**
`trim(BOTH ' · ' FROM x)` reads as a bare identifier to a word-level
scanner, so `both` was reported as a missing column. `both`/`leading`/
`trailing` joined the keyword set; the `--self-test` still catches the
`pnl_monthly.revenue` regression it was written for. A gate that cries wolf
is a gate people start ignoring.

### Commit 5 — payroll

**The earlier objection is withdrawn, and why matters.** Rajesh's Labour
sheet paid 34 days in a 30-day month because it summed days worked PLUS
weekly offs with no cap. Attendance here is one row per person per day with
the latest winning (`attendance_current`), so it cannot recur — and
`payroll_lines` carries `CHECK (days_paid <= days_in_period)` saying so out
loud. That constraint is the reason payroll is buildable now and was not
before, and `smoke:a2` asserts the DATABASE refuses 34-in-30 rather than
trusting whoever writes the next form.

**Three hands, and the split is the control.** The MANAGER marks attendance
(operational, daily — already built). The ACCOUNTANT prepares the run
(financial, monthly). The OWNER approves before anybody is paid. `draft →
approved → paid`, with `cancelled` as the escape and no shortcut between
them. `approvePayrollRun` takes `actor(['owner'])` — an accountant who
happens to also be the owner signs in as the owner, and the record then says
an owner approved it. LAW 1 hides the Approve button from everyone else and
tells them in words who signs it off.

**THE FREEZE IS A GRANT, NOT POLITENESS.** `payroll_lines` has UPDATE on
exactly `account_id`, `note`, `paid_on`, `pay_mode` — no amount is
updatable, by anybody, ever. So the accountant edits a computed DRAFT that
is not stored, and pressing Prepare writes those figures permanently; a
mistake is fixed by CANCELLING the run and preparing another, and both stay
on the record. `smoke:a2` asserts that grant list by value: if it ever
grows, a run became editable, and a decision that can be quietly edited
afterwards is not a decision.

**The pay law is read from the database, not restated.** present = 1 ·
half = 0.5 · off = 1 (off is PAID, a stated assumption) · leave and absent =
0, over the real days of the period, contract staff excluded because they
are billed by their vendor. `labour_cost_by_section` has applied exactly
that since phase 5, and the draft reproduces it verbatim — if the two ever
disagreed, the wage slip and the P&L would state different labour for the
same month. The gate asserts both the arithmetic and that the view still
says `WHEN 'off' THEN 1` and still excludes contract.

**No rate is ever computed.** No PF, no ESI, no filing, and `smoke:a2`
greps for the constants to prove it. Statutory rates change by notification,
differ by state and differ entirely outside this country; a wrong one
computed confidently is worse than no figure at all. `withholding` on a
line is a TYPED figure — what was withheld — exactly as on the Tax screen.

**A paid run does not reach the cash or bank register, and the screen says
so.** `money_movements` does not read `payroll_lines`; advances DO appear
there because `staff_advances` is in that view. That is the schema's
decision rather than the action's, and an accountant should learn it on the
run page rather than while reconciling.

**The identifier block arrives now because real auth exists** — bank,
account, IFSC, UPI, PAN, UAN, PF, ESIC, date of birth, gender, on
`/accounts/payroll/people`. **Owner and accountant only, never the
manager**: the manager marks attendance and has no reason to hold anybody's
bank account number or date of birth, which is the whole of data protection
in one sentence. Phase 5 refused to collect these for exactly this reason —
the form must not ask for what the app cannot yet protect. Labels use the
local names because they are the column names, but nothing validates a
format, masks a field or offers a fixed list of genders: every one of those
would bake in one country.

**Found and fixed while building payroll, and it was repo-wide:**
`parseMoney` capped at FIVE integer digits — ₹99,999.99 — while every server
regex allowed seven digits or more. So a ₹1,00,000 vendor payment, payroll
advance or staff-fund payout left the save button disabled with **nothing on
screen saying why**. A client stricter than its server is the worst of both:
the entry is refused and the refusal is silent. Now nine digits, which keeps
the result a safe integer; `parseQty` stays at five, because a count of a
thing is not a sum of money. Asserted by value.

**The verify pass caught four more of the same family**, each a figure that
read as good news: an empty run printing six confident ₹0.00 totals; a
bookmarked `?from=2026-02-31` reaching Postgres and 500-ing the page; the
period-clash refusal arriving AFTER a month of overtime had been keyed in
(the same shape as "issue autofill lands nowhere"); and an over-recovered
advance rendering as "already owes −₹500". All four are words now.

**The schema gate earned its keep a second time this phase.** It flagged
`a.total` on `attendance_current` in the payroll draft — a real alias
collision, `a` bound to both the attendance table inside a CTE and the
advances CTE outside it. Confusing to a reader and unresolvable to the gate,
so the alias was renamed rather than the gate taught to ignore it.

## Migration 0016 — reconciliation, the till, and payroll in the register

`reconciliation_and_payroll_reaches_the_register` landed AFTER the Phase C
code was written, so this pass teaches the app about it. Three of the four
changes are deletions of things the app was honestly saying and no longer
needs to.

**`money_accounts.is_till`, and the till's balance is COUNTED.**
`account_balances` gained `basis` / `counted_on` / `is_till`: for a till
with a day close behind it the balance is the cashier's **counted cash**,
not opening + movements. That is the right answer — the drawer is the one
account somebody physically counts every night — and the screens now say
which kind of figure they are showing: "counted 11 Aug" against
"computed". A balance you can check against a hand of notes and a balance
derived from arithmetic are different claims, and reading them as the same
number is how a shortage hides.

**ONE till, refused by name.** `account_balances` joins `day_close_current`
per RESTAURANT rather than per account, so a second till would silently
wear the same counted cash as the first and two accounts would each claim
to hold the whole drawer. The refusal is at both write paths and the gate
asserts at most one exists. The tick only appears on a cash account.

**Payroll reaches `money_movements`** when a line has `paid_on`, as kind
`'Payroll'`. So the wages register carries it, the run's balance moves, and
the honesty strip that said otherwise is DELETED rather than reworded — the
gap it described is gone. `smoke:a2` asserts both directions: an UNPAID run
must not reach the register, a paid one must.

**`'Tax deposited'` also joined**, from `withholdings` with a
`deposited_on`. It has a **NULL `account_id` by the view's design**, so it
can reach no cash or bank register and can never be reconciled against a
statement; the expense register is its only home, and it is claimed there
so the "every kind lands in exactly one register" gate still holds. Worth
knowing rather than discovering: a tax deposit shows in the books as an
outflow that belongs to no account.

**Reconciliation is built** — `statements`, `statement_lines`,
`reconciliation_matches` and the three views. **`reconciliation_matches`
has no DELETE grant, so a match cannot be undone**, and the screen says so
before the button rather than in a toast after it. `statement_self_check`
(opening + lines − closing) is stated when non-zero as a fact about the
STATEMENT, not about the books.

**A MATCH IS AN ASSERTION, NOT AN EVENT — the second DELETE exception.**
`reconciliation_matches` is deleted to unmatch, and that does not break the
append-only rule, it clarifies it. Every other table holds an EVENT: money
moved, goods arrived, somebody worked a day. An event cannot be made not to
have happened, so it is corrected with a reversal. A match holds a
JUDGEMENT — that this statement line and that movement are the same
transaction. A judgement that turns out to be wrong was never true, so
there is nothing to preserve and nothing to reverse; leaving it beside a
correction would assert two contradictory things at once and leave
`unmatched_lines` wrong forever. Same shape as the `recipe_lines`
exception: removing an ingredient from a card is editing a description, not
erasing history. See **"Editable, then frozen"** at the end of this file:
this is one instance of a general rule, not a special case.

*How this was got wrong:* the grant was checked in
`information_schema.column_privileges`, where DELETE — a TABLE privilege —
never appears. The screens were built saying a match was permanent. Check
`table_privileges` for DELETE and `column_privileges` for column-level
INSERT/UPDATE; they are different catalogues and only one of them can
answer this question.

**Two schema-level risks the verify pass found and did not paper over:**
`reconciliation_matches` has `UNIQUE(statement_line_id)` but NO unique index
on `(entity_type, entity_id)`, so two statement lines could be matched to
the same movement under READ COMMITTED — the server checks
`unmatched_movements` first, which narrows the window and cannot close it. A
unique index is the only real fix and it is a migration. Also
`withholdings.account_id` is nullable, so a challan deposited before that
column existed still carries none.

**`markWithholdingDeposited` now names an account** and refuses a blank like
every other money form — a deposit is money leaving a real account today.
Before the column existed, `money_movements` read a hardcoded null for
these: a deposited challan could never be reconciled and sat in the
unaccounted count forever.

**The empty state on the nine account-refusing forms is a ROUTE OUT.**
`money_accounts` starts empty in every restaurant, so on the day this
shipped nobody could record a payment, voucher, other income, contract
bill, casual labour, settlement or bank-settled close. That is correct
behaviour and it reads as the app being broken — a refusal with no next
step IS broken. One picker serves all nine, so the sentence lives in one
place: what is missing, who creates it, and both routes to it. **The link
is a PROP, never a literal**, because `/owner/accounts` is owner-and-
accountant only and a cashier shown a link they cannot open is LAW 1 broken
in the smallest possible way.

**The day close needed its own answer.** Its picker appears only once a bank
amount is typed, so a cashier would key the figure and only then find the
close would not save. It now speaks before the box — and says the important
part: an empty bank block names no account, so **the nightly cash close is
never held up by this**.

## The indent gap, and where value belongs

**THE GAP IS WORDS, NOT A SIGN.** "Short 0.5 kg" in red, "Extra 2 kg" in
amber, nothing at all when they match. A signed number asks the reader to
hold a convention in their head — is −2 two short or two extra? — and
`indent_fulfilment` computes `qty_given − qty_requested`, so negative means
short, which is the opposite of how a person says it out loud. That
convention had ALREADY inverted against the view: the page coloured
`gap > 0` red and printed a minus in front of it, so after the migration it
was calling an over-issue a shortage. Colour never carries the meaning
alone; the word does and the colour agrees with it.

**A cancelled indent has NO gap.** The view returns NULL for both
`qty_given` and `gap` when the status is cancelled — a request nobody was
ever going to fill has no shortage — and `getIndentFulfilment` was
COALESCING both away, which is precisely the dash that reads as zero. The
query now passes the NULL through and the cell says "cancelled".

**QUANTITY ON THE INDENT, VALUE ON THE DASHBOARD.** The indent form stays
purely in quantities on purpose: at the moment of asking for onions, a rupee
figure invites the chef to trim the request to look good rather than ask for
what the menu needs. The chef IS accountable for what their departments
consumed at month end, so `section_consumption_daily` (per department, per
session, per day, net of returns) is on the kitchen dashboard and the store
dashboard — after the asking, where it informs a conversation instead of
distorting a request.

**The schema gate learned about SQL comments.** `-- a zero here would read
as "asked and got nothing"` is valid SQL and a legitimate place to explain a
query, but every word in it looked like a column: it reported `read` and
`got` as missing on `indent_fulfilment`. Line and block comments are now
stripped before the string literals, so a quote inside a comment cannot
unbalance the next step. The `--self-test` still catches the
`pnl_monthly.revenue` regression.

## Editable, then frozen — the rule the exception list was hiding

This replaces the growing list of "DELETE exceptions". There is one rule:

> **A record is editable only while it asserts an INTENTION and nothing
> depends on it yet. Once anything reads it as history, it freezes, and
> corrections become reversals.**

Every event table holds OCCURRENCES — money moved, goods arrived, somebody
worked a day — and an occurrence cannot be made not to have happened. Those
stay append-only forever. The editable few are not exceptions to that; they
are a different kind of record:

| Record | What it asserts | Frozen by |
|---|---|---|
| `recipe_lines` | what a dish is made of | nothing — a card is always a description |
| `reconciliation_matches` | a human's judgement that two rows are one transaction | nothing — a wrong judgement was never true |
| `indent_lines`, open `indents` | what a department is asking for | an issue carrying that `indent_id` |

The indent is the clearest case because it does both. While it is open,
changing it is editing a request nobody has acted on. The instant an issue
stamps its `indent_id`, the asked-vs-given GAP acquires meaning — and
editing the ask afterwards would rewrite that gap retroactively, which is
the one thing the whole indent loop exists to prevent. So: editable while
`status = 'open'` AND no issue links to it; frozen otherwise, with the
reason said in words (an issue was made against it, or it was cancelled —
those are different sentences).

**The freeze is checked INSIDE the transaction**, not on the page and not
before the lock: an issue filed while the edit form was open must still
stop the save. The grants permit more than the rule allows, and that is
deliberate — the database cannot know whether an issue exists yet, so the
rule lives in code and a test holds it there.

Same shape as draft → approved payroll, and as a statement line that has
been matched. When adding a table, ask which kind it is: does this row say
what someone MEANS to do, or what someone DID?

## Who can receive stock

`sections.receives_stock` — 12 of the 16 org units. **Store, Accounts,
Valet and Security cannot**: the store issuing to itself is not a movement,
and the other three consume nothing the store holds. The picker was
offering all sixteen, which is the same class of bug as the dish picker
offering Security, and it let stock be issued from the store to the store.

`getSections` is now the ISSUABLE list and `getAllSections` is everything.
Choosing wrongly between them breaks in the opposite direction: **a staff
posting and casual labour must see every department**, because a guard is
posted to Security and a day hand can unload for Valet. Three screens were
switched to `getAllSections` for exactly that reason.

**THE PICKER IS NOT THE CHECK.** `saveIssue` refuses a non-receiving
department by name on BOTH the issue and the return path — stock cannot
come back from a department it could never have gone to. A form can always
be posted to directly; the filter is a courtesy to the person, the refusal
is the rule.

Unlike `code` and `dept_group`, `receives_stock` CAN change — a department
starts consuming, or stops — so it is editable on the Departments screen
beside `codes_dishes`, and the row shows "no stock" for the four, because
the absence is the interesting case.

## Editing an open indent, and the checklist that could not be finished

**The indent is the clearest instance of "editable, then frozen".** Editable
while `status = 'open'` AND no issue carries its `indent_id`; frozen the
instant one does, because the asked-vs-given GAP acquires meaning and
editing the ask afterwards would rewrite it retroactively. The freeze is
re-read INSIDE the transaction, so an issue filed while the edit form was
open still stops the save. Three of the four test indents were cancelled
because cancel-and-recreate was the only correction available; that is what
this fixes.

**A line cannot change which item it asks for.** There is no UPDATE grant on
`indent_lines.item_id`, so moving an item is a delete plus an insert — and
the action refuses it by name rather than updating the quantity and leaving
the old item on the row, which is what it did before the verify pass caught
it.

**`IndentRow.session` was declared and never selected**, so `indent.session`
was `undefined` everywhere it was read. Found while wiring the editor.

**The daily checklist is gone, replaced by open indents.** "1 of 16
entered" could never be honestly completed: a zero beside Bakery cannot
distinguish "took nothing today" from "nobody wrote it down", so the only
way to finish the list was to issue stock to a department that did not want
any. **A list that cannot be completed is a list people stop reading.** An
open indent is finite, actionable, and belongs to a person who is waiting.

## Every tab click cost two round trips

Thirteen chip parents redirected to their first child — `/store/receive` →
`/store/receive/purchase` — so every tab click was one request to be told
where to go and another to go there. They render the child directly now,
one implementation, no drift. `dynamic` is declared locally rather than
re-exported, because Next parses that field statically and refuses to
follow it through a re-export; `/accounts/registers` supplies the default
`key` because its child is a dynamic route and a bare re-export would
arrive with none.

`ChipRow` marks the FIRST chip active at the parent URL — without that the
screen arrives with nothing selected and the row reads as broken.

**`/kitchen/shift` was worse than slow: it was wrong.** It redirected to
`/kitchen/shift/production`, which stopped existing when production moved
out of the shift segment, so the retired-URL shim caught it and sent the
user to `/kitchen/production` — clicking "End of shift" landed on
Production, two hops away. It renders Closing now.

**Fonts: 223.8 KB of preloaded font became 102.9 KB.** Noto Sans Telugu is
120.9 KB and exists for the Telugu labels on five staff-facing forms; it is
`preload: false` now, so it is fetched when a page actually renders Telugu
rather than on the login screen of every device. It stays in the stack, so
those labels are still words and never tofu. Archivo is pinned to 600/700 —
the only weights the display face is ever asked for — instead of shipping
every weight from 100 to 900 as a variable font.

## The count corrects the book — but only when somebody accepts it

**ACCEPTING A VARIANCE IS A JUDGEMENT, NOT A CONSEQUENCE.** A variance can
be a counting error as easily as a stock error, so auto-correcting the book
from a bad count would corrupt the very number the count exists to protect.
The count RECORDS the variance and changes nothing; `acceptCount` is a
separate, deliberate act that writes `stock_adjustments` rows carrying
`count_id` and a reason. `stock_counts.accepted_at` has no default and is
nullable, and the only columns `kb_app` may update on a count are its two
acceptance fields — a count cannot accept itself.

**An unaccepted count is loud.** Leave one and the same variance reappears
at the next count with nobody knowing why.

**The correction is COMPUTED LIVE; the variance stays PHOTOGRAPHED.**

    adjustment = counted − frozen book
                 − everything already corrected for that item since this
                   count was frozen

A count freezes `book_qty` at save and an adjustment is a DIFFERENCE rather
than a new total, so two counts taken while neither was accepted both
measure against the same uncorrected book. Book 10, shelf 7, counted twice:
the first acceptance writes 7−10−0 = −3 and the book becomes 7; the second
writes 7−10−(−3) = 0 and the book stays 7. **Correct in either order**, and
a standalone adjustment made in between is absorbed the same way.
`variance_qty` is untouched and still reads as what the shelf disagreed with
on the day — only the correction moves.

The comparison is `>=` on `created_at`, excluding the count's own rows,
because `created_at` defaults to `now()` — the TRANSACTION timestamp, which
does not advance within one. Production never writes two counts in one
transaction, but a rule that depends on that is a rule waiting to be wrong.

The warning about other waiting counts stays, as information. It no longer
carries the weight.

**Opening stock is an explicit flow, in this order:** set `items.opening_rate`
→ count against the empty book → accept. The order matters and the screen
says why — `stock_count_lines.unit_cost` freezes from `item_costs.issue_cost`,
which is NULL for an item with no purchases, so counting before the rate is
set values the opening stock at ZERO and the books start wrong.

The first count on an established book absorbs months of missing-bill drift
into one large adjustment. The reason is required and the thin-history
banner stays loud: this will not find theft, it will absorb whatever was
never entered.

## Shorts, and returns to the vendor

**`purchase_lines.qty` still means WHAT ARRIVED.** That is why a short is its
own table rather than a second quantity on the line: stock, costs and COGS
all stay correct, and `stock_on_hand` deliberately does not read
`purchase_line_shorts`. The short is recorded beside the line.

`settlement` is `open | credit_note | replaced | absorbed`, and **open is the
one to surface** — a short nobody chased is a different fact from one that
was credited. `vendor_performance` turns the same events into the question
a store manager actually asks about a supplier.

**A `CHECK (qty > 0)` ON A LINE TABLE MEANS THAT TABLE CAN NEVER USE THE
NEGATIVE-TWIN VOID.** That is the rule; the two instances below are only how
it was found.

Every other correction in this app is a negative twin — a reversal row
carrying the same figures with the sign flipped. A line table that refuses
negative quantities cannot do that: the negation has to go somewhere else,
usually the rate, which reverses the MONEY and not the GOODS. So the
reversal is marked on the PARENT, and **every view reading that line table
must filter on the parent's reversal state** — no `reverses_id`, and not
itself reversed — exactly as `bills.is_voided` has always done for
purchases.

Both `vendor_return_lines` and `return_lines` carry that CHECK, and neither
view filtered. Voiding a vendor return took the quantity off TWICE — 18.5
on hand, a return of 10 leaving 8.5, and the void leaving **−1.5**. The
kitchen return had the identical fault in the opposite direction and nobody
had tried it. `stock_on_hand` and both `section_consumption` views now
filter, and `smoke:a2` walks a return and its void through BOTH tables and
asserts the shelf ends where it started.

The interim answer, while the views were wrong, was to REFUSE the void and
say why: a void that corrupts the book is worse than no void. Writing a
compensating `stock_adjustments` row would have hidden it and broken the
one-path rule — goods move through exactly one table. The gate that held
the refusal in place was written to FAIL once the view was fixed, which is
how the refusal came back out on the same day the migration landed.

## SETTINGS CONFIGURE VOCABULARY AND LOCAL RULES; THEY NEVER CONFIGURE INTEGRITY

The owner already controls Lists, Departments, Tabs, Users, Partners, Money
accounts, Course targets, the financial year and the input-tax treatment.
**That is enough. Do not add more.**

A restaurant's WORDS are theirs: category names, department names, list
values, tab order and labels, account names, partner rates, which month the
year starts, whether input tax is a credit or a cost. Those differ
legitimately between two honest restaurants, and between two countries.

What a NUMBER MEANS is not theirs, and must never become a setting:

- whether a comp counts as revenue
- whether a day can close out of order
- whether a count corrects the book, or whether accepting is a judgement
- whether an event can be edited
- what goes inside cost of goods
- whether an unassessable card may report itself as fine

**The test: if a setting could make two restaurants' food cost percentages
mean different things, it must not exist.** At that point the product has no
opinion, and its opinion is the whole value — a configurable ledger is a
spreadsheet with extra steps, which is the thing this replaced.

**Prefer configuring IN THE FLOW to a control panel.** An expense category
takes its controllable/occupancy kind at the moment somebody approves it,
not on a settings screen nobody opens; a department's `receives_stock` sits
on the department, beside its name. A wall of toggles is the console this
product exists to avoid, and every toggle on it is a decision the product
declined to make.

## A card declares its precondition before it reports its finding

A card is not pass/fail. It is pass, fail, or **CANNOT BE ASSESSED**, and
the third state is as visible as the other two, because "we do not know" is
a finding rather than the absence of one.

The owner dashboard said, correctly and well, that no sales day had been
fetched — and four cards below it then reported clean bills of health that
all rested on exactly that missing data: every day that sold food has its
cash counted (over no days), every order carries a known status (over no
orders), everything sold is mapped to a dish (over nothing sold), and South
Indian costs more than it earns (a missing denominator reported as a
business problem). Each was individually defensible. Together they were a
lie, and the ordering compounded it: unassessable cards ranked as clean and
pushed real findings down the page.

`src/lib/precondition.ts` holds the vocabulary. An unassessable card takes
`UNASSESSABLE_URGENCY` — above everything genuinely fine, because not
knowing is worse than knowing it is well; below every real finding, because
a thing that is actually wrong beats a thing that is merely unmeasured.

**Diagnostics live where they are READ, not where they are fixed.**
`books_completeness` told the accountant there were days with sales and no
cash close; the cashier — the only person who can close them — saw nothing.
The same fact now reaches both, phrased for each: the accountant's Review is
the reviewer's copy, and the person who can act sees it on the screen they
already open.

## One question, three answers — the voucher's kind

"Was this stock for the kitchen?" and "Was this a day hand's wages?" were
two independent toggles, and **both could be Yes** — putting one amount
inside cost of goods AND on the labour line, the same rupee in two totals
with nothing on screen looking wrong. They were never independent: a payment
is one kind of thing. It is one three-way question now — an expense, goods
for the kitchen, or a day hand — so the exclusivity is structural rather
than a rule somebody has to remember, and `saveVoucher` refuses both flags
by name, because a form is never the check.

## Before dropping a tab, check whether its view is mounted twice

The test, and it is a test rather than an opinion:

> **If the same component is mounted twice, one mount is duplication by
> definition.** Removing it is provable, not judged.

`SectionsView` is one file. It was mounted at `/kitchen/books/sections`,
`/staff/books/sections` AND behind the Kitchen group's own **Departments**
tab — three doors to one screen. Two of them could be deleted without
argument, because nothing was lost that the third did not already show.
That is different from "this tab feels redundant", which is a judgement and
needs a conversation.

So the order is: find the component a tab renders; grep for every place it
is mounted; if there is more than one, the surplus mounts are the answer.
Only when a tab renders something mounted exactly once does the question
become a design decision — and then it stays until somebody says otherwise,
because losing a route somebody uses costs more than carrying a tab
somebody does not.

**Applied here — and the test caught me getting it wrong first.** I read
`SectionsView` mounted at `/kitchen/books/sections` and `/staff/books/
sections` and ALSO assumed the Kitchen **Departments** tab was a third
mount, so I dropped both Books entries. It is not: Departments is the
section MASTER (rename, retire, receives-stock), while `SectionsView` is a
per-department COSTS report — sales, cost, margin. Dropping both deleted a
report nothing else shows.

The assertion is what found it: it counts live mounts and requires exactly
one, and it failed at **zero**. The duplication was real but it was between
the two Books entries, not with the tab. One survives, in the kitchen books,
where a chef and a manager can both reach it.

The lesson is narrower than the rule and worth keeping beside it: **grep for
the component, do not infer from the tab's label.** Two screens about
departments are not the same screen. `/store` and `/sales` Books kept every
entry — none is reachable from a tab in their own group, so they are reports
rather than second doors.

## Multi-tenancy — the one fault, and Phase 1.5

**ONE FAULT, NOT TWO.** `getRestaurant()` returned the OLDEST row in
`restaurants`, and `getSessionUser` matched on username alone. Neither is
harmless on its own and together they are not two bugs but one sentence:

> **Anyone holding valid credentials for tenant #2 logs in and operates on
> tenant #1's books.** Reads and writes.

RLS fed from that source would have been worse than no RLS: it would have
looked secure and faithfully enforced the wrong tenant. **Order is not
negotiable — the source of truth is fixed first, the GUC second, RLS
third.**

### Phase 1.5, done

- `SessionPayload` carries `t`, the restaurant id, signed at login from the
  authenticated `app_users` row. `verifyCredentials` RESOLVES the tenant
  rather than being told it — it used to be handed one by a caller that got
  it from "the oldest row".
- `getSessionUser` matches the username, reads the tenant from that row, and
  **refuses when the cookie's `t` disagrees with it** — a stale claim about
  WHICH BOOKS is the one claim that must never be honoured. It also refuses
  when more than one row matches, which is the state the unique index will
  make impossible.
- `getRestaurant()` derives from the session. **`restaurantCache` is
  deleted and must not come back**: a module-level variable is process-wide
  across concurrent requests on the same Fluid Compute instance, so even a
  correct per-request lookup would have been poisoned by whoever asked
  first.
- **The no-session fallback is allowed to exist because it cannot be
  wrong.** Outside a request — smoke suites, build — it reads `limit 2` and
  answers only while the database holds exactly ONE restaurant; with two it
  refuses by name. A guess that cannot be wrong is not a guess.

### The writes are closed first

A cross-tenant WRITE corrupts another restaurant's workflow; a read merely
exposes it. Ten unscoped `UPDATE`s are now scoped, and a gate asserts every
`UPDATE` on a tenant table names its tenant. **The worst was
`updateUser`** — `where id = ${userId}` with no tenant, on the table that
decides who may do anything at all: an owner of one restaurant could change
the role or status of another's user.

Two lessons from writing that gate, both about the instrument rather than
the code: flatten `${…}` holes before matching, because a `SET` list
containing ``sql`sort_order` `` carries a backtick that ends the match early
and reports a scoped statement as unscoped; and match a CHECK violation on
the CONSTRAINT name, since Postgres names the constraint and not the column
— `payroll_lines_check` never contains the string `days_paid`, so that
assertion had been passing only because there were no staff to test it
against.

### Still open

`audit:tenancy` reports **50** statements that read a tenant table and name
no tenant, down from 58. They are reads, and RLS will close them
wholesale — but the audit stays, and `--strict` becomes a gate once the
count reaches zero.

## The worst defect this project found

`updateUser` scoped by `id` alone — `where id = ${userId}`, no tenant — on
`app_users`, the one table that decides who may do anything at all. **One
restaurant's owner could change another restaurant's user's role or status.
Cross-tenant privilege escalation, silent, with no screen looking wrong.**

It is the reason `audit:tenancy` is a permanent gate and not a one-off
report. A single missing `and restaurant_id = …` is invisible while there is
one tenant, indistinguishable from correct code in review, and catastrophic
the day there are two. Only a machine reading every statement finds them
all.

## AN ASSERTION THAT CANNOT FAIL ON EMPTY DATA HAS NOT BEEN TESTED

The payroll CHECK assertion — "the database refuses more days paid than the
period holds" — had been passing since the day it was written **because
there were no staff rows to test it against**. The moment a real staff row
appeared on production it failed, and the failure was in the assertion, not
the database: Postgres names the CONSTRAINT in its error, and
`payroll_lines_check` never contains the string `days_paid`.

That is the **fifth** instance of a check structurally incapable of finding
what it exists to find:

| | What it could not see |
|---|---|
| `ensureLog_` on cell A3 | the sheet it was meant to guard |
| `git push -q` to a stale branch | that nothing was being pushed |
| `column_privileges` | DELETE, which is a TABLE privilege |
| `created_at` ties in one transaction | that `now()` does not advance |
| the payroll CHECK matcher | a constraint named for its table |

**The general form, now the rule: every gate must be run once against data
that ought to break it.** A green test over an empty set is not evidence;
it is the absence of evidence wearing a tick. Where the breaking data cannot
exist yet, the assertion should fail loudly rather than pass quietly — as
the vendor-return void gate did, written to fail the day the view was fixed.

## Phase 2(a) — the tenant is announced, and RLS is NOT yet safe to enable

`txn()` in `src/lib/db.ts` replaces every `sql.begin` (65 of them, gated so
none come back). It emits `set local app.restaurant_id` as the first
statement of every transaction. **`local` is not optional**: Supavisor runs
in TRANSACTION mode, so a plain `set` rides the connection back into the
pool and reaches whoever draws it next.

The tenant is resolved inside `txn` rather than demanded at 65 call sites —
an explicit `withTenant()` wins where one is in scope (background jobs,
provisioning), and otherwise the session answers, which covers every request
path including the POS fetch, since that runs inside a server action.
`AsyncLocalStorage`, never a module variable: that was the `restaurantCache`
bug, and ALS is exactly its fix.

`set local` takes no bind parameters, so the tenant is the ONE value
concatenated into SQL anywhere in this app. It is UUID-shape-checked first,
and a gate proves the checker refuses `' or 1=1 --`.

### THE BLOCKER, and it must be cleared before RLS goes on

**188 reads run outside any transaction** — plain ``await sql`select …` ``.
They carry no GUC, so under RLS `current_setting('app.restaurant_id', true)`
is NULL for them and every policy comparison yields NULL: **they return zero
rows, silently, across the whole app.** Enabling RLS today would not leak
data; it would take the product down while looking like an empty database.

Those reads must move inside a tenant-announcing transaction before Phase
2(b). That is the remaining work, and it is mechanical rather than
delicate.

### Every read now announces its tenant — RLS is safe to enable

`tsql` is `txn` for a single statement: one read, inside one transaction,
with `set local app.restaurant_id` first. Every read and every write in
`src/server` goes through it or through `txn`. **Zero bare statements
remain**, and two gates hold that: one fails if a bare `sql\`` reappears, one
fails if a `tsql` is ever nested inside a `txn()` callback — which would open
a transaction while holding a connection and wait for a second the first is
blocking, the `max: 4` deadlock in a new costume.

Both gates strip `${…}` holes first. A fragment — ``${cond ? sql`and x = ${y}`
: sql``}`` — is a VALUE interpolated into another statement, not a query, and
it always lives inside a hole.

Measured, not assumed: three concurrent page renders (24 reads) settle at
~305ms sustained, and 20 concurrent reads hold ~245ms over six rounds.

**Three things the sweep found that a grep would not have:**

1. **`getSessionUser` is the one read that cannot ask the session which
   tenant it is in, because it IS the session.** Left bare it returns zero
   rows under RLS and every user appears signed out; routed through `txn` it
   recurses, because `txn` resolves a null tenant by calling it. It now
   announces the COOKIE'S `t` claim and then checks the row agrees. That is
   not trusting the claim — the token is HMAC-signed so a forged `t` never
   gets that far, and the row's own `restaurant_id` is compared immediately
   after. **The claim narrows the read; the row decides.**

2. **Writes fail the same way as reads under RLS** and a read sweep
   correctly leaves them alone. Forty-two `update … returning id` and single
   inserts sat outside any transaction; with a NULL GUC they match zero rows
   and every call site reads that as absence — "Vendor not found", "User not
   found" — on every edit. Converted.

3. **`closeDay` re-read the close prefill from INSIDE its advisory lock**,
   which after the sweep meant a second transaction on a second connection
   while the first held one plus the lock. `getClosePrefill` now takes an
   optional handle so the caller lends its own `tx`. That removes the
   starvation path AND makes the comment literally true: the chain law is
   now re-checked in the same transaction as the write, not beside it.

## RLS went on and took the app down twice — the two failures, and the gates

Isolation now HOLDS, proved as `kb_app` with BYPASSRLS off: `npm run
smoke:tenancy`. Reads, writes and provisioning, against a stranger tenant,
all inside transactions that roll back. Testing this as `postgres` proves
nothing — that role bypasses every policy — so the test refuses to run at all
if it finds itself privileged.

**FAILURE 1 — nine multi-line saves broke silently.** Migration
`tenant_column_on_line_tables_and_unique_usernames` put a NOT NULL
`restaurant_id` on 15 line tables. Nine inserts never learned to fill it:
purchase lines, issue lines, return lines, indent lines (×2), kitchen closing
lines, POS lines, statement lines, settlement deductions, catering expenses.
Under RLS every one of them died on `new row violates row-level security
policy` — so every bill, issue, return, indent, closing and POS fetch refused
to save.

**Every gate stayed green through it**, and the reason is the lesson: the
smoke suites write their OWN sql, so they named the tenant exactly where the
app did not. **A probe that writes its own insert cannot test the app's
column list.** The column list lives in the source, so it is now checked in
the source — `audit:tenancy` gained a WRITE tier that reads the `${...}` hole
contents too, because `tx(rows, 'restaurant_id', …)` is where a dynamic
insert names its columns. Dropping the hole was how nine broken inserts read
as fine.

**FAILURE 2 — nobody could log in.** `/login` returned 500 for everyone.
Login runs BEFORE a session exists: it looks a username up to discover which
restaurant that person belongs to. With no tenant to announce, the policy
casts an empty `current_setting` to uuid and raises 22P02 — and `restaurants`
is RLS'd too, so there was nothing left to discover the tenant FROM.

`KB_TENANT` (Vercel + .env.local) now names the restaurant THIS DEPLOYMENT
serves, and `txn()` falls back to it when there is no ALS scope and no
session. That is a deployment fact, not a human's answer, so it is not the
`issues.session = 'Morning'` anti-pattern — it stands in for nothing anybody
was asked. **It does make LOGIN single-tenant**, and that is the thing to fix
before a second restaurant signs in: the permanent form is a SECURITY DEFINER
function resolving a username to its tenant across the pool. Authentication
crosses tenants BY DEFINITION — it is the one read that has to — and a
definer function is the narrow hole for it rather than a loosened policy.
Everything after login is scoped by the session, which is why the hole is one
lookup wide.

**`npm run audit:tenancy --strict` is the fifth gate, in three tiers:**

1. **WRITES** — every insert names the tenant; every update/delete says whose
   row it is. A HARD failure whatever the flags say: an insert with no tenant
   does not leak data, it loses it.
2. **READS** — scoped by `restaurant_id`, or KEYED by a uuid it was handed.
   A keyed read cannot be steered to another tenant's row by a URL because
   RLS makes that row invisible first. An UNKEYED read naming no tenant is
   the real leak. Currently 392 scoped, 57 keyed, 0 unkeyed.
3. **RLS ITSELF** — enabled, forced and policied on all 65 tenant tables.
   Tier 2's exemption rests on it, so it is asserted rather than assumed; if
   RLS is ever dropped from a table the gate says so on the same run.

**`npm run smoke:tenancy` is the sixth.** Its assertions are built to be
capable of failing: "a stranger saw 0 vendors" proves nothing about a table
holding 0 vendors, so each table is counted as ourselves first, and one that
is genuinely empty is printed as UNTESTED rather than counted as a pass.

**And the gate that had gutted itself.** `audit:schema` fell from 2088 column
references to 234 — still green, checking almost nothing — because renaming
every read `sql` → `tsql` for the GUC stopped its regex matching. Both audit
regexes now accept `tsql`, and both print their reference count so a collapse
is visible. That is the sixth instance in this project of a check
structurally incapable of finding what it exists to find, and the second time
it was the instrument enforcing that very rule.

**Scripts announce their tenant.** A script has no session; under RLS an
unannounced read raises rather than returning nothing (loud, which is right).
The smoke suites wrap in `withTenant(process.env.KB_TENANT)`, and their
probes use `txn`/`tsql` rather than `sql.begin`/`sql` so they exercise the
app's own path. The one deliberate exception is the check that `set local`
does not survive its transaction — that reads on the bare pool on purpose,
because `tsql` would announce the tenant itself and the assertion would pass
by causing the thing it tests for.

## THE BUSINESS DAY — a restaurant's day does not end at midnight

Migration `business_day_and_pos_order_time`. This is a CLASS of bug, not an
incident, and it is worth stating as one: **anywhere a system records "today",
it has assumed a definition of "day" that its users may not share.**

A restaurant serving past midnight has a day that ends at the cutover, not at
00:00. Petpooja already knew — it sends `business_date`, so a 00:30 order sits
on the previous night. Everything KitchenBooks recorded ITSELF defaulted to
the calendar date, so a cashier closing at 00:30 filed against the 12th while
the sales sat on the 11th, and `day_close_ladder` joined the drawer to the
wrong day's POS cash. Thrayam has orders at 00:04, 00:21 and 01:35 — this was
live, not theoretical, and it was wrong for about two hours every night.

**`business_date(timestamptz) -> date` takes NO restaurant argument, and that
is the security property.** `settings` is RLS'd, so it can only read the
tenant announced on the current transaction; passing an id would let one
tenant ask for another's day. It therefore MUST be called through `tsql`/`txn`
— on the bare pool there is no GUC and the settings read finds nothing.

**Both halves are settings because both vary by restaurant:** `timezone` and
`business_day_start`. A start of `00:00` makes the function a no-op, which is
the right answer for anywhere closing before midnight. This is the phase-C
global rule again — capture the shape, configure the local fact — and the gate
asserts the `00:00` case so the feature stays configurable rather than being
India with extra steps.

**One helper, and the wrong ones are DELETED.** `src/server/business-day.ts`
is the only way the app asks what day it is. `todayIST`, `monthStartIST`,
`yesterdayIST` and `todayLocal` are gone rather than left beside it: the
failure mode is the next person reaching for the shorter name, and the result
would be invisible except for two hours a night. `smoke:a2` greps the tree and
fails if any of those names comes back. **No date column in the schema carries
a DB default** — every date is supplied by the app — which is what makes an
app-side sweep sufficient.

**The client never computes the date.** `todayLocal()` read the BROWSER's
clock, which at 00:47 says tomorrow. The server resolves the day once per
request in each of the six group layouts and passes it through
`BusinessDayProvider`; `useBusinessDay()` THROWS outside a provider rather
than falling back to `new Date()`, because a silent fallback would reproduce
the exact bug at exactly the hour nobody is testing.

**Said out loud, once per group, only when it matters.** `<BusinessDayNote>`
renders in the group layout — so no future form can forget it — and renders
NOTHING while the business day equals the calendar day. Past midnight it says
which day the entries belong to and why, because the natural thing for a
cashier to do with a date field reading yesterday is to "correct" it.

**`order_time` is ADDITIVE and provably so.** The dedupe is `pos_order_id`
alone within a payload, and which fetch wins is `latest_fetches`
(`DISTINCT ON (restaurant_id, business_date) … ORDER BY fetched_at DESC`) —
there is no unique constraint on `(business_date, pos_order_id)` at all, only
the primary key on `id`. `order_time` appears in none of those, and the gate
asserts that neither view mentions it and that a duplicate id is still skipped
with the first occurrence still winning.

Petpooja sends a local wall-clock string with no offset. It is kept RAW in the
adapter and anchored in SQL against the same `timezone` setting; anchoring it
in JS would put a 00:30 order five and a half hours out — onto precisely the
day it does not belong to.

**An empty `business_day_disagreements` is not agreement.** The view can only
speak for orders that carried a time, so both surfaces — the accountant's
Review and the owner dashboard — say "none of the N orders carried a time"
rather than reporting a clean bill of health. The dashboard card uses
`requires()` and takes `UNASSESSABLE_URGENCY`, the same law as every other
card that cannot see its own precondition.

### ASSERT AT THE BOUNDARY — the other three cases pass while broken

The boundary assertion caught a real defect in its own probe, and the lesson
generalises. `${localAt}::timestamp at time zone …` let the driver infer the
parameter as `timestamptz`, so `at time zone` converted an already-anchored
instant a SECOND time. Of the four cases:

| local | double-converted result | correct | agrees? |
|---|---|---|---|
| 00:30 | 11th | 11th | yes — passes while broken |
| 04:59 | 11th | 11th | yes — passes while broken |
| **05:01** | **11th** | **12th** | **NO — the only case that catches it** |
| 14:00 | 12th | 12th | yes — passes while broken |

Three of four boundary cases are satisfied by the wrong answer. Casting
through `::text` first removes the inference. **A parameter's inferred type
can change the meaning of a timezone conversion**, and only a case that
straddles the cutover will ever say so.

**The schema gate cried wolf a second time, and was fixed rather than
blunted.** `at time zone` is an operator, and its three words read as columns.
They are stripped as a PHRASE rather than added to the keyword set — a table
may legitimately have a column called `time`, and blinding a gate to a real
name in order to silence a false positive is how a gate stops finding things.
Same reasoning as `both`/`leading`/`trailing`, opposite remedy.

**The tenancy gate was right about the settings read.** `businessDayContext`
read `settings` unscoped and worked only because RLS was on. A read that is
correct solely because a policy is switched on is invisible in review, so it
now names the tenant through `current_setting('app.restaurant_id')::uuid` —
explicit, at no extra round trip. Implicit scoping is not scoping.

## RUN THE FUNCTIONS WHERE THE DATABASE IS — and measure from where the user is

Clicking between pages took about a second each. The cause was geography, and
the reason it went unnoticed for weeks is a measurement taken in the wrong
place.

**Measured, not guessed.** Static assets and the proxy 307 bothreturn in ~110ms,
so the network to Vercel was never the problem. `/login` — which does ONE
database read — took 1.06–1.14s, steady across ten samples. About 950ms of
that was server side.

The functions ran in **iad1** (Washington DC). The Supabase pooler is
**ap-south-1** (Mumbai). That is ~200ms per round trip. And since the RLS
work, every read is a TRANSACTION rather than a statement — `BEGIN`,
`SET LOCAL app.restaurant_id`, the query, `COMMIT`.

Measured from a laptop in India:

| | per call | round trips |
|---|---|---|
| bare `` sql`select 1` `` | 41.9 ms | 1 |
| `` tsql`select 1` `` | 120.1 ms | **3** (2.87×) |
| 5 reads inside ONE `txn` | 240.2 ms | vs 600 ms as five `tsql` |

Three round trips per read is cheap next to the database and brutal across an
ocean: at a 200ms RTT the same single read costs **~600ms**. The users are in
India too, so every page crossed the planet twice — browser to Virginia,
Virginia to Mumbai once per read, and back.

`vercel.json` now pins `regions: ["bom1"]`, which fixes both legs at once.
`/login` went from **1.06s to 0.135s** steady — the server-side portion from
~950ms to ~35ms.

**THE LESSON, and it is the important part: a latency measurement taken next
to the database cannot see the cost that only exists 12,000 km away.** The
`tsql` conversion was benchmarked at "20 concurrent reads, ~245ms sustained"
and "three page renders, 24 reads, ~305ms" — from this laptop, 42ms from the
database, which is the one location on earth where a three-round-trip read
looks free. Production was 12,000 km further away and the same code was five
times slower per read. This belongs with the "an assertion that cannot fail
has not been tested" family: **a benchmark run in the wrong environment is not
evidence, it is a reading of a different system.** Benchmark from where the
code will run, or state the RTT the number assumes.

**Two things worth keeping, now that they are cheap rather than free.** A `txn`
holding five reads costs one transaction instead of five — 2.5× less — so a
genuinely hot path should batch reads into one `txn` rather than issuing five
`tsql`. And a page doing `Promise.all` over more than twelve queries exceeds
`max: 12` and queues; at ~6ms a read that no longer matters, but it is the
same fan-out that deadlocked the item master at `max: 4`.

**Cold starts remain**, and a fresh lambda was seen at 9.5s during the region
switchover. Warm requests are ~135ms. A restaurant app used in bursts will
meet a cold start occasionally; that is a separate question from this one and
has not been addressed.

## The owner and cashier dashboards were dead for five days

`/owner` and `/sales` returned 500 on every load from 11 August. Nobody
noticed because nobody opened them; the error surfaced the moment a browser
with a session actually loaded the page.

`getUnmappedSummary` filtered `unmapped_pos_items` on `business_date`. **That
view has never had a date column** — it groups per item across all time
(`restaurant_id, pos_item_id, item_name, qty, revenue`). Postgres answered
`42703 column "business_date" does not exist`, and since the query sat inside
the page's `Promise.all`, the whole dashboard fell over.

The fix reads the view's own base relations with the date filter added,
mirroring its `WHERE` exactly. The dashboard has ONE period control and every
card must answer for it, so an all-time figure among period-scoped ones was
not an option — that is a different lie from a crash. The duplication is
stated in a comment; the tidy fix is a view carrying `business_date`.

### THE SCHEMA GATE HAD NEVER READ A `WHERE` CLAUSE

This is the seventh instance of a check structurally incapable of finding what
it exists to find, and the worst of them, because the gate was written for
exactly this bug class and reported success while examining half of each
statement:

```js
const selectPart = clean.split(/\bfrom\b/i)[0] ?? ''   // everything BEFORE `from`
```

The unqualified pass scanned the select list only. Every `where`, `join … on`,
`group by` and `having` in the codebase went unchecked. It passed its own
`--self-test` because the `pnl_monthly.revenue` break it was written for
happened to live in a select list — **the self-test encoded the blind spot
rather than exposing it.**

Scanning the whole statement took the check from 2090 column references to
2567, about 23% more, and caught the live break on the first run. Relation
names and aliases are already in `byAlias`, so the `from` clause skips itself;
the only new false positive was `select … for update`, so the row-lock words
joined the keyword set.

**The rule this yields: a gate's self-test must be built from a case it would
have missed, not from the one that prompted it.** A regression test written
from the original bug proves only that the original bug is caught — and if the
instrument is narrow in the same direction the bug was, the test agrees with
it forever.

## Sweeping every route found two more, and both gates were looking in one place

A sweep of all 102 static routes as a signed-in owner: 84 clean, 17 legacy
shims correctly 307-ing to live targets, and **two real failures**.

**`/kitchen/departments` 500'd on every load** with `22P02 invalid input
syntax for type uuid: ""` — the RLS signature of a statement that announced
no tenant. It used a bare `sql` rather than `tsql`. So did
`/kitchen/indent/[id]`.

**Why the sweep that removed every bare read missed them: they are in
`src/app`, not `src/server`.** Every one of these instruments scanned only the
server layer, on the unexamined assumption that all SQL lives there:

| gate | scanned | missed |
|---|---|---|
| `audit:schema` | `walk('src/server')` | SQL written in a page |
| `audit:tenancy` | `walk('src/server')` | same |
| six `smoke:a2` static sweeps | `readdirSync('src/server')` flat, `.ts` only | `src/app`, every `.tsx`, and any subdirectory |

All of them now read `[...walk('src/server'), ...walk('src/app')]`, recursively,
`.ts` and `.tsx`. The rule: **a gate must scan wherever the thing it forbids
can be WRITTEN, not where it is expected to live.** Proved by reintroducing
the bare `sql` and watching the gate name the file and line.

**`/denied` was an infinite redirect loop.** The matrix fails closed on unknown
paths, which is right — but the proxy REDIRECTS to `/denied` on refusal, and
`/denied` is not in the matrix, so it denied itself: `/denied` → `canAccess`
false → redirect to `/denied` → forever. **Every genuine permission denial was
`ERR_TOO_MANY_REDIRECTS` instead of the sentence naming who to ask**, which is
the whole of LAW 1's promise. It is now admitted after the session check —
signed out still means go and sign in.

`audit:matrix` could never have caught this: it checks every LINK a role can
see, and nothing links to `/denied`. It is only ever a redirect target. So the
new assertion reads the redirect targets OUT OF THE PROXY SOURCE and requires
every role to be able to open each one — a new target is covered the day it is
written rather than the day someone remembers to list it.

**The general form, and it is the same shape as the schema gate's blind half:
a check scoped by where we EXPECT the fault cannot find the fault we did not
expect.** Three instruments, one assumption, two live 500s.
