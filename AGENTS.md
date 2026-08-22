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

## ONE STALE COOKIE TOOK THE APP DOWN — and it was the OOM all along

Rajesh could not use the app in Chrome; Safari, where he had logged in
freshly, was fine. Reproduced by minting a pre-Phase-1.5 token and presenting
it to production. The actual failure, not the expected one:

    verifySession on an OLD cookie:  returns null? false
                                     u=rajeshanne r=owner t=undefined
    /         500     806ms
    /login    500  192592ms      <-- three minutes, then dead
    /owner    500     730ms
    /kitchen  500     100ms

**`verifySession` checked `u`, `r` and `exp` — and not `t`.** Phase 1.5 added
the tenant claim to a payload already in circulation and never taught
verification to require it, so a v1 cookie VERIFIED and handed back a payload
whose tenant was `undefined`.

Then the loop: `withTenant(undefined)` stored undefined → `currentTenant()`
answered `undefined ?? null` = null → `txn` tried to resolve the tenant by
calling `getSessionUser()` → which called `withTenant(undefined)` again.
**Unbounded recursion**, 1.8 GB of heap, `FATAL ERROR: Ineffective
mark-compacts near heap limit`, SIGABRT, and 500 on EVERY route — including
`/login`, so the user could not sign out to escape it. The only exit was
clearing cookies by hand.

**This is the heap-OOM that was flagged as un-root-caused two sessions
running.** It was never a leak or a fan-out; it was one browser holding a v1
cookie, which is also why it appeared on `/` and `/login` and nowhere else.

**Fixed in four layers, because one would have been an instance and not a
class:**

1. **The payload is VERSIONED.** `SESSION_VERSION = 'v2'`, and a token of any
   other version is not a session — no attempt is made to interpret it.
   Bumping it is now the supported way to change the shape: every older cookie
   becomes a clean sign-out. v1 → v2 is "`t` became required".
2. **Every field is checked, not the ones that happened to exist when the
   check was written** — `u` and `r` non-empty, `t` UUID-shaped, `exp` finite.
   A field the type declares required is verified here, or the type is a
   comment.
3. **`withTenant` refuses a blank tenant loudly** rather than letting it decay
   into a null. A caller bug becomes one error, not an out-of-memory.
4. **`txn` cannot re-enter the session lookup.** An AsyncLocalStorage flag is
   set while `getSessionUser()` is resolving, so a read that still cannot name
   a tenant falls through to `KB_TENANT` instead of asking again. The loop is
   impossible rather than unlikely.

And the proxy **clears the cookie** when a token fails to verify. Leaving it
in the jar means the browser presents it again on every request for thirty
days, which is exactly how one stale cookie followed a user from page to page.
An unrecognised session must END as a sign-out.

**The rule: a payload that crosses a deploy boundary is a wire format.**
Adding a required field to one already in circulation is a breaking change,
and the old shape must be REJECTED rather than half-read. Anything else means
the field is optional in practice and required in the type — which is the gap
this fell through.

Guarded in `smoke:a2` four ways: a payload with no tenant is refused, so are
blank/malformed ones and payloads missing `u` or `r`; a token of any other
version is refused; `withTenant` throws on a blank tenant; and the proxy's
login redirect is asserted to clear the cookie with `maxAge: 0`.

**Everyone signed in before this deploy is signed out by it.** That is the
intended behaviour and the whole point of the version bump.

## STORE: eight tabs to six — Dashboard · Issue · Receive · Stock · Masters · Books

Reorder, Count and Loss stopped being top-level tabs and became views inside
**Stock — On hand | Reorder | Count | Loss**. Adjustments folded in too.

**ISSUE MOVED AHEAD OF RECEIVE.** A store manager issues several times a day
and receives once, so FREQUENCY sets the order, not the sequence in which
goods physically arrive. The old order described the warehouse; this one
describes the job.

**PROMOTING STOCK IS THE POINT, not tidiness.** `stock_on_hand` carries the
loudest sentence in the app — "more issued than purchased on record, a bill is
probably missing" — and it was two taps deep inside Books. It is now the third
tab, so the warning is read daily rather than found. Nothing became a new
source of truth: every view reads `stock_on_hand`, `reorder_due`,
`count_variances` and the wastage tables exactly as before, and negative stock
keeps its red line and its sentence.

**The badge moved to Stock and fires on ANY of three conditions** — negative
on-hand, counts saved but never accepted, items at or below reorder level —
in one statement with three scalar subqueries, because it renders with the
strip on every page in the group and must cost one round trip, not three.
Tapping it opens **the most serious thing firing**: negative stock, then
unaccepted counts, then reorder. `TabHrefs` is how a badged tab overrides its
own destination for one render; the key and the tab's URL are still not
settings-editable. With a quiet shelf there is no badge and no override, and
the tab opens On hand.

**THE BRIEF'S SAFETY CONDITION FOR LOSS WAS NOT TRUE, so it was made true.**
The argument for burying Loss was that "the store dashboard already carries a
Wastage quick tile". It did not — the dashboard linked to stock, reorder,
issue, new vendor, pay and indent-prefill, and nothing else. Since the whole
justification rests on that one-click path existing, the tile was ADDED, and
`smoke:phase-a` now asserts it is there AND that it is unconditional: the
alarm tiles appear when something is wrong, but a door has to be open all the
time. If the tile goes, the gate fails and Loss comes back out as a tab.

**Two doors would have been lost silently, and were not:** Adjustments is
linked from the Count view (accepting a count is what writes one, and one can
still stand alone — that is how opening stock is set), and Slow-moving from
the Reorder view, where it belongs as the same question from the other end.

### THE REORDER TAB'S CHIPS HAD BEEN 404ing ALL ALONG

`{ key: 'reorder', chips: [{ key: 'due' }, { key: 'slow' }] }` built
`/store/reorder/due` and `/store/reorder/slow`. Neither directory ever
existed. Both chips 404'd on the live site for as long as that tab has been
there, and `/store/slow-moving` was orphaned besides — nothing linked to it at
all.

**`audit:matrix` could not have caught it: chip URLs are BUILT from the tab
registry (`${base}/${chip.key}`), so they are never literal hrefs in a page,
and that gate reads literal hrefs.** Same blind spot as `/denied`, which was
only ever a redirect target. `smoke:phase-a` now walks `src/app` for real
routes and checks all 33 chips across all six groups against it — verified by
reintroducing a dead chip and watching the gate name it.

**The gate also caught a CHAINED redirect**, which is its own small law:
`/books/counts → /store/count` and `/wastage → /store/loss` both pointed at
URLs that this restructure retired. A retired URL must land on a LIVE route,
never on a second redirect. Both retargeted; 51 retired URLs now resolve for
all six roles.

## Four forms take the closing form's shape — header + lines

Kitchen loss, store loss and production now look like `/kitchen/shift/closing`:
header (date · department) + a line table + ＋ Add item + Note + Save. One save
writes N rows sharing the header's date and section.

**No schema change, and the reason is worth stating:** every one of these
tables already carries its own date and section ON EACH ROW. A batch is
therefore N ordinary rows, and nothing about how they are READ changes — no
parent table, no join, no migration. Where that is not true (kitchen closings)
a real line table already exists.

**REASON IS PER LINE on both loss forms.** Burnt gravy and expired milk go in
the same bin on the same night for different reasons, and the reason is what
makes waste analysis worth anything. This is the one place loss must differ
from closing. Four write-offs from one shift used to be four saves with the
department and date re-picked each time.

**Value is computed and read-only, everywhere.** `KitchenComponentHit` gained
`unit_cost` so a line can show what it is worth AS IT IS TYPED, from the same
figure the server freezes at save. The chef sees the number and never types
it; the saved value is still the authority.

### Two premises in the brief that were already true

Worth recording, because both were about to be "added" twice:

- **`kitchen_wastage.qty` was NOT unused.** The form already carried a
  `component | value` mode toggle — component mode takes a quantity and
  freezes qty × cost, value-only is the fallback. What reads as "Value only"
  on the screen is one of two modes. Quantity moved from a mode toggle to a
  per-line choice; it was not introduced.
- **`saveProduction` already refused a dish BY NAME**, server-side. The
  schema comment was accurate. `saveProductions` keeps the check and
  `smoke:a2` now asserts it exists in the source, because a picker filtered to
  subs is a courtesy and a form can always be posted to directly.

### NO SESSION ON PRODUCTION, asserted rather than remembered

An indent carries a session because the STORE must match a request to a shift.
Production has no counterpart doing that, so a session here would be a column
with no reader — the `issues.session` mistake in reverse. `smoke:a2` asserts
`productions` has no `session` column and that `indents` still does, so nobody
adds one by reflex.

### REFILL FROM LAST, and the one place it is dangerous

Production and closing both offer the previous set for that department,
editable, saving nothing until Save. Worth most on production: a kitchen makes
broadly the same batches every day. Voided batches are never offered back — a
cancelled batch is not a suggestion for tomorrow, and both the reversal and
the row it reverses are excluded.

**Closing is the dangerous one and it is handled in three parts.** A closing
feeds food cost and COGS, so a chef saving last night's numbers without
recounting is worse than a blank form, because it looks like a count.

1. The offer is amber, not blue, and says so: "From last night — check every
   line … anything you do not recount will be wrong in the books rather than
   merely stale."
2. Each refilled line remembers the quantity it ARRIVED with.
3. On the reveal, lines saved with that quantity untouched are counted and
   named in an alarm-level honesty strip.

**It is said, not blocked, and that is deliberate.** A shelf genuinely can
hold the same thing two nights running, so blocking would be wrong on real
data — and worse, it would teach people to nudge a digit to get past it, which
destroys the signal entirely. The count is a UI honesty matter and is NOT
stored: nothing in the schema records "this was prefilled", because the
closing itself is either right or it is re-filed.

*(The brief asked for a proposal before building this. The alternatives
considered were: storing a `prefilled` flag on the line — rejected, it makes a
UI fact permanent and the correction path is already re-filing; and blocking
the save — rejected above. The third option, saying it on the reveal, is what
shipped.)*

## A RENDERED FORM SHOWS ONE MODE, NOT THE WHOLE CAPABILITY

Two claims in the batch-entry brief were wrong in the same way, and the fault
is worth naming because it is cheap to repeat: **both were inferred from a
rendered page instead of read in the handler.**

- `kitchen_wastage.qty` was called unused. It was live behind a `component |
  value` mode toggle — the screen that was read happened to be showing
  value-only mode.
- `saveProduction` was said not to enforce subs-only. It refused a dish BY
  NAME, server-side, and had done since the phase that introduced it.

A form renders the branch it is currently in. A picker filtered to one kind, a
field hidden behind a toggle, a validation that only fires on submit — none of
them appear on the screen a reader is looking at. **Before calling a column
unused or a rule unenforced, read the action and the schema.** The screen is
evidence of one path through the code, never of its absence.

## Shorts: the header was the bill, and it was already sitting there

`saveShort` wrote one row per save, so a delivery that shorted three lines was
three trips through a form. **That shape punished checking a delivery
carefully** — the receiver who counted every crate paid for their diligence
with three saves, and the one who waved it through paid nothing. Exactly
backwards for the behaviour the app wants.

`saveShorts` takes the PURCHASE as its header and a line per shorted item.
The bill's own checks — reversal, voided — run ONCE because they belong to the
header; per-line checks run per line and **name the ITEM, never a line
number**, because the receiver is holding a bill with names on it and has no
idea which row is "line 3".

The purchase id is passed EXPLICITLY rather than inferred from the lines, so a
batch that somehow spans two bills is refused instead of quietly split. The
batch is all-or-nothing: a delivery is recorded as the receiver saw it, or not
at all.

Two duplicate rules, both kept: a second short of a DIFFERENT kind on one line
is real (part missing, part damaged) and stays allowed; the same line and kind
twice — in one batch or against an already-open short — is refused, because
nothing here can be edited afterwards and a double tap would leave a permanent
second claim in `vendor_performance`.

`saveShort` was DELETED rather than left beside `saveShorts`. Two paths to one
table is how they drift.

**Still one-per-save, deliberately:** `saveContractBill`. One bill is one
document.

## `created_at` IS THE TRANSACTION TIMESTAMP — rows written together TIE

A standing fact, not an incident. It has now bitten twice:

1. `acceptCount` ordering adjustments made "since this count was frozen"
2. two corrections of the same item inside one batch save

`now()` — and therefore every `created_at default now()` in this schema — is
the **transaction** timestamp. It does not advance within a transaction, so N
rows written by one save all carry the identical instant. They tie.

**Anything that needs to ORDER such rows needs something other than a
timestamp:** a sequence, an explicit ordinal column, or a refusal to allow the
ambiguity at all. The adjustments batch chose the refusal — the same item twice
in one save is rejected — because the alternative was an ordinal column that
exists only to disambiguate something nobody should be entering twice anyway.

Before writing a batch, ask what reads these rows and whether it needs them in
order. If it does, a timestamp will not give it one.

## A batch is a convenience of ENTRY, not a document

**One voucher, one number. N vouchers, N numbers.** Three payments made in one
sitting are three payments: different payees, individually voidable,
individually cited by an accountant months later. One number across three
would change meaning the instant one of them was voided — and a document
number has to mean exactly one thing forever, including when that thing was a
mistake.

**This is why `saveShorts` differs, and the difference is real rather than a
convention.** There the header is THE BILL, which is genuinely one document
that already exists and is already numbered; the shorts hang off it. On a
voucher or an expense the header is a DATE, which is a keystroke saving and
nothing more. Ask what the header IS: if it is a document, the batch inherits
its identity; if it is a convenience, every line keeps its own.

## Reason: per line on losses, per header on corrections

Both rulings are right and they do not contradict each other.

- **Losses take a reason PER LINE.** Two things in one bin on one night are
  lost for two different reasons, and the reason is the whole value of waste
  analysis.
- **Corrections take ONE reason for the batch.** A batch of corrections is one
  EVENT — a stocktake, an opening balance, a found crate. Two reasons means
  two events, which means two saves.

**Direction stays per line on corrections**, because a stocktake finds
surpluses and shortfalls in the same pass.

## The header holds only what the lines genuinely share — argued each time

Seven forms took the header+lines shape and the split came out DIFFERENTLY on
almost every one. That is the point: the shape is not inheritable, because the
question is about the work, not the widget.

| form | header | and why |
|---|---|---|
| kitchen / store loss | date (+ section) | reason PER LINE — two things in one bin on one night are lost for two reasons |
| production, closing | date + department | a department genuinely scopes what was made or held |
| adjustments | date + REASON | a batch of corrections is ONE event: a stocktake, an opening balance |
| shorts | THE BILL | a document that already exists and is already numbered |
| vouchers | date | account PER LINE — owner pocket and drawer in one sitting |
| expenses | date | account and mode per line — two receipts, two ways paid |
| other income | date | buyer per line, argued below |
| casual labour | date | department PER LINE — a day's hands split across departments |

**"One sitting, one X" proved false twice**, and both times it was found while
building rather than while designing:

- **Vouchers.** The account looked like a header — one sitting, one drawer.
  It is not: an owner-funded payment leaves the OWNER'S account while a
  cashier payment leaves the drawer, and the two happen in the same evening.
- **Other income.** The tempting header was the BUYER — a scrap dealer taking
  cardboard and oil really is one buyer. But a day's sundries just as often
  means a dealer, a vending commission and a staff sale. Per line is never
  wrong, and a name picker makes repetition cheap.

**The test that works:** ask what would be WRONG if this were shared, not what
would be convenient. A shared field that varies produces a false record; a
per-line field that repeats produces a little typing. Those are not
symmetrical costs, so the tie goes to per line.

**CARDS, NOT TABLE ROWS, once a line carries more than about four controls.**
A voucher line has seven; seven controls across a row is unusable on the phone
these forms are filled in on, and one-question-at-a-time still rules inside
each card. Losses, production and adjustments stayed as tables — item, qty,
unit, reason is exactly the width a row can carry.

## A DISH IS PRODUCED IN PORTIONS — the ruling, and the reader that justifies it

Marinations were never the question: they are sub-recipes and the data was
already where it belongs. This is about dishes cooked ahead — biryani in
vessels, sweets made in the morning, anything portioned out later.

**`output_qty` on a produced dish means PORTIONS MADE**, and `unit_cost`
freezes from `dish_costs.cost_per_portion`, never `cost_per_output_unit`. The
original objection — a dish has no batch yield — is exactly what this answers:
asking a dish for a batch yield would have frozen a number that looked fine
and meant nothing.

**NO PORTIONS, NO PRODUCTION.** `cost_per_portion` divides by
`recipes.portions`, which is NULLABLE with no default, so a dish nobody has
told how many it makes has nothing to freeze and the line would silently be
worth zero. It is refused BY NAME — not defaulted. That is the
`issues.session` rule for the fourth time: a column default is never a
substitute for an answer, and here there is not even a default to lean on.

**THE READER IS THE CLOSING, and without it this feature should not exist.**
`kitchen_closing_lines` already accepts a dish as a component, so the loop
closes: produced 20, closed 12, eight went out. `getUnclosedDishes` compares
today's production against the WINNING closing for that (section, date) — a
re-filed closing must not make a gap disappear — and the kitchen dashboard
carries **"Made today, not yet closed"**. It is silent at zero, because a
permanent all-clear is a thing people learn to dismiss.

That line is the whole justification. A dish produced and never closed would
be a row nobody reads, which is the session mistake wearing a new hat.

**SUBS AND DISHES STAY VISIBLY APART IN THE PICKER** — two labelled groups,
"made in batches" against "made in portions", with the portion count shown
and `(no portions set)` called out before the save refuses it. Same table,
different quantity; conflating them is how a batch cost silently becomes a
portion cost.

**The superseded gate was replaced, not deleted.** `smoke:a2` used to assert
"production refuses a DISH by name". That rule is gone, but the principle
behind it is not — a form can always be posted to directly, so the refusal
lives on the server. The assertion now checks the rule that actually holds.

## PICKERS: SCOPED AND RANKED BY WHAT IS ALREADY KNOWN

One principle, and it is the whole of it:

> **A picker WITH context is SCOPED AND RANKED by that context. A picker
> WITHOUT context is ranked by FREQUENCY. And scoping NEVER EXCLUDES.**

The second half is the one that is easy to lose. Scoped suggestions sit at the
TOP under a named heading and the general search stays underneath reaching
everything, because a first-time item has no history — a department taking
chillies for the first time, a vendor sending something they have never sent —
and a picker that only offered history would make it unfindable. Bill entry
already used this shape for the starter library; `IssueItemPicker` is now where
it lives, and it takes `suggestions` + `suggestLabel` from whichever form has
context to give it.

**Rank order is FREQUENCY THEN RECENCY. Alphabetical is the default nobody
chose.** The one deliberate exception is a vendor return, ranked RECENCY first:
at the moment of a return the delivery in dispute is the one that just came
through the door, and how often that vendor has ever sent the item is the
weaker signal. Frequency breaks the tie. Argued per picker, not inherited.

**The suggestions are ranked BY THE SERVER and the component never re-sorts
them** — it only narrows by what has been typed, so the order the query argued
for survives to the screen.

### The three that were fixed

1. **Vendor return.** The form said, on screen, "normally the rate on the bill
   these arrived on" — the app asking somebody to remember a number it was
   holding. The item picker now leads with `vendor_supplied_items` for that
   vendor and the RATE PREFILLS from `last_rate`, recording
   `source_purchase_line_id` so the number has a provenance instead of a
   memory. **A prefill is not a substitution:** the rate stays editable,
   because a vendor does not always credit at the price they charged — and
   **typing over it DROPS the provenance**, since a source line pointing at a
   figure the claim no longer makes is a false citation, worse than none
   because it looks sourced. Measured on live data: RR Chicken bills Chicken
   Boneless at ₹330 and Sneha Chicken at ₹300, so the rate has to be per
   vendor and could never have been "the last rate for this item".
   A return can also be **opened FROM a bill**, the way a short is recorded:
   pick the bill, see its lines, send some back — vendor, item and rate all
   come free. **Quantities stay BLANK**; what arrived is not what is going
   back, and a prefilled quantity looks exactly like a counted one. The bill's
   quantity renders beside the empty box as context.
2. **Issue — this was a REGRESSION FROM THE SHEET.** The Issues sheet filled
   the last ten days' items for a department, most frequent first, and the app
   lost it: every issue started from a blank typeahead over 300-odd items, so
   the store manager searched for onions every morning. `section_frequent_items`
   restores it. An open indent still wins where there is one — that is a
   request somebody is waiting on, not a guess.
3. **Back to store** scopes to the same list: you cannot return what was never
   issued.

`typical_qty` is a **HINT beside the box, never a prefill** — the closing-form
ruling applies, and this one would be an average nobody counted.

### Reason is per line on returns too

`vendor_return_lines.reason` and `return_lines.reason`. A rotten crate and a
wrongly-picked item go back on the same trip for two reasons — one is the
supplier's fault and the other is ours — and one shared header reason made one
of them false. Same conclusion already reached for kitchen and store loss.

**The header reason is NOT cached, and must not be.** `vendor_returns.reason`
is nullable now and stays null; the list COMPUTES the summary from the lines —
one distinct reason names itself, several read "Mixed". A cached predominant
reason can disagree with the lines it claims to summarise, and nothing on
screen would look wrong. `returns.reason` is still NOT NULL (that migration was
not relaxed), so there the header carries the same computed summary — a
summary, never the authority. Every reader that cares reads the lines.

New list key: `vendor_return_reason` (it was seeded in the database and missing
from `lists.ts`, so the Lists screen could not edit it).

### The five the audit listed, now built

Each one argued rather than inherited, and every one came out differently:

| picker | scope | rank | why |
|---|---|---|---|
| bill entry | the VENDOR | frequency then recency | what they usually send is the better guess when entering their bill |
| non-revenue | the REASON | frequency then recency | the reason is picked BEFORE the dish on every line |
| off-book | none | frequency | mode, account and a one-off customer name predict nothing |
| production | the DEPARTMENT | frequency, INSIDE the kind split | see below |
| kitchen closing / loss | the DEPARTMENT | issued-or-made first | what a department can hold is what it was issued plus what it makes |
| person fields | none | frequency then recency | `getNameHistory` was `last_used desc` — half the rule |

**THE BILL'S RATE PREFILL WAS SOMEBODY ELSE'S PRICE.**
`item_rates.prefill_rate` is the last rate for an item **across all vendors**,
and on a bill that is wrong: measured live, Chicken Boneless reads ₹330 because
RR Chicken sold it last, while Sneha Chicken charges ₹300. A Sneha bill
prefilled ₹330 — ten per cent out, on a field somebody tabs straight past.
`searchItems` now takes the vendor and reads `vendor_supplied_items.last_rate`
(still a named view, never recomputed), falling back to `item_rates` only when
that vendor has never sent the item — and the dropdown says which it is,
"theirs" against "another vendor", because those are different strengths of
claim.

The scoped group is a **SEPARATE QUERY**, not an `ORDER BY` on one. A vendor
supplying eight items would otherwise fill an eight-row limit and hide every
other item and the whole starter library — and an item is BORN on a bill, so
hiding them breaks the flow the picker exists for.

**RANKING GIVES WAY TO CORRECTNESS.** Production keeps subs and dishes in two
visibly separate optgroups, because a batch cost read as a portion cost is
silently wrong; the department's frequency orders rows *within* each group and
marks them "made 4×" rather than promoting a mixed "usually makes" group above
both. When a speed rule and a correctness rule collide, the speed rule works
underneath.

**The kitchen component scope is deliberately NOT past closings.** A closing is
corrected by RE-FILING, so `kitchen_closings` carries no `reverses_id` and only
the latest row per (section, date) counts — ranking off it would mean getting
"latest wins" right in a second place for no gain, since refill-from-last
already offers a department its previous closing verbatim. What a department can
hold is what it was **issued** (`section_frequent_items`) plus what it **makes**
(`productions`), and both already exclude voids.

**Found by an assertion, not by reading: the bill item picker never matched item
CODES.** Every other picker in the app matches name OR code, and this one
printed the code in its own dropdown while matching only the name — so typing
`PLT-001` on a bill found nothing. The test searched by code because that is
what `vendor_supplied_items` carries, and it failed. Fixed in both halves.

### What the audit found, and the premise it corrected

**PAYMENT WAS ALREADY RIGHT.** `listVendorsWithDues` is
`order by d.balance desc` — the queue has always led with who is owed most, and
so has the advance recovery list (`order by (advances − recovered) desc`). Only
the search box underneath is alphabetical, which is correct: a search box is
for finding a named vendor, not for ranking one. The premise that it sorted
alphabetically came from reading the screen rather than the query — the same
fault as `kitchen_wastage.qty` and `saveProduction`, for the third time.

**Two orderings that are deliberately NOT frequency and must stay:** the count
sheet is `on_hand_value desc` (count the expensive things first), and the
attendance roster is the computed roster order (dept_group → sort_order →
grade → name), where a frequency rank would move a person between mornings and
lose the marker's place.

*(The count-sheet half of that was SUPERSEDED — see "A stock screen is not one
job" at the end of this file. The value ordering was doing two jobs and ABC
took one of them. The attendance half stands.)*

**All six of the pickers the audit listed as unscoped are now built** — see the
table above. **`searchComponents` on recipe lines is the one left**, and
deliberately: the context available is the recipe being edited and its
department, and "ingredients this department's other dishes use" is a much
weaker signal than "what this vendor sent" or "what this department was issued".
It is the only one where the scope would be a guess rather than a fact.

## GREP FOR THE PARENT, NOT THE LINE — the third off-by-one-view

> **A CHECK (qty > 0) on a line table means that table can never use the
> negative-twin void. The reversal is marked on the PARENT, so EVERY view
> reading those lines must filter on the parent's state — no `reverses_id`, and
> not itself reversed.**

Migration `money_views_skip_reversed_returns` finished what 0022 started.
`stock_on_hand` learned it first; `vendor_dues.credits`,
`vendor_performance.returned_value` and the new `vendor_return_reasons` learned
it here. `vendor_supplied_items` now excludes voided bills too, so a cancelled
bill's rate can no longer prefill a credit claim.

**Fixing one half moved the fault to the other, and the other was worse.** 0022
made the stock exact and left the money doubling — and an overstated credit
against a supplier is never discovered, because nobody counts what we owe them;
it is simply underpaid. That is why the void was REFUSED in between rather than
left running.

Measured, live, rolled back — ₹500 of Chicken Boneless back to Golden Mutton,
and the void must return EVERY column:

| | balance | credits | returned | on hand | reasons |
|---|---|---|---|---|---|
| before | 17050 | 0 | 0 | 23.5 | — |
| after the return | 16550 | 500 | 500 | 13.5 | Quality 1 / 500 |
| after the VOID | 17050 | 0 | 0 | 23.5 | — |

**`smoke:a2` now holds the RULE structurally, not the instance.** It reads
`pg_constraint` for every line table carrying a `qty > 0` CHECK whose parent has
`reverses_id`, walks `pg_depend` to every view over it, and asserts each view's
definition mentions `reverses_id`. Two line tables, seven views, all filtering.
Proved capable of failing by re-running the same enumeration against a token no
view contains: it named all seven. A gate that has only ever returned an empty
list has not been tested.

That gate is the answer to the fault repeating three times: every previous fix
was found by a person reading a view definition, which does not scale to the
next table somebody adds.

**The per-line reason now HAS a reader.** `vendor_return_reasons` on the vendor
page, **ranked by COUNT, not value** — a rupee total is already on
`vendor_performance` and cannot tell four rotten crates from one expensive
mis-delivery. Two honesty details that are not fussiness: it counts LINES, not
trips (two items back on one delivery is two lines and one visit, and calling
that two returns overstates the case against a supplier), and it is SILENT AT
ZERO, because "nothing has ever gone back to this vendor" is good news that
becomes noise when it appears on all five vendor pages.

## A GATE CAN BE AN INVARIANT INSTEAD OF A PINNED BUG

`vendor_dues.credits` and `vendor_performance.returned_value` sum every
`vendor_return_lines` row with no reference to `vendor_returns.reverses_id`.
`stock_on_hand` learned to skip a reversed pair; **those two did not**, and the
docblock on `voidVendorReturn` still claimed "MONEY — exact". Measured on live
data inside a rolled-back transaction, ₹500 going back to Hemenic Foods:

|  | balance | credits | returned_value | on hand |
|---|---|---|---|---|
| before | 12500 | 0 | 0 | 23.5 |
| after the return | 12000 | 500 | 500 | 13.5 |
| **after the VOID** | **11500** | **1000** | **1000** | 23.5 |

The trade-off inverted when the stock views were fixed and nobody moved the
sentence: stock is right now and the MONEY is doubled. By this file's own
earlier argument that is the worse half — nobody physically counts what we owe
a supplier, so a wrong credit is never discovered, it is simply underpaid. So
the void is REFUSED again, naming the fix, exactly as it was refused once
before when stock was the broken half. **`voidVendorReturn` had three stacked
docblocks from three rewrites, two of them stating the opposite of what the
code did** — and the wrong sentence was on the SCREEN too, in an honesty strip
telling the user the book was short twice over.

**The gate was written as an INVARIANT, not as a pinned bug:** it moved ₹500
through a rolled-back transaction, observed whether the views doubled it, and
asserted `refusalInForce === viewsDouble`. That passes in both worlds and fails
only when they disagree.

**IT WORKED.** `money_views_skip_reversed_returns` landed and the gate went red
on the next run, naming what to do: flip the flag, restore the Void button,
delete that half. The flag was DELETED rather than flipped — it existed only to
hold the refusal, and a `boolean = true` left behind is dead scaffolding. The
assertion that replaced it is the permanent one: a void must return every one of
the five columns above to where it started, which is stronger than watching the
money alone. Watching one half is exactly how the fault survived 0022.

Better than the earlier form of the same trick (a gate "written to FAIL once
the view was fixed"), which is green only by being wrong.

## The department page — a drill-down, and the preconditions ARE the feature

`/kitchen/departments/<code>` — CH, TD, SI. Every figure on it already existed
in a named view; what was missing was a place to read them together for ONE
department. **Nothing here computes a total the database does not already
publish, and nothing here caches one.**

**TWO KEYS, and choosing wrong is a 42703 on a live page.** The relations split
cleanly and unhelpfully: `section_costs`, `section_food_cost`,
`labour_cost_by_section`, `section_consumption_daily`, `indent_fulfilment`,
`issue_frequency` and `dish_costs` key on **`section_code` TEXT**;
`productions`, `kitchen_wastage`, `kitchen_closing_current`, `issues`, `indents`
and `staff` key on **`section_id` UUID** and carry no code at all.
`getDepartment` resolves code → id ONCE and every other function takes whichever
key its relation actually publishes; the parameter names say which.

### THE SAME ABSENCE READS AS 0 IN ONE VIEW AND NULL IN ANOTHER

This is the fault the page was most likely to ship, and it is worth stating as a
general hazard rather than an incident. For South Indian, August 2026, measured:

| | sales | labour | margin | consumed |
|---|---|---|---|---|
| `section_costs` | **0** | **0** | **−7498.33** | 7498.33 |
| `section_food_cost` | **NULL** | — | — | **NULL** |

Same department, same month, same missing data. `section_costs` COALESCEs every
leg to 0 and publishes **no honesty column at all**, so its own row cannot tell
"₹0 of sales" from "no POS day has ever been fetched". On a page titled after a
department, rendering that margin is not a wrong number — it is **an accusation
about a named team**.

So each leg is assessed against **its own source**, never against
`section_costs`: sales against `pos_orders`, labour against `attendance`,
consumption against `section_consumption_daily`. **Margin is stated only when
all three are real**, because otherwise it is arithmetic over an absence. This
is the "South Indian costs more than it earns" card that
`src/lib/precondition.ts` was written for, arriving a second time by a different
route.

### A STRUCTURAL IMPOSSIBILITY IS NOT MISSING DATA

Two different sentences, two different components — `<Unassessed>` for data that
has not arrived, plain prose for a thing that can never apply:

- `codes_dishes = false` → "**No dish can be coded to** Staff Food" — not "no
  dishes yet". True for all seven operational units **and for SF and KS**, which
  are `dept_kind = 'kitchen'` and still cannot code a dish.
- `receives_stock = false` (ST, AC, VL, SC) → "does not receive stock", not an
  empty indent table.
- `dept_group` not in (Kitchen, Bar) → "food cost is a kitchen question". An
  empty `section_food_cost` result rendered as "pending closing" would tell a
  department **it owes a closing it can never file**.

**The switch is the capability columns, not `dept_kind`.** The brief said the
thinner page keys on `dept_kind = 'operational'` and that is nearly right — but
SF and KS are kitchen-kind and cannot code dishes, so reading `dept_kind` alone
shows Staff Food an empty dish list that reads as "nobody has entered these
yet". Each card asks the column that actually governs it.

### The order is FIXED, and deliberately not sorted by urgency

The owner dashboard ranks its cards because it is **triage across many
subjects**. This page is a **story about one subject**, read in the order
somebody asks: is it earning, what does it cost, what did it make, what did it
lose, did it get what it asked for. Reshuffling per load means the page is a
different shape every time and nobody learns where anything is. The ranking is
served instead by a strip at the TOP that counts what cannot be assessed before
any card claims anything.

### Found while building it

- **The only door from the kitchen dashboard to Departments rendered when there
  were no departments to visit.** The `<Link href="/kitchen/departments">` sat
  inside the `!closings.assessable` branch, so it was invisible on real data,
  and the nine rows beside it were five plain `<span>`s. The rows are the door
  now. *A link inside an unassessable branch is a link nobody sees once the data
  arrives.*
- **`issue_frequency` had never been read by a line of code.** It exists, is
  SELECT-granted, and this page is its first reader — so nothing had ever proved
  it works, and `smoke:a2` now executes it. It filters `reverses_id is null`
  **only**, so `issue_count` means "issues FILED", including a voided original;
  the screen says so rather than assuming the view already handled it.
- **`labour_cost_by_section.unassigned_marks` is structurally always 0 on a real
  department's row.** It is `count(*) filter (where st.section_id is null)`
  grouped under `coalesce(s.code, '—')`, so those staff are in a separate `'—'`
  row. Surfacing it from a department would be a **permanent all-clear against
  an honesty column that can never fire** — the same shape as the four dashboard
  cards that congratulated over missing data. `unsalaried_marks` is the one that
  can fire, and it is read.
- **The no-coalesce gate was name-scoped and would have missed the second
  reader.** `smoke:a2` asserted `getIndentFulfilment` does not coalesce
  `qty_given`/`gap` by slicing that function out of one file by name. The
  department page is a SECOND reader of the same view and would have sailed
  past. The assertion now walks every block reading `indent_fulfilment` in both
  files. *A gate scoped to the place the first fault happened cannot find the
  second one* — the same lesson as gates that only walked `src/server`.

### What the adversarial pass found — four cards were breaking the page's own law

The page was built precondition-first and an adversarial review still found
**four cards reporting a structural impossibility as missing data**, which is
the exact fault the page exists to prevent. Writing the doctrine into a file
header does not enforce it card by card.

- **The food-cost card demanded a closing that could not help.** It printed
  "Issued is ₹0.00; the closing is the other half" for a department that has
  never been issued anything — and `getFoodCost` publishes **`has_activity`**
  for precisely that distinction, which the card ignored. Worse than a wrong
  figure: `section_food_cost` is driven from `section_consumption`, which ends
  `where coalesce(iss.v,0) <> 0 or coalesce(ret.v,0) <> 0`, so a department with
  no issue can **never** acquire a row — **filing the closing the card asked for
  would not have changed the answer.** The card named an unachievable errand.
  Both other readers of the same query gate on `has_activity` first.
- **"Is it earning?" had no structural branch at all**, so the Store was told
  nothing had moved "from the store to Store" *yet* — inviting an entry
  `saveIssue` refuses by name — while the card two inches below said "Store does
  not receive stock". The page contradicted itself on one screen.
- **The loss card was not gated** though `saveKitchenWastage` calls
  `assertKitchenSection`, and **the indent card gated on `receives_stock`
  alone** though `saveIndent` asserts *both* that and Kitchen/Bar — so
  Housekeeping was told it "has not raised an indent", implying it could.

**The measure of the fix:** the Store went from six false "cannot be assessed"
to **one**. Everything else on its page now says why it can never apply.

### THE FIRST FETCHED POS DAY WOULD HAVE ACCUSED EVERY DEPARTMENT AT ONCE

The sales precondition asked *"has any POS day been fetched?"*. Revenue reaches a
department only through `pos_item_map → recipes → section`, so the day the POS
is switched on that leg flips true for **all sixteen departments simultaneously**
— each then reporting a confident `sales ₹0` and, with labour also present, a
red negative margin. The page would have started lying on the day the data
arrived, and no amount of live testing beforehand could have shown it.

It now rests on **attributable** revenue: at least one mapped dish carrying this
section's code with revenue in the period. Where orders exist and nothing is
mapped, the strip says so — that is a fact about the mapping queue, not about
the team.

**The general form: a precondition must ask about the thing the figure actually
depends on, not about a proxy that correlates with it today.**

### An unfilled indent was called SHORT, in red — in both readers

`indent_fulfilment` computes `coalesce(qty_given, 0) − qty_requested`, so an
**open** request of 5 kg that the store has not touched arrives as `−5` and
rendered as **"Short 5 kg"** — an accusation against the store for a request
nobody had been given the chance to fill. `/kitchen/indent/[id]` had it too, and
said "None yet — the store has not issued against it" three inches above the
red word. **Live data has no open indent, so nothing on this database could ever
have caught it.** The rule now lives in `GapCell` itself, which takes `status`,
and a gate asserts every caller passes it.

### Two more, both the same shape as faults this file already records

- **`order by 3 desc` pointed at a `::text` cast**, so `9.00` sorted above
  `100.00` and the biggest loss was not at the top — the entire point of that
  card. Ordering is on the numeric now, and a `having` drops a day or a reason
  whose every row was voided, which otherwise printed a ₹0.00 line *and*
  suppressed the empty state that should have fired.
- **The labour evidence counted marks the view excludes.**
  `labour_cost_by_section` carries `where st.employment_type <> 'contract'`, so
  counting contract attendance called the leg assessable and then read ₹0.00 off
  a view that had deliberately left those people out — **a measurement made of
  an exclusion**, which would also have unlocked the margin. The evidence
  mirrors the view now, `attendance_current` included, and contract staff get
  their own sentence: billed by their vendor.

**And a gate that encoded the fault.** The first version of the sales assertion
asserted `ev.sales === (posDays > 0)` — it would have *held the wrong behaviour
in place*. A gate written from the implementation rather than from the
requirement is a gate that ratifies the bug.

### Premises corrected

The period control has **three** presets — `this-month · last-month ·
last-3-months` — not "Today · This week · This month · Last month · Custom
range", and it does **not** persist across pages: it is a per-page `?period=`
URL param, deliberately, so a link survives a bookmark and a WhatsApp paste. The
page therefore mounts the existing `PeriodControl` unchanged, which is what the
brief's own rule ("do NOT build a second date picker") actually requires —
adding presets here would have changed `resolvePeriod`, which is asserted by
value including the January year-roll, and changed every dashboard with it. The
page states the resolved range in words ("This month · 1–19 Aug 2026") because a
preset alone leaves the reader guessing whether it ends today or at month end.

No store surface has ever linked to departments or sections, so there was no
dead end to route — and store is denied `/kitchen` anyway (only
`/kitchen/indent` is carved out above it). Adding a store→department link would
need a new matrix entry above `['/kitchen', …]`, which is why it was not done
casually.

### `SectionsView` is NOT duplicated by this page — it is its index

One live mount, and `smoke:a2` asserts exactly one. The overlap is four figures
from one view at one grain; `SectionsView` renders sixteen departments plus the
synthetic `'—'` row with a totals footer, which a per-department page cannot.
Its rows now link INTO the detail page, **skipping `'—'`** — that row is a
bucket for staff posted nowhere, has no `sections` row behind it, and
`/kitchen/departments/—` would 404 for a reason nobody could guess.

### NOT BUILT, AND NOT TO BE DESIGNED AWAY: the section head

**If departments have pages, a section head becomes a plausible scoped user** —
a CDP who runs Chinese, seeing only `/kitchen/departments/CH` and only their own
department's indents, losses, production and people. **That role does not
exist**, and `src/lib/roles.ts` has no vocabulary for it: every rule is
path-prefix → role list, with no notion of a role scoped to a ROW.

It is recorded here so nobody quietly removes the possibility. Three things it
would need, none of them small: a `sections`-scoped claim on the session; a
matrix that can express "this path, but only for your own department"; and a
decision about what a section head sees on a shared screen like the kitchen
dashboard. Do not add a `section_id` to `app_users` as a shortcut — a person can
plausibly run two departments, and a column would make that unrepresentable the
day it matters.

## The period control: three presets, and now a range

**THE STATE BEFORE THIS CHANGE, since it was misremembered three times.** The
control offered exactly **three** presets — `this-month · last-month ·
last-3-months` — and never a fourth. It did **not** persist: zero occurrences of
`localStorage` or `sessionStorage` in the repo, no layout threading it, no
context, no rewrite. The choice lived only in `?period=` on the page you were
standing on, deliberately, so a link survives a bookmark and a WhatsApp paste.
It was mounted in **eleven** places (twelve surfaces read `?period=`, counting
`/accounts/registers` forwarding into its child and the CSV export route).

### A SIBLING UNION, not a wider one

`PeriodParam = PeriodKey | CustomPeriod`. Widening `PeriodKey` itself would have
broken the two `Record<PeriodKey, string>` maps — `PERIOD_LABELS` and the
control's own `LABELS` — neither of which can be keyed by an open type, and it
would have forced `isPeriodKey` to admit more than its three-string whitelist.
As a sibling, every existing export is untouched.

**THE CUSTOM BRANCH RETURNS FIRST, and that placement is the whole risk.**
`PERIOD_LABELS[key]` runs unconditionally before any branch and would hand a
range `undefined` as its label; and `this-month` was reached by *falling
through* rather than by an `if`. A custom branch added in the obvious place —
beside the other two — returns a **this-month range wearing a custom key**: the
URL says 15 July to 17 August, every figure on the page is August, nothing
throws and nothing looks wrong. The fall-through is now an explicit branch so
the next key added cannot inherit it.

### One front door, twelve callers

Twelve surfaces carried the identical ternary `isPeriodKey(v) ? v :
'this-month'`. Turning twelve hand-written two-branch ternaries into twelve
hand-written three-branch ones is twelve chances to get precedence wrong, so
there is one `readPeriodParam(v, today)` and they all call it. A gate sweeps
`src/app` and `src/components` and fails if `isPeriodKey` reappears in either.

**A REFUSAL IS NAMED, NOT SWALLOWED.** A reversed range says *"The start
(2026-08-17) is later than the end (2026-08-01) — swap them"* and shows this
month meanwhile. Silently swapping would answer a question nobody asked and the
person would never learn they had typed it backwards.

`isDate` was **lifted from the payroll runs page rather than rewritten**, and
the ISO round trip is the load-bearing half: measured, `'2026-02-31'` rolls
**silently** to 2026-03-03 — a wrong range that renders perfectly — while
`'2026-13-01'`, `'2026-8-1'` and `'not-a-date'` make `iso()` throw a
`RangeError`, which on this path is a 500 on twelve pages.

**A future END clamps; a future START is refused.** Both presets that can run
past today already clamp, and a period must never report days that have not
happened. The span cap is measured against the **clamped** end — otherwise
"1 Aug to the end of time" is refused as too long when it is nineteen days.
**Thirteen months, refused and never truncated:** `months` feeds
`month = any($1::date[])` while `from`/`to` feed the event tables, so
truncating one and not the other makes the monthly cards sum a different set of
months than the range covers — the exact disagreement `period.ts` exists to
forbid.

### The one genuinely new lie, and where it is said

`months` and `reportMonth` keep their meaning: every calendar month the range
touches, and the last of them. They have to — `section_costs` is a join of
whole-month aggregates and `section_food_cost` takes its opening from the last
closing *before* the month. **There is no part-month form of those numbers.**

A range starting mid-month therefore makes the monthly cards cover days the
owner explicitly excluded. `partialEdges(p)` derives that from fields `Period`
already has, so no consumer learns a second shape, and `<PartialMonths>` says it
in words on the two pages that read monthly views. **It fires on a partial HEAD
only** — `this-month` has a partial tail every day of its life, and a strip
that is always there is one people learn to look past.

### THE BUSINESS-DAY VERDICT: it was already right, and here is why

**A period range means BUSINESS DAYS today, throughout.** The feared
discrepancy does not exist, and the reason is worth keeping so nobody re-hunts
it: all twelve call sites anchor on `await businessToday()`, `grep -rn "new
Date()" src/` returns **zero** hits, `useBusinessDay()` throws rather than
falling back to the browser clock, and every column a period compares against is
an app-supplied business date. A sweep of all 62 views for a timestamp truncated
to a date found none. **Both sides of every comparison are already business
dates, so the 00:00–05:00 window is folded onto the correct day before any
comparison happens.**

Verified by value: cutover 05:00 Asia/Kolkata, and 18 Aug 00:04 / 00:21 / 01:35
/ 04:59 IST all carry business date **17 Aug**. Rung up at 00:04 on 1 September,
a business anchor gives 1–31 Aug and includes the sale; a calendar anchor would
have shown an empty September while the kitchen was still mid-service.

**Three real edge faults exist, none of them that one.** Named so they are not
re-hunted: `pos_orders.business_date` carries **Petpooja's** cutover, not ours,
and `day_close_ladder` joins the two definitions directly — unverifiable while
`pos_orders` is empty, and an empty `business_day_disagreements` is *not*
agreement. `slow_moving_stock` and `section_frequent_items` key on
`CURRENT_DATE` under a UTC session, disagreeing with the business day for thirty
minutes a day; neither is period-scoped, and fixing them is a migration.

**And one that this change made material, so it was fixed here:**
`getSettlementGap` required a settlement to sit **wholly inside** the period
(`period_start >= from AND period_end <= to`), so one straddling a boundary
vanished from the gap card in silence. Three month-aligned presets rarely
straddled anything; an arbitrary range straddles constantly. It is an overlap
test now.

### The equality proof, and gates that were proved able to fail

**A golden table captured BEFORE the change**: 435 preset resolutions across 149
anchors — every month boundary and mid-month over four years, both leap days,
the January year-roll and the December→January roll — asserted field by field
plus the *shape* of `Period`, so a field added for the custom case cannot slip
into a preset return. **0 differ.**

The seven checks that existed were structurally insufficient: they never
asserted `label` at all, never asserted `PERIOD_KEYS`' contents or order (only
`.length === 3`, which cannot see a reorder), and never asserted `last-month`'s
`reportMonth`. Proved by perturbing exactly that: changing `last-month`'s
`reportMonth` now fails with `last-month@2024-01-01 changed`, and it shipped
green before.

The `basePath` gate was proved the same way — pointing `/store`'s control at a
dead path named the file. **No gate read this control at all** before:
`audit:matrix` matches only hrefs with a literal leading `/` and the control's
href opens with an interpolation, and `audit:schema`/`audit:tenancy` never walk
`src/lib`.

### The rogue list — reported, not quietly given a second picker

Surfaces with a period that is **not** on the shared control:

| surface | how it scopes | verdict |
|---|---|---|
| `/kitchen` | fixed `businessMonthStart()` | **should adopt** — its two siblings `/store` and `/sales` both have the control, so the three group dashboards answer over different scopes depending on which one you stand in |
| `/kitchen/books/food-cost` | fixed month | should adopt, reporting `reportMonth` named on screen |
| `/kitchen/books/sections` (`SectionsView`) | fixed month | should adopt — `/owner` already reads the same `section_costs` period-scoped |
| `/staff/money-out/expense` | fixed month ×4 | partly — it is the **entire reporting surface of the staff group**, which has no dashboard and no period control on any route |
| `/sales/partners` | **lifetime sums**, `effective_pct` blended across all time | should adopt — the owner dashboard reads the same data period-scoped |
| `/accounts/payroll/runs`, `/accounts/close` | own `from`/`to` inputs | **legitimately different** — they write an arbitrary period into a document, where "last 3 months" is meaningless. Both duplicate a `lastMonth()` helper verbatim |
| `/staff/people/attendance`, `/sales/record/close` | one day | legitimately different |
| the `/sales/record/*` entry screens | fixed month or 20-row cap | legitimately different — the month is context beside a form |

None of these was given a picker in this change.

## One date control, six presets, and the two settings that decide what a day is

**THE CONTROL IS ONE THING NOW**, not a chip strip beside two bare inputs: a
trigger showing the current selection compactly ("19 Aug 2026 · Today",
"15 Jul – 17 Aug 2026") and a popover holding the presets down the left rail
beside the calendar itself. The shape is the one Rajesh already uses daily in
Petpooja, so it costs him nothing to learn.

**The two halves are ONE CONTROL.** Tapping a preset HIGHLIGHTS its range on the
calendar and does not close — so a person can see what "Last 7 days" actually
means and then nudge an edge of it. **APPLY IS WHAT COMMITS**: nothing navigates
on the first click of a range, because a half-picked range is not a period and
firing a query on it shows a day's figures under a heading somebody is halfway
through changing.

**A PRESET COMMITS AS ITSELF**, `?period=last-7-days`, which stays RELATIVE —
a link shared tonight still means the last seven days tomorrow. A hand-picked
range commits as `?period=2026-08-01..2026-08-17`, absolute, because that is
what was asked for. Both survive a paste.

**Mobile is ONE month**, with the second grid hidden below `sm` and the paging
arrows doing the whole job. 380px cannot hold two grids and the store, the chef
and the cashier are all on phones.

**`today` is passed as a PROP, never read from a hook or a clock.**
`useBusinessDay()` throws outside a provider and this control mounts on fifteen
pages across five groups; a `new Date()` here would say "tomorrow" at 00:30,
which is the exact fault the business day exists to prevent. A gate asserts the
control takes `today: string` and contains no `new Date()`.

### Three presets added, and the equality proof re-run

`today · yesterday · last-7-days`, shortest first. **A store manager could not
ask about today at all**, which was the obvious gap.

**ADDITIVE, AND PROVED SO.** The 435-resolution golden table captured before the
custom range was compared again after adding three keys: **0 differ**.
`last-7-days` is seven days INCLUSIVE — off by one every time somebody counts is
the sort of thing nobody reports and everybody quietly distrusts. Year-rolls
asserted by value: `yesterday` on 1 Jan → 31 Dec, on 1 Mar 2024 → 29 Feb, on
1 Mar 2026 → 28 Feb; `last-7-days` on 1 Jan spans two months.

A second fixture now covers all six (1,452 resolutions), and the first is kept
as the historical proof and **never regenerated**.

**And a weak assertion was replaced rather than merely updated.**
`PERIOD_KEYS.length === 3` broke when three presets became six — but the reason
it broke is that counting is all it could ever do: it could not see a reorder or
a rename. It names every key now.

### The timezone and the business day are settings at last

Both had lived in the database with no UI since the business-day migration, so a
restaurant that closes at 2am had no way to say so and one outside India had no
way to say where it is. Owner only — the action checks the role itself, because
a server action is a public endpoint and this one decides what every date in the
books means.

**The timezone is validated against `pg_timezone_names`, not against a list in
the app.** The function that uses it runs `at time zone <value>` in SQL, so the
database's own catalogue is the only authority; a zone Node accepts and Postgres
does not would raise on every read afterwards. The field offers sixteen common
zones as suggestions and accepts any IANA name — the list is the common ones,
not the limit. **`Asia/Kolkata` is the new-tenant default and is written in
exactly one place.**

**TWO WARNINGS, both before the save:**

1. **The cutover MUST match Petpooja's.** Orders arrive already stamped with
   THEIR business date; everything else is stamped with ours, and
   `day_close_ladder` joins the two definitions directly. If ours cuts at 05:00
   and theirs at 04:00, every order in that hour is filed on a different day in
   the two systems and the drawer fails to reconcile on exactly the late nights
   that matter.
2. **Changing either moves no stored date** — it changes what `business_date()`
   returns from now on and what `business_day_disagreements` computes for orders
   already stored. Said in the confirm step, because afterwards nothing on
   screen would look different.

### The four rogue surfaces, given the control

`/kitchen` (the sharpest — `/store` and `/sales` both had it, so the three group
dashboards answered over different scopes depending which one you stood in),
`/kitchen/books/food-cost`, `SectionsView` and `/sales/partners`.

**`SectionsView` now takes its month as a prop** and the PAGE resolves the
period, so the component stays a pure renderer with one caller deciding its
scope. Both it and the food-cost page report the period's **last month**, named
in their own heading, because `section_costs` is a join of whole-month
aggregates and `section_food_cost` has no part-month form.

**`/sales/partners` was reading LIFETIME sums** — `effective_pct` was commission
÷ gross blended across all time while the owner dashboard read the same data
period-scoped, so the two screens disagreed about the same partner and neither
said why. Both partner reads are period-scoped now, and the settlement join uses
**overlap, not containment**, in the JOIN rather than the WHERE — a partner with
no settlement in the period must still appear, because "we have never reconciled
Zomato" is a finding and an absent row cannot say it.

### The two CURRENT_DATE views: migration written, NOT applied

`migrations/business_day_in_thirty_day_windows.sql` replaces `CURRENT_DATE` with
`business_date(now())` in `slow_moving_stock` (twice) and
`section_frequent_items` (once). **It is not applied**, and the reason is not
caution: `kb_app` holds SELECT and INSERT and cannot replace a view, every
migration in this project has been authored, named and applied by Rajesh, and
`create or replace view` demands the column list match exactly — a near miss
means dropping and recreating, which cascades to dependents.

Worth knowing before applying it: the replacement makes both views depend on a
`settings` read, so they can only be queried inside a tenant-announcing
transaction. Every reader in the app already goes through `tsql`/`txn`, so that
holds today — but a script that reached for them on the bare pool would start
raising.

**The third edge fault is not a code fix and was not treated as one.**
`pos_orders.business_date` carries Petpooja's cutover; no view can correct that,
and the warning now lives where the cutover is set.

## A GROUP IS A SUBJECT, NOT A PERSON

The rule that explains all three regroupings, and the one to apply to the next
tab somebody wants to add:

> **Once one thing lands in a group by ROLE instead of by SUBJECT, the group's
> name stops describing its contents.**

Staff had become "the manager's stuff", which is how Expenses ended up beside
Attendance. Rent, electricity, marketing and licences are OVERHEADS — a
different P&L line and a different subject. Contract bills and casual labour
STAY, because they are people you pay who are not on payroll and `pnl_monthly`
already counts all three as labour: `wages`, `contract_vendors`,
`casual_labour`.

    staff      Dashboard · Employees · Attendance · Contract & casual
    accounts   Review · Payments · Registers · Parties · Cash & bank · Payroll · Close
    sales      Dashboard · Day close · Record · Partners · Catering · Books

**Employees and Attendance were CHIPS of a "People" tab inside a group already
called Staff.** One level of "people" was enough.

**PAYMENTS is where Expenses lands**, beside bank payments and tax deposits —
coherent rather than a dumping ground, because the accountant already owns every
non-drawer money movement and the drawer law already says till cash is a
voucher, so a cash repair was never the manager's to record. **"Money" became
"Cash & bank"**: Money beside Payments told nobody which was which. **The split
is legible now — Registers, Parties and Cash & bank are for READING; Payments,
Payroll and Close are for WRITING** — and that split is what decided two moves
nobody asked for: `BankPayment` came off Cash & bank and `WithholdingsPanel`
came off the Tax register, because each is a form that moves money and a
register is for reading. Mounting either in both places would have been the
second mount of one component, which this repo already treats as duplication by
definition. A gate now asserts all three payment forms are mounted exactly once
and live under Payments.

**A REAL PERMISSION CHANGE, stated rather than slipped in:** `/accounts` is
accountant and owner, so **a manager can no longer record an expense**. A
manager following an old `/staff/money-out/expense` bookmark now lands on
`/denied`, which names who to ask — correct rather than unfortunate, and better
than the 404 a deleted route would have given them.

### Day close comes back OUT of Record, and the badge is the argument

The earlier merge was wrong. It is the cashier's nightly ritual, it has a hard
chain — no day closes before the one before it — and it was sitting as one of
six chips beside a ₹200 voucher. **The deciding argument is the BADGE: a tab can
carry "3 days unclosed" and a chip cannot**, which is exactly the reasoning that
moved the reorder badge onto Stock. `missing_closes` already answers it, so
nothing is recomputed; silent at zero like every other badge.

### The bug that fell out of it, and the gate that now holds it

`/sales/record` re-exported **Voucher** while its first chip was **"Day close"**
— and `ChipRow` marks the FIRST chip active at the parent URL, so that screen
showed one form with a different one highlighted. Nothing checked it.

**`smoke:a2` now asserts every chip parent renders its own first chip**, across
all six groups (9 parents). One documented exception is allowed and checked
rather than waved through: `/accounts/registers`' child is a DYNAMIC route, so
it cannot bare re-export — it calls the child with an explicit key, and the gate
asserts that key IS the first chip. Proved able to fail by pointing a parent at
its second chip and watching it name the file.

**And a retired URL whose target lived UNDER it.** `/staff/people` →
`/staff/people/employees` looked obvious and is impossible: `legacyTarget`
rewrites a prefix by APPENDING the remainder, so the live
`/staff/people/employees` would have been sent to
`/staff/people/employees/employees`. It stays a real route rendering Employees
instead. **Before retiring a URL, check the target is not underneath it.**

## The staff dashboard — seven cards, six of them unassessable on day one

`/staff` was a re-export of the employees list. It is the group's dashboard now,
reading four views the `staff_analytics_views` migration publishes.

**THE RATIO CARD IS THE ONE THAT WOULD HAVE LIED.** Labour as a share of sales
is the metric that matters and a restaurant runs roughly 25–35% — but with no
POS day fetched the COSTS ARE REAL AND THE DENOMINATOR IS MISSING, and "0%"
would tell a manager their wage bill is free. It says exactly that instead. The
spend card refuses the same way: "no wage bill to report — not a wage bill of
zero."

**All three kinds of labour, in one figure**, because `pnl_monthly` already
treats them as one line. A dashboard showing only payroll would understate the
wage bill by however much of it walks in without a contract.

**`no_salary_set` is the honesty column that changes every figure above it**: a
person with no salary contributes nothing to labour cost, so each one silently
understates the total. Same for `unsalaried_marks`. And **a person posted
nowhere cannot be filled into attendance and would be paid nothing** — the
completeness card's sharpest row.

**A headcount is a fact about NOW, not about the period**, and the card says so
rather than letting the table look like it moves with the dates.

Absence is **ranked by `absent_pct`, never by name** — a roster sorted
alphabetically hides the one fact that card exists to surface. Advances are
largest first. Attendance leads with whether TODAY is marked, because that is
the only half a manager can still act on before the day ends.

Staff was the last group with no period control; it has the shared one now.

### The donut was validated, not eyeballed — and the palette has a hard limit

Three slices, part-to-whole, is the one shape a ring is genuinely good at. The
colours were computed with the palette validator rather than chosen:

| | result |
|---|---|
| emerald-700 · sky-300 · violet-700 | **CVD ΔE 25.3** (protan), 25.5 (tritan) · **normal vision ΔE 27.1** — both well clear of the 8 and 15 floors |
| chroma floor | **FAILS, and cannot pass.** Every hue in Rajesh's sheet is deliberately muted, so all three "read gray". No combination of the app's tokens passes it, and the palette is the sheet and does not change. |
| sky-300 vs surface | 2.32:1, below 3:1 — **obligates visible labels**, which is not dismissable |

So every slice is direct-labelled with its name, its amount and its share, and
the figures are repeated as a table beside the ring: **colour is the last thing
carrying identity here, never the only one.** The first triple tried
(emerald/sky-500/violet-700) failed the NORMAL-VISION floor at ΔE 9.3 — two
hues a full-colour reader could not reliably tell apart — which is exactly the
kind of thing that gets shipped when the check is a judgement instead of a
script.

**Status hues stay reserved.** Wages, contract and casual are IDENTITIES: red
would read as "wrong" and gold as "doubt". A gate asserts no category wears one.

## No shifts. One extra column, and the productivity figure it unlocks

Rajesh asked whether attendance needs shifts. It does not, and the reason is
UNIVERSALITY: **P / Half / Off / Leave / Absent is understood by every
restaurant on earth**, while two shifts is Thrayam's arrangement — a QSR
rotates, a cafe runs one, a hotel runs three. Shifts would cost a master, a
per-person assignment, 130 rows a day instead of 65 and a heavier sheet, in
exchange for precision nobody reads: for pay, half is half, and which half
changes no number. The five statuses stay exactly as they are.

What they cannot say is that somebody stayed late. `attendance.extra_hours`
(nullable, `> 0 and <= 16`) says it, self-describing, with no shift model
behind it — and `settings.standard_hours_per_day` (default 8) turns marks
into hours. **`standard_hours_per_day()` takes NO restaurant argument, and
that is the security property**: `settings` is RLS'd, so it reads only the
tenant announced on the current transaction, and it must therefore be called
through `tsql`/`txn`. Same shape as `business_date()`, deliberately.

**NO OVERTIME PAY IS COMPUTED, and the gate greps for the multipliers.**
`payroll_lines.overtime` stays a TYPED amount. Recording what happened and
pricing it are different jobs: overtime rates are statutory, differ by state
and differ entirely outside this country — the withholding rule again.

### WORKED IS NOT PAID, and the view publishes both rather than choosing

The pay law says **off = 1** — an off day is PAID, a stated assumption since
phase 5. But nobody WORKS an off day, so counting it as eight hours would
understate sales-per-hour by about a seventh and quietly flatter or damn a
department for its rota. `labour_hours_by_section` therefore carries
`paid_days` (the pay law verbatim) AND `worked_days` (off, leave, absent all
0), and `labour_hours` is built from the WORKED days. Both are on the row so
the difference is readable rather than assumed. **The brief said
"day_fraction" and did not say which; this is the answer chosen, said out
loud rather than picked silently.**

### The probe caught a lie in the view it was written to prove

`sales_per_labour_hour` first divided `coalesce(sales, 0)` by real hours and
published **₹0.00 per labour hour** for a department that has hours and no
mapped sales at all — a confident accusation built from an absence, on a page
named after a team. Moving six attendance rows through it in a rolled-back
transaction is what showed it; reading it did not.

The fix is narrower than it looks: **there is no honest zero available
here.** `sales_by_section` is grouped from POS lines, so a department that
sold nothing has NO ROW rather than a zero row, and the two cases are
indistinguishable from this side. So the rate is stated only where a sales
row exists, and `no_mapped_sales` / `no_hours` say which case a blank is.

`smoke:a2` asserts the arithmetic BY VALUE against real staff, inside a
transaction that rolls back: paid 3.5d, worked 2.5d, the off day as exactly
the difference, one 3-hour late night, 23 hours. **The extra-hours leg is
exercised rather than left at zero** — a sum that is only ever added to 0
agrees with a broken formula.

### A VIEW BUILT ON EXPLICIT COLUMNS NEVER INHERITS

`attendance_current` selects NAMED columns, not `*`, so adding `extra_hours`
to `attendance` did not reach it and the view had to be replaced. Caught on
apply. It generalises: **adding a column to a table changes nothing about any
view over it** unless that view is replaced too, and every view in this
schema names its columns.

Two consequences worth keeping. `create or replace view` only permits adding
columns **at the END** of the select list, so a new column goes last or the
view must be dropped and recreated — which cascades to dependents. And the
failure is silent in exactly the worst way: the column exists, every query
against the TABLE sees it, and only the readers going through the view are
blind. The gate now asserts `attendance_current` mentions `extra_hours`, so
the next column added to that table cannot go missing the same way.

### The sheet marks BY EXCEPTION, and a blank is not an absence

"Mark all present", then correct the few — 65 people marked one at a time is
a job nobody does daily. It fills the PICKS and saves nothing; nothing is
filed until Save.

**UNMARKED IS NOT ABSENT**, and the strip says so above the sheet as well as
after the save. Silence and absence are different facts: an absence is
somebody deciding they were away, a blank is nobody having said anything.
They earn the same (nothing) and only one of them is a claim — conflating
them docks somebody's pay for a manager's forgetfulness. The fixed bottom bar
now reads "N still unmarked" rather than "No unsaved marks", because the
absence of unsaved work is not the same as the day being done.

### The staff form's stale note — three phases out of date

"ID and bank details arrive with the login phase" was written in phase 5,
when there was no login and RLS was off, and it was RIGHT then: the form must
not ask for what the app cannot protect. Migration 0014 added all ten columns
once real auth existed and nobody came back for the sentence.

They are on the form now, **at CREATE as well as on edit** — a field nobody
fills on the way past is a field nobody ever fills, and a payroll run with no
account number pays nobody.

**OWNER ONLY on this screen, and the READ is gated as well as the render.**
The brief said owner and accountant; the accountant cannot reach `/staff` at
all (the matrix gives them only `/accounts`), so here it is the owner's, and
`/accounts/payroll/people` stays the accountant's copy. `StaffRow` crosses
the wire to a MANAGER on the same screen, so the page does not fetch a single
identifier column for them — LAW 1 applied to a payload, not just to a link.
`assertIdentityActor` re-checks the role server-side because a hidden field
is not a check.

**ONE SET LIST, in `src/server/staff-identity.ts`** — deliberately not a
`'use server'` file, since every export from one of those is a public
endpoint. Two screens writing eleven columns through two SET lists is exactly
how they drift. A gate holds it, and it is **scoped to `update staff set`**:
vendors carry `bank_name` / `account_no` / `ifsc` / `upi_id` too, and a
name-only sweep reported `books-actions.ts` as a second staff identity path.
A gate that cries wolf is a gate people start ignoring.

## The save acknowledgement — one shape, three rules

Rajesh wants to stay on the page and be told it saved. The audit found four
different answers to that across the app, which is why this is now one.

**THE RULES, and each is gated structurally rather than by naming the files
that were fixed:**

1. **SAY NUMBERS, NOT "SAVED SUCCESSFULLY."** "63 of 65 marked", "Sneha ·
   3 lines — ₹1,256, they are now owed ₹4,256", "5 kg to Chinese, 15 kg
   left". A count is proof; a checkmark is a claim. The gate greps for the
   empty strings — *saved / success / done / ok / recorded / updated* — as a
   headline OR as a toast, and it caught the two master forms that had been
   answering with "Saved ✓".
2. **NAME WHAT IS STILL MISSING**, at the one moment somebody can still fix
   it, in the same `<Honesty>` strips the rest of the app uses rather than a
   second voice. Negative stock after an issue. A batch that came out at
   ₹0.00 because its ingredients have no bill. The departments that have not
   closed tonight. A new item with no reorder level, which will never appear
   on the Reorder tab. 2 unmarked people. A one-sided settlement, which is
   uncompared and not a zero difference.
3. **RESET FOR THE NEXT ENTRY, KEEPING WHAT CARRIES** — the rule the sheets
   settled on years ago: **the date stays, the vendor clears.**

`src/components/SaveAck.tsx` is the shape: headline, sub, detail, honesty
strips, links. It renders **IN PLACE above the form and scrolls itself into
view** — the save button is at the bottom of a phone screen, and an
acknowledgement at the top that nobody sees is the same as no
acknowledgement at all.

**WHAT CARRIES IS ARGUED PER FORM, and it came out differently on almost
every one** — the same finding as the header/lines split:

| form | carries | and why |
|---|---|---|
| bill | date | a stack of bills is one delivery day and several suppliers |
| issue | date + session | a shift is the frame you are working inside; the department is the question just answered |
| production, kitchen loss | date + department | a chef is standing in one kitchen |
| **closing** | date only | filing the same department twice is a CORRECTION, not the next entry |
| store loss, voucher, other income, expense | date | a day's entries are written up together |
| vendor return | date | a van at the door means several crates |
| staff | **nothing** | a roster is not a batch: a grade left over from the last hire files somebody in the wrong place |

### Navigating away is allowed, but never silently

Six forms used to `router.push` after a save. Three genuinely should — a
recipe with no lines is useless so adding ingredients IS the next act; a
payroll run is approved on its own page; a statement is imported in order to
be matched. **Three should not**, and did: ItemNew and VendorNew threw you
onto the detail page (masters are created in runs — a delivery brings four
new things at once), and the staff form threw you back to the roster, so
adding three people at induction meant finding the Add link twice more and
the permanent E### code flashed past in a toast.

The gate sweeps every component that calls a server action and requires a
**stated reason** for each one that navigates. A new one fails until somebody
writes down why.

### Two forms keep the full-screen reveal, and the line is principled

**The count and the day close.** In both the reveal IS the deliverable — the
variance table, the ladder and its WhatsApp text — and there is no next entry
that day, so replacing the form costs nothing and hiding it costs nothing
either. Everywhere else the entry repeats, and the reveal is an interruption
before the next one.

**Where the save writes a row into a list on the same screen** — masters,
lists, partners, money accounts, settings, the mapping queue — **the row is
the acknowledgement**, and a toast carries the confirmation. Saying it twice
is not more honest. But rule 1 still binds the toast: every one that had a
number available and was withholding it now says it, including the voids
(`res.original` was in scope the whole time and none of them used it).

### Read the figure back; never echo the input

Four actions were extended rather than having the client compute anything:
`saveVendorReturn` now returns the vendor's dues after the credit,
`saveAdjustments` the shelf after the correction, `saveShorts` the value of
the claim and how much of it is still open, `saveAdvance` what the person now
owes against wages. The rule is phase 1's and has not moved: post-save
figures come from the database, not from what was typed.

## The employee profile — a person is the second unit of accountability

`/staff/people/employees/<code>` — E001, E014. The same shape as the
department page and for the same reason: everything about a person already
existed, scattered across four views, with no page to read it together.
Rajesh asked for it after using the attendance sheet, which is the right
signal — the sheet is where you notice somebody and had nowhere to go, so
the NAME is a link there as well as on the roster.

**ONE ADDRESS PER PERSON.** The code is canonical — permanent, human-readable
and the thing people say out loud. The edit form used to live at
`/staff/people/employees/<uuid>`, so that still resolves and then REDIRECTS
to the code URL rather than the app answering to two addresses for one
person; the lookup is case-insensitive, because nobody types E014 in caps
from a phone. The edit form now sits at `<code>/edit`.

**THE ACCOUNTANT IS ADMITTED, AND THE ROSTER'S WRITES WERE UNGATED.** Reading
attendance, runs and advances for somebody is exactly the accountant's job.
The matrix is prefix-based, so admitting them to the profile admits them to
the list too — right, since they already see every person on
`/accounts/payroll/people` and on every run — but `/new` is denied above it,
and editing an existing person shares the profile's prefix and **cannot be
split by prefix at all**. So the real gate went where this repo says a gate
belongs: `createStaff` and `updateStaff` now check manager-or-owner, which
they had **never done** — the route gate had been carrying the whole weight
of two actions that are public endpoints.

`audit:matrix` caught the leak on its first run: the roster's "＋ Add staff"
button was visible to an accountant who cannot open `/new`. It gates on
`canAccess`, one source, never a hand-rolled role comparison.

**THE IDENTITY READ IS GATED, NOT JUST THE RENDER.** A manager opens this
page, and `StaffRow` crosses the wire to them on it — so the page does not
FETCH a single identifier column unless the reader is an owner or the
accountant. Filtering the render would ship an account number and a date of
birth in the RSC payload of somebody who has no reason to hold either. The
gate asserts the call is conditional, and it was proved by making it
unconditional and watching the gate name it.

**Two things the brief asked for that the schema does not have**, said on the
page rather than invented: there is no `emergency_contact` column on `staff`,
and there is no Aadhaar column anywhere — 0014 added bank / PAN / UAN / PF /
ESIC / DOB / gender and nothing else. The contact card says so in words. A
field the database refuses is a field the form must not collect.

### Cannot apply, cannot be assessed, and an empty ledger are three things

The distinction the department page draws, drawn again, and the ORDER of the
branches is load-bearing:

- **CONTRACT staff can NEVER appear on a payroll run** — their vendor bills
  for them, and `labour_cost_by_section` has excluded them since phase 5. The
  contract branch comes FIRST on the Paid card, because "no payroll run has
  included this person yet" would promise a run that is not coming. The gate
  asserts that ordering, not merely that both branches exist.
- **No run yet** is genuinely unassessable, and an empty table is a shrug.
- **An empty advance ledger is a FACT**: nothing is outstanding because
  nothing was ever lent. `NotApplicable`, not `Unassessed` — nobody owes an
  entry.
- **A retired person with no marks** is not a gap either; their earlier
  months are still on the record and the card says to widen the period.

**A blank day is drawn as the honesty meter's empty cell**, dashed, not as an
absence — the same law the sheet now states above itself. **`absent_pct` is
recomputed over the period's own totals** rather than averaging the monthly
percentages, which would weight a three-day month like a thirty-day one.

**Late hours are shown and never priced.** "14 hours beyond the normal day
across 3 shifts — recorded, never priced. What overtime is worth is a
decision, not a calculation this app makes."

**DRAFT IS NOT MONEY THAT MOVED.** The Paid table carries the run status, and
a strip counts the runs that are still draft or approved: only a line with a
`paid_on` date has left an account and reached the wages register.

## A FEATURE REPORTED LIVE WHOSE SURFACE WAS NEVER BUILT

Extra hours were merged, deployed, and unreachable. Not a condition that
never fired — **there was no write path at all.** `extra_hours` existed only
on the read side: the profile rendered it, the query selected it, the type
declared it. `AttendanceSheet` had no control, `MarksSchema` had no field and
the app's insert did not name the column. The migration was applied, the gate
went green, and I reported it shipped.

**WHY EVERY GATE STAYED GREEN, and this is the whole lesson:** the hours gate
wrote its OWN insert —

```
await tx`insert into attendance ${tx(rows, …, 'extra_hours', 'entered_by')}`
```

— so it proved the VIEW computes `worked_days × 8 + extra` and proved nothing
about whether the APP could write that column. This file already records the
rule, from the RLS phase, in these words: **"A probe that writes its OWN
insert cannot test the app's column list."** Nine multi-line saves broke
exactly that way. It happened again because the gate was written to test the
migration, and the migration was the half that worked.

**So a feature's gate must go through the front door.** `smoke:a2` now calls
`saveAttendance` itself, and reintroducing the bug — deleting `'extra_hours'`
from the insert list — fails it by name.

### THE FIRST VERSION OF THAT GATE COULD NOT FAIL EITHER

It converged: it saved 3h, and on every later run `saveAttendance` correctly
inserted nothing because nothing had moved — so the assertions passed against
a row an EARLIER RUN had written. Deleting the column from the insert list
left it **green**. Caught only by trying to break it.

**A gate whose evidence predates the run is not evidence.** It now reads the
current value and writes the OTHER one: exactly one insert per run, always
this run's, always checkable. `attendance` is INSERT-only and kb_app holds no
DELETE — checked in `table_privileges`, where a TABLE privilege actually
lives — so the probe cannot tidy after itself, and one row per run on a
sentinel date 74 years out is the honest price of testing a write path on an
append-only table through its own front door.

### The second half: the BUILD is real and the SURFACE is not

Twice now — the accountant missing from the Users dropdown, and this. So
there is a gate for the surface too: it asserts the control is offered on a
present or half row, withheld on off/leave/absent, and that the value is
actually SENT. **A component that exists is not a surface that appears.**

**EXTRA HOURS ON A DAY NOBODY WORKED IS NOT A THING.** The sheet offers the
input on present and half only; moving a day to off/leave/absent clears any
hours on it rather than leaving a value the server would refuse after the
whole sheet had been keyed in. The server refuses it BY NAME anyway — and
refuses a 0, because a normal day is the ABSENCE of a value.

**THE HOURS ARE PART OF WHAT CHANGED.** `saveAttendance` compared status
alone, so typing three hours against an already-saved P inserted nothing and
reported "nothing changed". The comparator now reads both, and the sheet's
Save button counts an hours-only edit as a change.

### Four broken regexes, and the one that had been passing blind

The new gates first failed on live-and-correct code. The cause was mine: the
assertions were generated inside a Python **raw** string, so `\\\\b` reached
the TypeScript source as four backslashes and every one of those `RegExp`s
matched nothing. Three were `assert.ok(match)` and failed loudly. **One was
`assert.ok(!match)` and would have passed forever** — a check for the ABSENCE
of something, built on a pattern that could never match. They are plain
`includes()` now.

**The general form: an assertion that something is ABSENT must be shown to
fire when it is present.** A positive assertion announces its own breakage;
a negative one is silent, and silence is what it reports either way.

## Emergency contact is manager-visible; Aadhaar and address are not

Five columns, and the split is the design. **The person who needs an
emergency number at eleven at night is the one running the shift** — so
`emergency_name` / `emergency_phone` / `emergency_relation` sit on `StaffRow`,
which is what makes them manager-visible, and the profile says so when there
is nobody to call: that is the one field whose absence is only ever
discovered at the worst possible moment.

`aadhaar` and `address` join the identity block: owner and accountant only,
**gated on the READ**. The guard is not "do not render them" — it is that
they must not be SELECTED by any query whose result reaches a manager, and
`StaffRow` does. A gate asserts they appear in the identity read and in
neither roster query, and it was proved by adding `st.aadhaar` to
`STAFF_SELECT` and watching it name the file.

## A PERSON'S NAME IS A DOOR

The profile shipped and the roster and the attendance sheet linked to it; the
staff dashboard, the payroll run, the advances table, the accountant's people
list and the advance form did not. **Inconsistent is worse than missing** — a
reader learns the name is SOMETIMES a link and stops trying.

`src/components/labour/PersonLink.tsx` is the one component, and it takes no
role prop: every surface that mounts it is already manager / owner /
accountant, and if it is ever mounted somewhere a chef or cashier can see,
`audit:matrix` fails on the href rather than the component guessing.

**A `<select>` option cannot hold a link**, so the advance form puts the door
on the person who has actually been CHOSEN — which is the better place
anyway: the question an accountant has once they have picked somebody is what
else that person already has against them.

### The gate took three tries, and each failure is the same shape

1. **Per file.** It asked whether the FILE mentioned `PersonLink` anywhere, so
   a file with two person tables passed while one rendered plain text.
   Removing a link from the dashboard left it green.
2. **Per site, too loose.** Matching the substring `{r.name}` also matched
   `name={r.name}` (the fix), `${r.name}` (a template literal) and
   `{r.name}: extra hours` (a screen-reader label) — three false positives on
   correct code.
3. **Per site, and the guard counted the wrong thing.** With the matcher
   right, bare renders fell to zero — so `checked >= 5` failed. The guard was
   counting the thing being ELIMINATED. It now counts files that name a
   person at all and files that mount `PersonLink`, either of which stays
   non-zero when the code is correct.

**The rule under all three: a guard must count something that survives the
fix.** A sweep whose denominator goes to zero when the bug is gone cannot
tell "clean" from "not looking".

A render site is a WHOLE JSX CHILD — `>{r.name}<`. That definition is what
makes the check precise enough to be worth having.

## LINK TO A PAGE THAT GATES A FIELD; DO NOT LINK TO A PAGE THAT GATES ITSELF

The rule that decides whether an entity becomes a door, and it is the
distinction that separates `PersonLink` from `DateLink`.

**`PersonLink` works because the employee profile exists for EVERY role that
can reach it and gates a BLOCK WITHIN IT.** A manager opens it and simply does
not receive the identity fields — the page is theirs, minus one card. So the
name can be a link on any surface a manager or owner can open, and
`audit:matrix` is enough to police it.

**The flash report gates the WHOLE PAGE.** `/owner/day` is manager+owner, so a
date link on a cashier surface is a link to a wall. "Dates are links
everywhere" was therefore withdrawn: it could not be satisfied without
breaking LAW 1, and **an assertion that would require a LAW 1 violation to
satisfy is a bad assertion.** None was written.

**WHAT REPLACES IT: a date links to the day view its reader is allowed to
see — a per-surface decision, not a global rule.** Nobody is missing a view;
each role already has its own.

| Reader | Their day view |
|---|---|
| owner, manager | `/owner/day/<date>` — the flash report |
| cashier | the day's sales and the close ladder, which are cashier surfaces |
| chef | the kitchen dashboard and the department pages |

So `DateLink` stays exactly where it is: the sheet's own prev/next and its
strip of recent days, both on an owner-only surface.

**And the flash report is NOT made role-aware**, for two reasons. A page that
differs by role is a different page, so "looks identical every day" — the
property the whole artifact rests on — would be false. And a flash report is
read fast AND COMPARED AGAINST YESTERDAY'S: a version that differs by who is
holding the phone is a different report wearing the same name.

Ask of the next linkable entity: does its page gate a FIELD, or gate ITSELF?

## The tooltip says it in words, and the hours are a column

"19 Aug 2026 — present +2h · corrected ×1" became "19 Aug 2026 · present ·
worked 2 extra hours · corrected once". `+2h` is shorthand a reader has to
decode, on the one fact that matters most — somebody worked longer than their
day — and a tooltip is read once, in passing, by whoever is trying to
understand a number. It can afford the characters.

Extra hours joined the stat row as a seventh column. It is a fact about the
period exactly like the other six, and it is the only one that **costs money
nobody has priced**, so leaving it in prose underneath made the cheapest-
looking row the expensive one. Violet, the same ink as the dot on the strip —
an identity, not a status: nothing is wrong and nothing is in doubt.

## getRestaurant() honours an announced tenant — the precondition for a second one

With no session it read `limit 2` and refused when more than one restaurant
existed, in those words: *"every path must carry a tenant before a second
tenant is created"*. That refusal is right, and it means **creating any
second restaurant takes down every gate that calls a server action** —
`saveAttendance`, `updateStaff`, all of them go through `getRestaurant()`.

So it now consults `currentTenant()` first. Every smoke suite already wraps
itself in `withTenant(KB_TENANT)`, so they answer for themselves; the
limit-2 fallback stays underneath for the genuinely unannounced case, and
still refuses. Request paths are unchanged — the session branch returns
before either.

## THE PROBE TENANT — and the provisioning specification it wrote

`KB_PROBE_TENANT` is a second restaurant whose only purpose is being written
to by gates. It exists because `attendance` is INSERT-only and kb_app holds
no DELETE, so a probe that proves a write path **cannot tidy after itself** —
which meant one sentinel row per run accumulating in Thrayam's own books.

**Adding a DELETE grant was refused and should stay refused.** Append-only is
what makes the ledger worth trusting; opening it so a test can tidy trades
that property for convenience. A second tenant fixes it at the root instead.

**It is not a workaround, it is a second gate.** `smoke:tenancy` now proves
isolation against a REAL, populated tenant rather than only a synthetic one —
the easier half, since a tenant that does not exist has no rows to leak. The
sharpest assertion: **E001 exists in both restaurants and is a different
person in each** — Arun UV against Probe Cook. The key a human reads is
identical on both sides, so a leak would be unmissable.

**NAMING A TENANT "PROBE" GUARANTEES NOTHING.** So the rule is enforced
empirically: `smoke:a2` counts every row in **33 event tables** of the LIVE
tenant before the suite runs and again after, and fails naming any table that
moved. It covers the rolled-back probes correctly too — a transaction that
discards leaves the counts where it found them — and it caught the live write
on its first run (`attendance: 32 → 33`). Proved able to fail by pointing the
probe back at the live tenant.

**The precondition, shipped one commit earlier:** `getRestaurant()` refuses
with no session once more than one restaurant exists — by design, and in
those words. Creating any second tenant would have taken down every gate that
calls a server action. It consults `currentTenant()` first now.

### What a tenant needs — most of the provisioning story, written by doing it

The first restaurant created after Thrayam, so what it needed IS what a
signup will need. **The split is the useful part:**

| Per tenant | Global, shared |
|---|---|
| `restaurants` row | `categories` |
| `sections` — the org units, with `receives_stock` / `codes_dishes` / `dept_kind` | `units` |
| `list_options` — the whole managed vocabulary | `starter_library` |
| `course_targets` | |
| `expense_category_kinds` | |
| `settings` — timezone, business_day_start, standard_hours_per_day, fy_start_month, input_tax_creditable | |

Seeded here: 16 sections (12 receiving stock, 7 coding dishes, mirroring
Thrayam's shape), 90 list values, course targets, expense category kinds and
five settings. **Everything else is earned, not seeded** — vendors, items,
staff, recipes and every event table start empty, which is the first screen
this app was designed for and the reason "zero vendors and zero items is the
normal starting state" has been a rule since phase 1.

**Two things a signup will need that this seed did not:** an owner in
`app_users` (the probe tenant has none, and does not need one — no session
ever signs into it), and the `KB_TENANT` deployment variable, which is what
still makes LOGIN single-tenant. That remains the open item before a second
restaurant has real users: authentication crosses tenants by definition, and
the permanent form is a SECURITY DEFINER function resolving a username to its
tenant.

## LOGIN IS MULTI-TENANT — and REVOKE ON SUPABASE IS NOT WHAT IT LOOKS LIKE

### The rule, first, because it is the transferable part

**`revoke all on function … from public` is NOT enough on Supabase.** Supabase
grants EXECUTE explicitly to `anon`, `authenticated` and `service_role` by
default, and **an explicit grant survives a revoke from PUBLIC**. So a
function revoked from PUBLIC and believed private was callable with the ANON
key — on `tenant_for_username`, the one function in the schema deliberately
designed to be narrow, that is a username-to-tenant **enumeration oracle**.
`next_doc_no` had the same exposure plus PUBLIC from its own creation.

> **On Supabase, name `anon`, `authenticated` and `service_role` explicitly
> when revoking — and then read `routine_privileges`. A revoke that did
> nothing looks exactly like one that worked.**

Postgres compounds it from the other side: **EXECUTE on a new function is
granted to PUBLIC by default**, so every function is public until somebody
takes it away. Two independent sources of exposure, neither visible in the
`create function` statement. Verified after the fix: `tenant_for_username`
and `next_doc_no` are kb_app-only. (`business_date` and
`standard_hours_per_day` still carry PUBLIC, and are SECURITY INVOKER — RLS
still applies to what they read, so they leak nothing; tightening them costs
nothing either.)

### The one read that crosses tenants

`tenant_for_username(text) -> uuid`, SECURITY DEFINER, `search_path` pinned,
EXECUTE to kb_app alone. It returns ONLY the tenant — never the hash, never
the role, never whether the password is right — so authentication itself
still happens inside the policy, on a read scoped to the tenant that came
back. That is what makes the hole exactly one lookup wide.

### ONE FAILURE PATH, and the oracle was in the round trips

The definer function DOES leak whether a username exists; it must. What stops
that mattering is `verifyCredentials`, where unknown, retired, ambiguous and
wrong-password all converge on a single `return null`.

**Two things had to be equalised, and only one was obvious.** The bcrypt
compare runs on both paths — against a throwaway hash when there is no user —
because skipping it makes "no such person" measurably faster. That was
designed in from the start.

**The DATABASE READ was the one that got away.** Skipping the `app_users`
lookup when the username did not resolve saved one round trip, and the gate
measured it: **unknown 589ms against wrong-password 723ms, Δ 134ms.** An
enumeration oracle with a stopwatch. An unresolved username now announces a
tenant that owns nothing, reads nothing, and costs the same — Δ 11ms, stable
across runs, and asserted by TIMING rather than by inspection. Proved able to
fail by restoring the early skip.

**The lesson beyond auth: "same branch" is easy to assert and easy to be
wrong about.** Two paths through the same code can differ by a round trip
nobody wrote down. Where the difference is what an attacker measures, measure
it.

### KB_TENANT is DELETED

It was the crutch that kept `/login` alive when RLS went on, and it became a
liability the moment a second restaurant existed: a deployment still naming
one would silently override a correct username lookup and check the password
against the WRONG tenant's users — **the exact fault Phase 1.5 removed,
reintroduced through the environment.** Gone from `txn()`, from the code and
from `.env.local`, and asserted absent rather than left unread: an unused env
var is one `??` away from being used again. A null tenant announces NOTHING,
which under RLS returns nothing loudly instead of somebody else's rows.

`KB_LIVE_TENANT` replaces it in the SCRIPTS only, and is a different kind of
thing: a test fixture telling the gates which books are the real ones so they
never write there. It is never read by the app.

**Two pages render without a session and both had to stop naming a
restaurant.** `/login` printed `getRestaurant().name` above the form — which
becomes a 500 on the one page nobody can get past, because `getRestaurant()`
refuses to guess between two tenants. Naming the tenant before knowing who is
signing in was always a single-tenant artefact. `/setup` catches the same
ambiguity and reports it as closed, which it is: with two restaurants on the
pool it is closed by construction as well as by having users.

### Two restaurants have both signed in

`smoke:tenancy` proves it: a user of the probe tenant signs in, their session
is stamped with THEIR restaurant, our five vendors are invisible to them,
and `rajeshanne` still resolves to Thrayam. The probe account is given a
**fresh random password on every run and reset to another one afterwards** —
`app_users` has no DELETE grant, so the row persists by design; what must not
persist is a usable credential on a production database.

## Phase D — sales: the mapping queue is the whole game

213 orders, 1,002 lines, ₹3,93,717 over three days and **zero mapped POS
items** — 94% of revenue belonging to no department. `sales_by_section`,
`section_food_cost`, margin, the department pages and dish quantities sold
were all built and all dark, fed by one empty table.

**A POS ITEM MAY POINT AT A DEPARTMENT, NOT ONLY A DISH**
(`pos_item_map.section_id`). Bottled water sold 88 units and will never have
a recipe; without this its revenue sat outside every department permanently.
A dish gives the department AND the cost; a department alone gives the
department — most of the value, and the honest answer for anything bought and
resold. **`recipe_id` WINS when both are set** and `saveMapping` clears the
direct section rather than storing both: the dish's own section is the truth,
and a second answer to one question is not a fallback.

**COVERAGE IS THE HEADLINE, NOT A COUNT.** "218 unmapped" reads as an
impossible chore; "51% of revenue attributed" reads as progress — and it is
the honest metric, because mapping a water bottle and mapping the biryani are
not the same act. `mapping_coverage.revenue_mapped` comes back **NULL, not 0**
when nothing is mapped (a sum over no rows), and the screen keeps that apart
from a real zero. `items_costed` is the second number: attributed-but-not-
costed is a state, and the strip says so.

**"The next 7 rows carry another 10%"** is what turns an endless queue into a
morning — it says where the money stops being worth chasing. Computed from a
running prefix over what is still unmapped, so it shrinks as work is done.

Coverage is an **action card** on the Sales dashboard and the 218-row queue
lives behind it — the same shape as Reorder inside Stock: a long list must not
dominate a page nobody opened for it.

**THE CHEF IS ADMITTED** (`/sales/books/sales/mapping`, the one sales path
they may open). The cashier is in Sales daily, but the chef knows which POS
name is which dish. `audit:matrix` immediately caught the back-link — the chef
can open the queue and not the sales books around it — so it gates on
`canAccess`.

**MAPPING KEYS ON PETPOOJA'S INTERNAL ITEM ID, NEVER ITS `itemcode`.** The
sheets work established that itemcode has no uniqueness check: five codes
shared across two or three items, one truncated at 20 characters. The code is
for humans, the id is for machines.

### The payment split is bars, not a donut, and the palette is why

`CAT` holds exactly three hues cleared by the validator (CVD ΔE 25.3), and
`LabourSplit` cycles them with `CAT[i % CAT.length]` — correct for three
categories, and it would repeat colours across seven payment modes. So the
split is direct-labelled magnitude bars, where identity is carried by the axis
label and no hue is asked to do work it cannot. That is also the sharper
contrast with the POS's own dashboard, which reports three quarters of a day
as "Other" precisely because it cannot tell the modes apart.

### The trading day, and the anomaly that is not smoothed

`sales_by_hour` on the dashboard: two services show as two humps, and that
shape says more than the total — a place with one peak and a place with two
are run differently. `per_cover` is NULL where covers is zero; the view
already refuses that division.

**Noon reads ₹2,048 per cover against ₹771 at 2pm.** Almost certainly covers
under-counted at opening rather than spend being three times higher — so the
card NAMES it as a Petpooja data-entry question rather than charting past it.
Any hour more than 2.5× the period's median per-cover is called out.

### A refresh button, not a live view

Polling, websockets and auto-refresh would be infrastructure competing with
Petpooja's own dashboard, **which is itself not live** — its terminal syncs
periodically. So: one button that fetches TODAY on demand, one API call, and
the re-fetch semantics already exist.

Two rules ride with it. **STATE THE FRESHNESS, ALWAYS** — "41 orders ·
₹52,300 · as of 9:42 pm", and how old when it is old. What we can honestly
state is when WE fetched; the caption says Petpooja's own sync may be older
rather than implying our fetch time is the POS's. And **TODAY IS A PARTIAL
DAY**: it never enters the day-close chain, and every figure from it is
captioned "the day so far", or somebody compares half a day against
yesterday's whole one.

### A range is N calls, and it loops in the client

Get Orders returns two days per call (D and D-1) and is keyed on one business
date, so a range is N round trips, not one. It loops the existing per-day
`fetchDay` rather than growing a bulk endpoint — which leaves the per-day
dedupe and latest-fetch-wins untouched by construction, and gives per-day
progress for free. A spinner over five days would just look hung.

### The gate that had to be sharpened rather than silenced

`sales_current` now SELECTS `order_time` — `sales_by_hour` reads it from
there. The order_time gate forbade the view MENTIONING it and fired. But
selecting a column is not keying on one: what must never happen is order_time
appearing in the JOIN, a WHERE, a DISTINCT ON or an ORDER BY, because that is
where "which fetch wins" and "which duplicate is skipped" are decided. The
check is narrowed BY STRUCTURE — everything from `FROM` onwards — and proved
still to fire on a real join. Blinding it to the name would have been the easy
fix and the wrong one.

## The payload census — key NAMES only, and the two questions it settles

We store no raw Petpooja payload, so a field could arrive on every fetch and
leave no trace. Two questions were unanswerable from this side: does Petpooja
send an `itemcode`, and does it send any of the leakage fields its own
dashboard reports — KOT cancellations, bill modifications, re-prints, waivers,
a biller identity?

So the fetch reports WHAT IT WAS SENT: the union of key names at each level,
plus candidates matched by MEANING (`/kot|cancel|modif|reprint|waiv|biller|…/`)
rather than by an exact key we would have had to guess right. It renders on
the fetch reveal, is read once by a person, and is **not persisted** — a
census of a payload carrying customer names and phone numbers must not become
a copy of it.

**NOT ONE VALUE CROSSES THE BOUNDARY, and that is the assertion that matters.**
`smoke:a2` runs a synthetic payload whose customer name, phone, item name and
item code are all the same distinctive string, and asserts that string appears
nowhere in the census. Proved able to fail by making the key-union carry
`key:value` — the perturbation that would be easiest to write by accident.

**Mapping keys on Petpooja's internal item id and always will.** If the census
finds a code it may be SHOWN beside the name to ease matching; it must never
be keyed on, because the sheets work established that item codes have no
uniqueness check — five codes shared across two or three items, one truncated
at 20 characters.

## Pruning superseded fetch bodies — why this DELETE is not the attendance one

`migrations/pos_prune_superseded_fetch_bodies.sql` (**written, not applied**)
grants DELETE on `pos_orders` and `pos_lines`.

Every other event table holds something only WE hold; it cannot be
reconstructed, so it is append-only and a correction is a reversal.
`pos_orders` is **a cached copy of somebody else's system** — Petpooja holds
the truth, a fetch is a photocopy, and a re-fetch takes another one. Deleting
a superseded photocopy loses nothing that cannot be fetched again. That is the
whole distinction, and it is why the refusal on `attendance` stands.

Measured on live data, a re-fetch re-inserts the fetch row AND every order and
line: 71 orders and 334 lines a day, so fifty refreshes in a service is 3,550
orders and 16,700 lines for 71 and 334 of truth.

**THE TRADE, recorded because it is a real loss:** the DIFF between two
generations of one date is a bill-modification signal — an order whose total
changed between fetches was edited after printing, which is exactly what
Petpooja's Leakage panel reports. Pruning discards it. Accepted because a
direct field beats a diff, and the census settles which within one fetch —
**if the census comes back with no modification fields, reopen this**, since
the diff is then the only copy of that signal.

Every `pos_fetches` row is KEPT: it is the audit trail and carries the note.

## POS receivables — a queue, because the POS never knows who owes

`payment_mode = 'Due Payment'` is billed and nothing collected; `'Part
Payment'` is billed and not all collected. Both are receivables the POS knows
about and `due_payments` — manual-entry only — never heard about. Live: ten
orders, ₹18,330.

**AN AUTOMATIC WRITE IS IMPOSSIBLE, not merely unwise.** `dues_outstanding`
nets on `lower(trim(party))`, and the POS carries the amount and the order but
never the person — so an automatic row would have to invent a party name, and
every invented name is a permanent second entity in a ledger that nets on
names. Hence a queue somebody confirms.

**Due Payment asks WHO** — the whole bill is owed, so the amount is the POS's
own figure, prefilled and editable rather than guessed. **Part Payment asks
WHO AND HOW MUCH**, because the POS gives the order total and not the split;
the total is shown for reference and never written as the amount.

`due_payments.ref` carries `pos:<date>:<order id>` — no migration needed — and
that is what makes a second confirmation impossible rather than unlikely: the
queue excludes anything already referenced, and `confirmPosReceivable`
re-checks it INSIDE the transaction, because a queue open in two tabs is
exactly how a receivable gets entered twice. A debt larger than the bill is
refused by name.

Unconfirmed rows stay visible as a FINDING, not a gap: the POS knows we are
owed money and our books do not.

## Auth secrets: state the property precisely, because "the app is blind" is false

I wrote that a definer function could return "a payload, never the
credentials". **That is wrong if the app makes the HTTP call** — it must hold
the secret at that moment, in memory, unavoidably. The only way it would be
true is issuing the outbound call from Postgres (pg_net), which is a real
architectural choice with its own debugging cost and is NOT what is proposed.

What a `SECURITY DEFINER` accessor actually buys, stated exactly:

- `kb_app` holds no SELECT on the credentials table, so a leaked app-role
  connection cannot enumerate every tenant's POS keys;
- access goes through one function, which can be logged;
- secrets at rest live in **Supabase Vault**, not a plaintext column.

The app still handles the key it uses, for as long as the request takes.
Nobody should believe otherwise.

## THE FIVE TABLES THAT MAY BE DELETED FROM — one reason in five costumes

`kb_app` holds DELETE on exactly five tables, and the count is not the point;
the reason is, and it is the same reason every time:

> **A row may be deleted only when it asserts an INTENTION nothing depends on
> yet, records a JUDGEMENT that was never true, or CACHES a fact somebody else
> holds. Never when it is an event only we hold.**

| Table | Which kind | Why |
|---|---|---|
| `recipe_lines` | intention | a card is a description of a dish, always editable |
| `indent_lines` | intention | a request nobody has acted on; frozen the instant an issue stamps it |
| `reconciliation_matches` | judgement | a wrong match was never true, so there is nothing to reverse |
| `pos_orders` | cache | Petpooja holds the truth; a fetch is a photocopy |
| `pos_lines` | cache | same, and they follow their order by cascade |

`smoke:a2` reads `table_privileges` and asserts the list BY VALUE, and that
every name on it appears in this file. **A sixth table appearing without its
argument written here fails the suite** — which is the point: the list stays
short because adding to it costs an argument, not a grant.

## Pruning superseded fetch bodies — applied, and how it is held

`pos_lines.order_id` is **ON DELETE CASCADE** (Rajesh changed it from NO
ACTION on apply — the app would otherwise have had to delete lines first, and
forgetting the order is a foreign-key error at prune time that nobody would
meet until a re-fetch). So removing orders is sufficient and the ordering
stops being something anyone can get wrong. Safe under RLS: only our own
orders are deletable, so the cascade can only reach our own lines.

**THE PRUNE KEYS ON THE FETCH ID, NOT ON `fetched_at`.** Anything ordering by
time would be a second opinion about which generation wins and could disagree
with `latest_fetches`; "everything for this date that is not what I just
wrote" cannot. It runs inside the same transaction as the insert.

**`pos_fetches` KEEPS EVERY ROW** — the audit trail, and it carries the note.
That is enforced by GRANT (kb_app has no DELETE on it at all), not by
discipline, and the gate asserts the absence of that privilege.

Two assertions, both proved by breaking them:

1. **N refreshes leave ONE generation and N fetch rows.** Self-demonstrating,
   because the gate runs on the probe tenant and commits: the fetch rows
   accumulate across runs and the bodies do not. Disabling the prune fails it
   with "3 generations of orders survive".
2. **The prune is invisible to every reader** — `latest_fetches` still
   resolves to the newest, and `sales_by_day` is byte-identical across it.

**THE FIRST VERSION OF (2) COULD NOT HAVE FAILED.** Both generations carried
identical figures, so "byte-identical before and after" was trivially true.
It now writes a third generation with DIFFERENT figures and observes the
moment between insert and prune — which `persistFetch` deliberately does not
expose, so the gate does it by hand inside a rolled-back transaction.
Inverting the prune to remove the NEW generation fails it with
`(1,7,999) -> null`: the reader seeing something different, which is the whole
property.

Also caught while checking orphans: `pos_lines` with no surviving order would
be the signature of a cascade that silently stopped working, so the gate
counts them and requires zero.

## AN ASSERTION THAT PASSES BECAUSE NOTHING COULD HAVE DIFFERED IS NOT AN ASSERTION

Three times now, in three costumes:

| | Why it could not fail |
|---|---|
| the converging attendance probe | the row it checked had been written by an EARLIER run |
| the extra-hours gate | it wrote its own insert, so the app's column list was never exercised |
| the prune's invisibility check | both generations carried IDENTICAL figures, so "byte-identical before and after" was true whatever the prune did |

**The fix has been the same all three times: make the two sides genuinely
different before comparing them.** A different value this run, a write through
the app's own front door, a second generation whose numbers differ. If you
cannot say what the assertion would look like when it fails, it is not
asserting anything.

## THE VIEWS RAN AS THEIR OWNER — 22 of them, and 13 leaked across tenants

Found while answering a question about sentinel rows: `day_summary` returned
TWO rows for one date, and the two labour figures were ₹40,000/31 and
₹24,000/31 — salaries from **two different restaurants**.

**A view without `security_invoker` runs as its OWNER.** The owner here is
`postgres`, which has BYPASSRLS, so every policy on every base table is
skipped and the view hands back every tenant's rows. Measured as kb_app with
bypassrls off, announcing the probe tenant and counting the live one's rows:

    attendance_current 15 · labour_cost_daily 15 · day_summary 11 ·
    vendor_supplied_items 7 · vendor_dues 5 · vendor_performance 5 ·
    attendance_summary 3 · labour_hours_by_section 3 ·
    sales_per_labour_hour 3 · section_frequent_items 3 ·
    headcount_by_section 2 · advances_outstanding 1 ·
    business_day_disagreements 1

Vendor balances, attendance, staff advances and a whole day's trading.

**NINE MORE CARRY THE SAME DEFECT AND DID NOT LEAK, WHICH IS WORSE THAN
LEAKING.** They were saved by an INNER view that happens to be scoped —
`sales_current` joins `latest_fetches`, which has the option, so the join came
back empty. Nothing about those nine is safe; they are one migration to a
neighbouring view away.

**Why the app did not leak anyway, and why that is not reassuring:** every
read in `src/server` names its tenant in a WHERE clause, and tier 2 of
`audit:tenancy` asserts it — 0 unkeyed reads. So the app was protected by its
own discipline and NOT by RLS. That is precisely the backstop RLS exists to
be, and one forgotten `and restaurant_id = …` would have made it live.

**THE GATE WALKED 65 TABLES AND NEVER ONCE LOOKED AT A VIEW** — the eighth
instance in this project of a check structurally incapable of finding what it
exists to find, and the most expensive. `audit:tenancy` has a fourth tier now,
and it stays red under `--strict` until
`migrations/views_security_invoker.sql` is applied.

## CREATE OR REPLACE VIEW SILENTLY DROPS reloptions — so the rule has two halves

> **EVERY VIEW CARRIES `security_invoker = on`, AND `create or replace view`
> DROPS IT — so any migration that replaces a view must set it again in the
> same migration.**

This is why the leak was not simply "views created after 0024". `vendor_dues`,
`sales_current` and `attendance_current` all HAD the option and lost it when
they were replaced for unrelated reasons. Nothing warned; the replacement
succeeded, the view worked, and it silently began running as its owner. It
reopened every single time anybody touched a view.

**A habit could never have held this.** Tier 4 of `audit:tenancy` is what
makes it stick — it reads `pg_options_to_table` for every view in the schema
and fails `--strict` on any that lacks the option.

### A view that leaks is invisible to a test that reads it as postgres

`postgres` has BYPASSRLS, so every view returns everything and nothing looks
wrong. **The only measurement that works is: as kb_app, announcing ONE tenant,
counting the OTHER tenant's rows** — and it only works because a second tenant
exists at all.

`smoke:tenancy` now does exactly that for **all 73 tenant-scoped views**, every
run. That is the probe tenant earning its keep a second time: it was created so
the gates would stop writing to the live books, and it turns out to be the only
instrument that can see a cross-tenant read.

## The owner day sheet — a flash report

`/owner/day/<date>`. A standard restaurant artifact: Restaurant365 and
MarketMan build their daily workflow on one, URY computes a daily P&L,
Petpooja gives the money-in half. What makes a good one is that it FITS ON A
PAGE, LOOKS IDENTICAL EVERY DAY so the eye learns where to look, and answers
"did yesterday go well" in fifteen seconds.

**THE ORDER IS FIXED AND IS NEVER RE-SORTED BY WHAT IS INTERESTING TODAY.**
Header · money in · money out · the three ratios · collected for others ·
cash. That is the opposite of the owner dashboard, which ranks by what is most
wrong — and correctly, because it is triage across many subjects. This is one
subject read the same way every morning, and a page that reshuffles is a page
nobody learns.

**ISSUED IS NOT CONSUMED, and the page says ISSUED.** A kitchen draws ten
kilos on Monday and cooks it over three days. Consumption is opening + issued
− closing, and a closing exists only if the chef filed one that night — so the
food-cost ratio appears only where EVERY closable department has closed, and
says which ones have not otherwise. A daily food cost built on issues alone is
noise wearing a percentage.

**WHAT THE PEERS DO NOT DO, and it is the differentiator:** their flash
reports render ZEROS where data is missing, so a day with no bills entered
reads as a day with no food cost and the ratio looks superb. `day_summary`
coalesces its money columns to 0 and would do exactly that — so
`getDayEvidence` returns the COUNTS (bills, issues, marks, roster, closings,
fetches) and every card declares which one it rests on. **A flash report is
read fast, and a fast reader believes a number.**

Against today's data the page is honestly thin: 3 fetches, 0 bills, 0 issues,
0 of 2 marked, 0 of 9 departments closed. It says that, in words, rather than
printing six zeroes.

### A date is a door — but only where the door opens

`DateLink` mirrors `PersonLink` and takes no role prop, for the same reason:
every mount must already be on a surface its reader can open, and
`audit:matrix` fails on the href rather than the component guessing.

**IT IS DELIBERATELY NOT MOUNTED ON EVERY DATE IN THE APP.** `/owner/day` is
manager+owner, and dates are rendered on chef, store and cashier screens — the
fetch list, the day-close ladder, the sales books. A cashier cannot open a
flash report carrying the wage bill, so linking a date there would be LAW 1
broken in the smallest possible way. The drill lives where it is legal: the
sheet's own prev/next and its strip of recent days, which is also the range
grain one tap away — `day_summary` summed over a period IS the owner
dashboard, and one row of it is this page.

## A PAGE NOTHING LINKS TO IS A PAGE NOBODY OPENS

The day sheet shipped with `DateLink` mounted only on its own prev/next and
recent-days strip. **It linked to itself and nothing linked to it** — Rajesh
could reach it only by typing the URL.

**That failure is invisible to every other gate.** The page rendered, its
queries ran, its preconditions were right, and it was dead. So the assertion
is not "the page works" but **"a door exists, somewhere that is not the room
itself"**: `smoke:a2` counts the files mounting `DateLink` and requires at
least one OUTSIDE `src/app/owner/day/`, plus the owner dashboard specifically,
since that is the front door.

The matcher is `/<DateLink[\s/>]/`, a real JSX boundary — the first version
used `.includes('<DateLink')` and passed against a perturbation that renamed
the component to `<DateLinkX`, because that string contains the other. The
same flaw the PersonLink sweep had, made twice.

**Where the doors are now:** the owner dashboard's RECENT DAYS strip (the last
seven days with revenue — a way in, so it is period-independent), the
days-not-closed card, the business-day disagreement rows, the staff
dashboard's attendance sentences, and every marked cell on an employee's
attendance strip.

`/owner/pnl` has none, and that is not an omission: `pnl_diagnostics` reports
`(month, severity, what)` and a month is not a day.

### DateLink GATES ITSELF; PersonLink does not — and that is the same rule

`Card` on the owner dashboard is a `<Link>`, so anything that is itself a door
goes in a new `footer` slot rendered OUTSIDE that anchor. A link inside a link
is invalid, and the days-not-closed card is exactly where that bites: the card
exists to send somebody somewhere and used to name a date with no way to act
on it.

**And `audit:matrix` caught the real one on its first run: the ACCOUNTANT can
open an employee profile and cannot open `/owner/day`**, so the attendance
strip was handing them thirty dead links. A runtime guard in the page does not
satisfy that gate either — the exemption is per-HREF and keyed to the file
holding the literal, which is `DateLink.tsx`.

So `DateLink` asks the matrix itself: a denied reader gets the same text,
unlinked. That is the right shape here and the wrong shape for `PersonLink`,
and the difference is the rule above — **the profile gates a FIELD, so any
reader who reaches it belongs there; the day sheet gates ITSELF, so the
component must check before offering the door.**

## A RULE ITS AUTHOR HAS TO REMEMBER IS NOT A RULE

`meters_readings_and_attachments` was written four hours after the section
above titled **"CREATE OR REPLACE VIEW SILENTLY DROPS reloptions"**, by the
person who had just written it, and it created two views without
`security_invoker`. That needed a second migration,
`meter_views_security_invoker`, the same evening.

That is the evidence, and Rajesh is right about what it proves. Tier 4 of
`audit:tenancy` — which reads `pg_options_to_table` for every view in the
schema — is not a belt on top of a habit. **It is the only thing holding the
rule**, because the author of the rule broke it inside one working session.
Do not remove it, and do not soften it to a warning.

### It was worse than the view, and the same gate caught that too

The same migration created **three tenant tables with no row-level security at
all** — `meters`, `meter_readings` and `attachments`, each with a NOT NULL
`restaurant_id` and a foreign key to `restaurants`, and
`enabled=false forced=false policies=0` on every one.

**A view faithfully running as its caller over base tables with no policies
still returns every tenant's rows.** The option only decides WHOSE privileges
apply; with RLS off there is nothing to apply. So the second migration fixed
the visible half and bought nothing, and only tier 3 — which walks the tables
— said so.

**THE RECORDED VERSION, and it corrects what was first written here.** I wrote
that these tables were "protected by the app's discipline". That was wrong.

> **They were reachable through a key designed to be PUBLISHED, and what
> protected them was that they held zero rows. RLS is the wall; a table without
> it has no wall.**

Measured afterwards: `anon`, `authenticated` and `service_role` each held
`arwdDxtm` — *every* privilege — on all 72 public tables, granted directly by
`postgres`. That is Supabase's default and the same pattern this file already
records for FUNCTIONS. `anon` is the role behind the project's public API key,
and PostgREST is live (`/rest/v1/` answers 401).

What contained it was narrow and is worth knowing rather than assuming: `anon`
and `authenticated` are **NOLOGIN**, reachable only through PostgREST, which
issues SELECT/INSERT/UPDATE/DELETE — all RLS-filtered — and cannot TRUNCATE,
which is the one privilege RLS does not filter.

**Which makes tier 3 of `audit:tenancy` the wall, not a second opinion.** It is
the only thing standing between a table and the open internet, and that is a
sharper stake than the one written here yesterday. It also means the tier-2 keyed-read exemption is NOT safe on these
three: `where id = $1` alone crosses the boundary today. Every query in
`meters-queries.ts` names `restaurant_id` explicitly and says why in a comment.

`migrations/meters_attachments_rls.sql` is **written and NOT applied**;
`audit:tenancy --strict` stays red until it is. `smoke:a2` holds the general
form instead of the instance: **every tenant table without RLS must be named in
a written migration**. That passes now, passes after the migration lands, and
fails the day a fourth table appears with neither.

### THE THIRD `created_at` TIE — FOUND BY A PROBE, NOT BY READING

The meter probe wrote a reading, then wrote a correction for the same date, and
asserted the correction won. **It did not.** `meter_reading_current` was
`DISTINCT ON (meter_id, read_date) … ORDER BY meter_id, read_date, created_at
DESC`, `created_at` defaults to `now()`, and `now()` is the TRANSACTION
timestamp — so both rows carried the identical instant and tied, with the
winner whichever Postgres happened to return first.

Checking the neighbours turned one meter bug into a schema-wide one: **all four
"latest filing wins" views were wrong the same way** — `attendance_current`,
`day_close_current`, `kitchen_closing_current` and `meter_reading_current`.
Every one of them was correct only because the app happens to write one row per
key per transaction, an unwritten property nobody had recorded or tested.

**None of the four had ever been tested, and reading them would not have found
it.** The only thing that did was filing a correction and watching it lose.
That is the point worth keeping: three earlier `created_at` ties in this file
were each found by reasoning about one table, and this one was found by a probe
doing the ordinary thing a user does.

**Fixed STRUCTURALLY rather than by relying on the app.** Migration
`meters_attachments_rls_and_latest_wins_tiebreak` gave `attendance`,
`day_closes`, `kitchen_closings` and `meter_readings` a `bigserial seq`, and all
four views now order by `created_at desc, seq desc`. **`created_at` still
leads**, because it is the truth across transactions; `seq` only decides ties
inside one. So the rule holds regardless of what the app does.

The assertion in `smoke:a2` is KEPT, because it is what would catch a fifth view
written the old way — and it now also holds the ORDER of the two keys, which is
what a careless rewrite loses: it proves the tie still exists in `created_at`,
that `seq` resolves it, and that a row stamped later in time still beats one
merely inserted later. An `order by seq desc` alone would pass the first two and
fail the third.

**Replacing those four views DROPPED `security_invoker` again**, and the same
migration set it back. That is the rule working exactly as written — and it is
the **second time in one day** it would have bitten silently. A habit could
never have held it; tier 4 of `audit:tenancy` is what does.

*(The local `meters_attachments_rls.sql` written here was discarded — the
applied migration supersedes it. The `smoke:a2` check that asserted "every
tenant table without RLS is named in a written migration" went with it: it
existed only to hold pressure while a migration was unapplied, tier 3 of
`audit:tenancy` is the permanent home for that rule, and a second
implementation beside it is a copy that can drift. Same reasoning as the
vendor-return refusal flag, which was deleted rather than flipped once the view
was fixed.)*

## `bigserial` NEEDS ITS OWN GRANT — four write paths broke on production

The tiebreak migration was correct in every respect except one nobody looks at,
and it took out **attendance marking, the nightly day close, kitchen closings
and meter readings** — a restaurant's whole evening — at the moment of SAVING,
after the sheet had already been keyed.

**`bigserial` is not a type.** It is a bigint whose DEFAULT calls `nextval()` on
a sequence the statement creates as a side effect, and **a role needs USAGE on
that sequence to insert the row.** `kb_app` was granted none:

    attendance.seq        -> attendance_seq_seq         USAGE=false
    day_closes.seq        -> day_closes_seq_seq         USAGE=false
    kitchen_closings.seq  -> kitchen_closings_seq_seq   USAGE=false
    meter_readings.seq    -> meter_readings_seq_seq     USAGE=false

    insert into attendance (…)
      -> permission denied for sequence attendance_seq_seq

Proved through the app's own front door, not a hand-written insert:
`saveAttendance` refused a valid mark.

**`GENERATED ALWAYS AS IDENTITY` would have needed NO grant at all.** An
identity column's sequence is reached through the table's own INSERT privilege;
a `serial`'s default calls `nextval()` directly and therefore needs its own.
Two spellings of one intention, one of which quietly requires a second grant.
**Prefer IDENTITY for the next one.**

This is the same family as `column_privileges` not showing DELETE: the catalogue
people check does not contain the answer. `information_schema.table_privileges`
says `kb_app` may INSERT into `attendance`, and that is true and useless — the
insert still fails. The privilege that decides it lives on the sequence, and the
link from the column to the sequence is in `pg_depend`.

`migrations/kb_app_sequence_usage.sql` is written and **NOT applied**;
`smoke:a2` is red until it is. The gate holds the CLASS rather than these four:
it walks every table `kb_app` may INSERT into, finds every column whose default
is a `nextval()`, and fails naming any whose sequence `kb_app` cannot use — so
the fifth one is caught the day it lands, including a sequence created by a role
`alter default privileges` would not cover. It asserts it found at least one
such path first, because a schema with none would pass it vacuously.

## Phase E — meters, and gas as a CHOICE rather than an addition

### GAS IS ALREADY IN THE BOOKS

Measured live before anything was built: `GAS-001 · GAS 19.2 Kg · 4 cans ·
₹12,100`, bought 11 Aug, and **0 ever issued**. A cylinder is STOCK — it
arrives on a bill, sits in `stock_on_hand`, and reaches a department's
consumption when it is ISSUED. Put a gas meter beside that and the same gas is
counted twice: once as an issued can inside COGS and once as an estimated
rupee figure outside it.

So `settings.gas_measurement` is `cylinders` (default) or `meter`, and a gas
reading is **REFUSED** while it says cylinders, in words that name the double
count and say what to do instead. `settings.electricity_metering` is `off` by
default and readings are refused until it is on.

**Is that a legal setting?** This file forbids any setting that could make two
restaurants' food cost percentages mean different things, and this one is close
enough to the line to need the argument written down. It passes because **it
does not let a restaurant CHOOSE how gas is treated — it records which of two
physical situations is true.** A place on cylinders genuinely holds gas in
stock; a place on a piped supply genuinely does not. And it cannot be set
against the plumbing without the app refusing the entries that would follow,
which is what makes it a fact rather than an opinion. `electricity_metering` is
a plain capability flag and changes no number's meaning.

Switching a utility OFF while one of its meters is still active is refused by
name, in **both** directions. Otherwise the meter survives as a form that
refuses every entry typed into it — the state that made `expense_category`
unusable in production.

**The cylinder habit is TAUGHT, and computed rather than asserted.** With gas
on cylinders the Meters screen carries a live table — bought, issued, on hand,
value, straight from the ledger with voided bills and reversal issues excluded
on both sides — and an alarm strip when something has been bought and never
issued: *"the money is on the shelf, not in the food cost."* No new feature;
the issue form already does it. The link to `/store/issue` is a **PROP, never a
literal**, because the accountant can open this page and cannot open that one.

### THE TWO RULES THAT HAD TO REACH THE SCREEN

**a) A MISSED READING BREAKS TWO DAYS, and the figure is left WHOLE.** Read on
Monday and again on Wednesday and Wednesday's row covers two days.
`meter_consumption.days_spanned` says so, and nothing divides by it — halving
would invent a Tuesday nobody measured. Every surface states the span in words
("over 2 days", "first reading"), and the period totals report `days_covered`
— the days actually spanned by readings — rather than scaling up to the length
of the period.

`smoke:a2` holds this **structurally, not by matching copy**: it strips
comments from every file in `src` and fails on any division whose divisor is
`days_spanned` / `daysSpanned` / `days_covered`. (Its first version did not
strip comments, so `*/` at the end of a doc comment followed by `daysSpanned:`
on the next line read as a division — two false positives on correct code,
which is how a gate teaches people to ignore it.)

**b) THE RATE IS AN ESTIMATE, said everywhere a rupee appears.** Electricity is
slabbed, so the true unit cost depends on the month's total and is not known
until the bill arrives. A meter with no rate records units and **no rupee
figure at all** — an estimate of ₹0.00 would read as free electricity.

A reading BELOW the previous one is **accepted and said loudly**, never
refused: a five-digit dial really does roll over and a replaced meter really
does start again, so refusing would stop honest work and a "too big a drop"
threshold would be a magic number. What the app owes instead is never to
present the negative subtraction as consumption — every surface renders it as
"the meter went backwards" and withholds both the units and the cost.

### WHERE IT IS ENTERED, AND WHY THERE

The reading form is on **the day close** (`/sales/close`) — not because
utilities belong to Sales, but because somebody is already standing at that
screen at a fixed time every night, and that is the whole of why a reading
happens. The same principle as the cash voucher: whoever is physically there
records it.

**IT IS A SEPARATE CARD WITH A SEPARATE SAVE, outside the close's form.** The
close has a hard chain — date D refuses while D-1 is unclosed — and a shortage
belongs to its day. A forgotten meter must never stand between a cashier and
going home, and the card says so on screen. `smoke:a2` asserts
`MeterReadingEntry` is mounted on that page and is NOT imported by
`DayClose.tsx`.

**There is no rate field on the reader's screen and there never will be** —
the utilities form of the cost rule that keeps an issue cost off the store
manager's form. Gated.

The master, the rate and the analysis are **owner and accountant**, at
`/owner/meters` — a MASTER, not a setting, by the same argument that moved
partners out of `list_options`: a list row holds a name, and a meter carries a
unit and the rate every estimate turns on. The accountant is admitted for
exactly the reason they are admitted to `/owner/accounts`, and their door is on
**Payments → Expense**, where the real electricity bill is entered and where
holding the estimate up against it is the actual job. `meters.kind` has no
UPDATE grant and is shown locked with its reason: every reading already filed
belongs to that utility.

Readings show on the day sheet beside labour, silent when no meter was read —
most restaurants have none, and that is the ordinary state rather than a gap.

### Attachments: the table exists, NOTHING is built

`attachments(entity_type, entity_id, kind, storage_key, …)` is polymorphic like
`queries`, and `storage_key` holds a key and never bytes. **No storage backend
has been chosen**, so no UI exists — see the written proposal. Two facts that
belong with the decision: `kb_app` holds INSERT + SELECT and **no DELETE**, so
an attachment row cannot be removed once written (only its `caption` is
updatable); and the table has no RLS until the migration above is applied.

## anon and authenticated hold NOTHING — and the gate is green, not red

`revoke_anon_authenticated_everything`. Both roles now hold zero privileges on
every table, sequence and function in `public`, **and ALTER DEFAULT PRIVILEGES
is revoked for `postgres`** — which was the real recurrence risk, because
default privileges decide what a table gets the moment it is CREATED, so
without that the next migration would have quietly handed it all back.

**THIS IS THE ASSERTION THAT WAS CORRECTLY NOT WRITTEN YESTERDAY.** Yesterday it
could only have been red, and a permanently red gate is one people stop
reading. Today it is the honest state, which is exactly when a state is worth
freezing. Two checks in `smoke:a2`:

1. **zero grants to either role on any relation or function in `public`** — plus
   `kb_app` still holding its own, because a revoke can go too wide and every
   screen in the app would go blank;
2. **no role that OWNS anything in `public` has default privileges granting to
   them.** `postgres` owns all 72 app tables and its defaults now name only
   `service_role`. `supabase_admin` still grants both and **owns nothing here**,
   so it is printed as exempt rather than filtered — and it stops being exempt
   automatically the day it creates its first table, which is precisely when it
   would begin to matter.

That second check is the sequence gate's disjunction again: **state the
exemption, show it, and let the condition that makes it exempt be the thing
that expires.**

Both scoped to `public`. Supabase's `storage`, `graphql`, `graphql_public` and
`auth` schemas still grant both roles plenty and must — that is how Storage and
the GraphQL endpoint work — so a database-wide assertion would be permanently
red for reasons nobody here may fix.

**LEFT OPEN, DELIBERATELY: both still hold schema USAGE via PUBLIC.** Removing
it means revoking from PUBLIC and re-granting explicitly, and what that breaks
in Supabase's internals cannot be tested from here. With no table privileges it
lets them resolve names and read nothing.

**`service_role` IS DECIDED: revoke.** `revoke_service_role_from_public`, and
the reason it was decided rather than deferred again is worth keeping. It had
been deferred because nobody could test what consumes it — and enumerating the
consumers (no edge functions, no webhooks, no HTTP-calling triggers, no
pg_cron, zero non-internal triggers, no Supabase SDK in this app) left only the
Dashboard. **The question was never "is it risky", it was "is it testable", and
the enumeration answered it.** `rolbypassrls` was left alone deliberately:
bypassing RLS on a table you have no privilege to touch grants nothing, so the
riskier role-attribute change buys nothing.

**IT TOOK TWO MIGRATIONS, and the second one is the interesting one.**
`revoke_service_role_from_public` revoked sequences (0/5), functions (0/4) and
the default privileges — and **`revoke all on all tables in schema public from
service_role` reported success and changed no `relacl`**, in the same
migration, while the sequence and function revokes beside it took effect. A
targeted revoke on a single table worked immediately. **Cause not
established.** `revoke_service_role_tables_per_relation` fixed it one relation
at a time, covering relkinds `r/p/v/m/f` rather than trusting `ALL TABLES` —
there are no materialized views today and `ALL TABLES` would not have covered
one if there were.

Final state, read from `relacl`: **0 relations name `service_role`, `anon` or
`authenticated`; 147 name `kb_app`** — SELECT 147, INSERT 67, DELETE 5, each of
the five argued. `kb_app` is the only role holding anything in `public`.

**The two gates disagreed and that settled the argument for two gates.** The
current-state check went red while the recurrence check stayed green, because
the two halves of one migration landed differently. A single combined
assertion would have reported one failure and hidden which half was intact.

See `docs/service-role-decision.md`. It holds SELECT and DELETE on 147/147
relations AND `rolbypassrls`, so a leaked `sb_secret_…` key is total access to
every restaurant's books, reads and deletes alike: **the append-only guarantee
this whole ledger rests on does not apply to that key.** Nothing in the project
consumes it — no edge functions, no webhooks, no HTTP-calling triggers, no
pg_cron, zero non-internal triggers in `public`, and this app has no Supabase
SDK — so the only plausible consumer is Supabase's own Dashboard, which cannot
be tested from here.

## A STATEMENT THAT SUCCEEDS IS NOT A STATEMENT THAT DID SOMETHING

Third time in this project, and it is now a rule rather than three stories:

| | Reported success | Actually did |
|---|---|---|
| `git push -q` to a stale branch | quiet exit 0 | pushed nothing |
| `revoke … from PUBLIC` on Supabase | success | left the explicit `anon` / `authenticated` / `service_role` grants standing |
| `revoke all on all tables … from service_role` | success | changed no `relacl` at all |

**Every time, the only proof was reading the state afterwards.** Not the
statement's exit status, not the absence of an error, not the fact that the
neighbouring statements in the same migration worked — the third case had
sequence and function revokes take effect in the very same transaction while
the table revoke did nothing.

So: after any privileged or bulk operation, **read back the thing you meant to
change**, and read it from the authority rather than from a convenience view.

### AND THE CHECK THAT CONFIRMS A FIX CAN BE THE THING THAT IS WRONG

The sharpest instance, because the verification failed rather than the fix. The
revoke was confirmed by querying `information_schema.role_table_grants`, which
returned nothing for `service_role` — while `relacl` said the grant was on all
147 relations.

**WHAT IS ESTABLISHED, and only this:**

- after the bulk revoke reported success, `relacl` carried
  `service_role=arwdDxtm/postgres` on all 147 relations;
- `information_schema.role_table_grants` showed NOTHING for `service_role` at
  the same moment;
- a targeted revoke on a single table worked immediately;
- the sequence and function revokes in the same migration took effect;
- `postgres` is a member of `service_role`
  (`pg_has_role('postgres','service_role','USAGE') = true`), so
  member-visibility does not explain it.

**TWO THINGS ARE UNEXPLAINED: the bulk-REVOKE no-op, and the
`information_schema` discrepancy. Cause not established for either.**

*A mechanism was offered here and withdrawn.* The claim was that those views
show only grants involving a currently-enabled role, so another role's grants
are invisible rather than absent. The measurement behind it was taken **as
`kb_app`**, which is a member of nothing:

    as kb_app:  grantee=kb_app        information_schema 223   relacl  227
                grantee=postgres      information_schema   0   relacl 1215

That is consistent with the documented rule and says **nothing about what
`postgres` could see** — and `postgres` is exactly who ran the failing
verification. One session's visibility was used to explain another session's,
which is not evidence. *(The commit message on `aaa5c10` still carries the
withdrawn mechanism; this file is the record that is kept correct.)*

**THE PRACTICAL RULE IS UNAFFECTED, AND IS THE ONLY PART THAT MATTERS: read
`relacl` via `aclexplode`; never `information_schema` for a privilege
question.** It holds whether or not the cause is ever found — which is the
point of preferring a rule that survives an unexplained observation to an
explanation that does not survive a measurement.

Both grant gates therefore read `relacl`, and `smoke:a2` asserts in SOURCE that
neither touches `information_schema` — so "simplifying" them fails loudly
instead of passing forever. Elsewhere in that file `information_schema` is
fine: column existence is not a privilege.

## AN EXEMPTION MUST EXPIRE BY ITSELF

> **The condition that makes something exempt should always be the thing that
> expires. Otherwise an exemption is a permanent blind spot wearing a
> justification.**

Both grant gates are built this way and it is the shape to copy:

- `starter_library.id` is exempt from the sequence check **because `kb_app`
  holds no INSERT on that table** — and the moment it does, the exemption is
  gone without anybody editing the gate.
- `supabase_admin` is exempt from the default-privileges check **because it
  owns nothing in `public`** — and the day it creates its first table, it stops
  being exempt automatically, which is precisely the day it would begin to
  matter.

Neither is a name on a list. A name on a list is forever; a condition is
checked on every run. And both are **printed** rather than filtered out of the
query, so a reader can see the exemption was considered rather than wonder
whether the case was missed.

The test when writing the next one: *what would have to become true for this
exemption to be wrong, and does the gate evaluate that thing?* If the answer is
"somebody would have to remember", it is not an exemption, it is a hole.

## A BAD TEST THAT FAILS INFORMATIVELY BEATS A GOOD TEST THAT PASSES

The whole grant surface above was found by a perturbation that **failed for the
wrong reason**.

Proving the sequence gate could fail, I pointed its privilege check at `anon`,
expecting a role that obviously lacks USAGE — and the gate **passed**. The
first reading was "the gate is broken". It was not: `anon` genuinely held
USAGE, and INSERT, and DELETE, on everything. The premise was wrong, not the
instrument, and chasing *why* the premise was wrong is what surfaced the entire
default-grant surface, the exposure of three un-RLS'd tables to a published
key, and `service_role`'s `rolbypassrls`.

**A test that passes tells you one thing. A test that fails tells you which of
your assumptions was false**, and that is worth more — especially when the
assumption was one nobody had thought to write down. When a perturbation does
not behave as expected, the useful question is not "how do I fix the test" but
"what did I believe that is not true".

### A GATE THAT READS SOURCE HAS TO BE POINTED AT THE RIGHT SOURCE

The same lesson one level up, and it was found the same way. The assertion that
the grant gates read `relacl` slices each check out of this file BY NAME — and
its first version searched for the name and found the FIRST mention, which was
inside its own array literal. It sliced its own body, saw the word
`information_schema` in its own comment, and reported a correct gate as broken.

Fixed by finding the check DEFINITION — walking the `await check(` positions
and matching the name in the header — rather than the first occurrence of a
string that the checker itself also contains.

The general form: **a checker that reads source is part of the source it
reads.** Anchor on structure, never on a substring the instrument also carries.
It is the same family as the walking-order gate that examined zero rows: both
looked like they were working, and both were pointed at nothing.

## A PRIVILEGE CHECK THAT LOOKS IN THE OBVIOUS PLACE IS NOT A PRIVILEGE CHECK

Three times now, and it is a family rather than three incidents:

| The natural query | What it could not answer |
|---|---|
| `column_privileges` | DELETE, which is a TABLE privilege and never appears there |
| `revoke … from public` | Supabase's EXPLICIT grants to `anon` / `authenticated` / `service_role`, which survive it |
| `table_privileges` says INSERT | whether the SEQUENCE behind a `serial` default can be reached |

**The general form: each time, the authoritative fact lived somewhere the
natural query does not reach — and each time it was found by EXERCISING the
path, never by reading it.** A screen was built saying a match was permanent; a
function believed private answered the anon key; an INSERT grant that was
genuinely present still refused every insert. In all three the obvious
catalogue answered confidently and answered the wrong question.

So: when a privilege matters, **make the path run**. `has_table_privilege`,
`has_sequence_privilege` and `has_function_privilege` answer what a role can
actually do, where `information_schema` answers what was written down about it;
and better than either is a probe that performs the operation and observes the
refusal.

**And the preference that removes the third one entirely: `GENERATED ALWAYS AS
IDENTITY` needs no separate grant**, because the sequence is reached through
the table's own INSERT privilege. `serial` and `bigserial` call `nextval()`
from a column default and therefore need one. Two spellings of the same
intention; prefer the one with nothing to forget.

### The gate states its exemption instead of filtering it

`smoke:a2` walks every column in the schema whose default is a `nextval()`, and
the passing condition is a DISJUNCTION said out loud: **the sequence is
reachable, OR the role has no INSERT on that table.** `starter_library.id` is
the second case — global read-only reference data, `kb_app` holds SELECT only —
and it is PRINTED as exempt rather than dropped by a `where` clause.

Both halves matter. Filtering it out would have worked and left nobody able to
see that it had been considered; leaving it in as a failure would have made the
gate show one permanent red line, **and a gate that always shows one failure is
a gate people stop reading.** A second assertion requires that at least one
sequence-backed column sits on a table `kb_app` CAN insert into, so the
disjunction can never be satisfied by its exempt half alone — proved by forcing
that half and watching the gate name it.

## The rulings, confirmed

- **The tie sharpening stands.** Proving that a row stamped LATER IN TIME beats
  one merely inserted later is the assertion that catches an
  `order by seq desc` alone; the tie and tiebreak checks both pass under that
  regression, and only the ordering check fails.
- **Deleting the RLS scaffolding check was right.** It held pressure on an
  unapplied migration. Tier 3 of `audit:tenancy` is the permanent home, and a
  second implementation beside it is a copy that can drift — the same reasoning
  as the vendor-return refusal flag, which was deleted rather than flipped.

## The two rulings — decided

**Attachments: Vercel Blob with OIDC. APPROVED.** The argument that decided it
is not convenience: a Supabase `sb_secret_…` key is the documented replacement
for `service_role`, which bypasses RLS project-wide — a master key to every
restaurant's books, `app_users` included, introduced in order to store a
photograph of a meter. No documented way to scope one to Storage alone means no
acceptable version of that trade.

**Measured on this database rather than quoted from the docs:
`service_role` carries `rolbypassrls = true`.** It is NOLOGIN, so it is
reachable only through PostgREST — which is exactly what a leaked
`sb_secret_…` key reaches. Every policy on all 68 tenant tables is skipped for
it, by the role's own attribute, in `pg_roles`. **Check an ap-south region is offered before
creating the store** — non-blocking, since photo upload latency is not critical,
but know it rather than discover it.

The rules stand and are not negotiable at build time: **server-side uploads
only** (the browser never holds a token), **per-tenant paths enforced by the
app** because no storage backend knows about our tenants, and **signed,
expiring reads**. See `docs/attachments-storage-decision.md`, including the
open ruling on whether an attachment may be removed at all — the recommendation
is a status column and retire, never a DELETE grant.

**Role SOPs: version 1. APPROVED.** Prose carries the job, the app carries the
facts that drift, and a gate asserts every moment names a route that exists and
that the role can open. No generated fields, no generated refusals. See
`docs/role-sops-proposal.md`.

**AND THE PROSE WAITS FOR THE FIRST REAL WEEK.** Nobody but Rajesh has used this
app. An SOP for the store manager written today describes a workflow no store
manager has ever run, and the first day of real use will change it — so writing
it now produces a document that is confidently wrong about the one thing it
exists to describe. **Build the mechanism if you like; hold the words.** This is
the same rule the app already applies to itself: never compute a figure to fill
a gap, and never state what has not arrived.

## The Supabase MCP is PROJECT-scoped, and it is not kb_app

`.mcp.json` is committed. Project scope rather than user scope, so anybody
working in this repo gets the same server without configuring one, and two
properties earn that:

- **It is PINNED** — `project_ref=xvnreydzveicnzmhkire` is in the URL, so it
  cannot be pointed at another Supabase project by accident.
- **It survives a headless run.** An interactively-authenticated,
  account-level integration may simply be absent in a cron or background run;
  a file is not.

**No credential material is in the file.** Auth is OAuth and lives outside the
repo, which is what makes it safe to commit. Each person authenticates once:
`claude /mcp` → supabase → Authenticate, in a real terminal rather than an IDE
extension.

**IT AUTHENTICATES AS THE OPERATOR'S OWN SUPABASE ACCOUNT, NOT AS `kb_app`.**
That is the sentence to hold. With `database` and `development` in the feature
list it executes SQL and applies migrations, carrying exactly the privileges
`kb_app` is deliberately denied: UPDATE and DELETE on any table, and it
bypasses RLS. That is correct — it is how every migration in this project has
been applied — but it means **nothing you do through the MCP is subject to the
guarantees the rest of this file describes.** The append-only rule, the column
grants, the five deletable tables, the tenant policies: all of them are
properties of `kb_app`, and none of them constrains this tool.

So the discipline is the reverse of everywhere else in this repo. Elsewhere the
database refuses what the app must not do. Here the database will not refuse,
and the care has to be yours.

**It is a different KIND of risk from the `service_role` key** in
`docs/service-role-decision.md`, and the distinction is worth keeping: this is
a tool somebody drives deliberately, one statement at a time, watching the
result. That one is a credential whose entire danger is that it can be
published or leaked and then used by somebody who is not watching anything.
Deciding about one says nothing about the other.

If write access ever stops being wanted, Supabase's MCP takes
`&read_only=true` in that URL — a one-line change to `.mcp.json`.

**You may see TWO Supabase tool sets.** An account-level claude.ai integration
and this one can both be connected at once, with near-identical tool names.
They are not the same server: only this one is pinned to the project, and only
this one is in the repo. Check which you are calling before it matters.

## A STOCK SCREEN IS NOT ONE JOB — three orderings of one table

Every mediocre inventory UI is one screen trying to be three. `stock_on_hand`
answers three different people's questions and each wants a different order:

| | grouped by | ordered by | whose question |
|---|---|---|---|
| **On hand** | CATEGORY | value | the owner's, monthly: what is it worth |
| **Reorder** | VENDOR | urgency | the store's, weekly: what do I buy, and from whom |
| **Count** | STORAGE LOCATION | walking order | the counter's: what is actually there |

Category grouping on On hand is not a preference — it is how inventory is
presented in every accounting standard, so it is the shape the reader already
knows. **Value is deliberately absent from Reorder**: an order goes to a vendor
and is filled or it is not, and what the stock is worth is a different screen.

**REORDER WAS ALREADY GROUPED BY VENDOR** — that part predates this work and
the comment arguing it ("the trip is the unit of work") was already there. What
was missing was the ORDER: vendors sorted alphabetically and items by name,
which cannot say that one item is out and another crossed its line an hour ago.
Urgency is now defined in the query and stated on the screen — how much of the
reorder level is still on the shelf, lowest first — and a vendor ranks by its
most urgent line, because the decision the page drives is which call to make
first.

### The count sheet: a ruling superseded, and why

This file recorded `on_hand_value desc` as a deliberate ordering that "must
stay". It is replaced by walking order, and the argument matters more than the
change:

> **That ordering was doing TWO jobs — saying which items matter most, and
> setting the order of the walk. It was good at the first and actively bad at
> the second.**

Value order sends a counter back and forth across the store. A count that is
exhausting is a count that stops happening, and a count that does not happen is
worth less than a slow one. `stock_abc` now does the first job *better*, because
importance belongs in the **schedule** — A weekly, B fortnightly, C monthly —
rather than in the row order. That frees the row order to be the walk. Value
still orders within a location, where it costs no extra steps.

**THE SCHEDULE IS THE POINT, NOT THE LETTER.** A badge on a row tells nobody
anything they can act on. At a few hundred items, counting everything every week
is a plan nobody keeps, and a plan nobody keeps produces no counts at all —
which is worse than counting the expensive third often and the tail
occasionally. So the sentence is on the Count tab in full, and the badge carries
it in its tooltip. `src/components/stock/Abc.tsx` is the ONE definition, used by
the stock list and the count sheet.

**Items with NO location group LAST and loudly.** On a physical walk they are
exactly what gets missed, so "Not placed yet" is a red band rather than a quiet
tail. `storage_locations.sort_order` is WALKING ORDER, not alphabetical, and the
edit screen says so — "sort order" on its own invites somebody to alphabetise
it, which quietly undoes the whole feature. Reordering is therefore a first-class
control, not an afterthought, and a new location goes LAST in the walk rather
than first: nobody knows where it sits on the route until they say so.

### storage_locations is a MASTER, not a list key

The third time this distinction has decided a table, after `sections` and
`partners`. **Items POINT AT a location**: a rename has to follow every item
that points at it, and nothing can point at a list value. `kind` is a SHAPE —
ambient / chilled / frozen / other — never a temperature or a brand, which is
what lets it describe a kitchen nobody here has seen.

**A FOREIGN KEY IS NOT A TENANT CHECK** — found here, on
`items.storage_location_id`, and it turned out to be the whole schema. See the
rule of that name at the end of this file. `assertLocation` stays as defence in
depth and for its named refusal, but it is no longer the only thing standing
between tenants.

### Two honesty rules the views already publish, kept on screen

**`days_on_hand` is NULL below seven days of issue history and the screen says
why.** One issue ever gives max = min, so a naive average reads the whole
quantity as a single day's usage — 23.5 kg would report as one day's cover on
the strength of a single line. 2 of 6 items are answerable today; the rest say
"not enough history" or "never issued". A gate asserts no row states cover on
fewer than seven days of history, and asserts that at least one row is
*un*answerable, so the withholding path is exercised rather than assumed.

**"Bought, never issued" is computed, not gas-specific.** Four cylinders at
₹12,100 are 26% of this store's value and have never reached a department's
consumption. Grouping by category would have buried that under "Fuel", so the
stock page carries a strip naming every item bought and never issued, with its
share of total value — and it will catch the next one too, which a gas-shaped
rule would not.

### The gate that passed while broken

The walking-order assertion **passed with the ordering deliberately reversed**,
because every live item is unplaced: `location_order` was null on all six rows
and the loop examined nothing. The vacuous-assertion family again, and caught
only by perturbing it.

It now places three items on the PROBE tenant inside a rolled-back transaction,
arranged so **walking order contradicts alphabetical order** — A on the last
shelf, B on the first, C unplaced — which is the only arrangement that can tell
the two apart. `listCountableItems` gained an optional handle (the
`getClosePrefill` shape) so the gate calls the APP'S OWN QUERY rather than a
hand-written copy of it.

And a new risk that ordering created: the sheet now JOINS `stock_on_hand` to
sort by value within a location. **Joining is fine; selecting a quantity would
put the book on the counter's screen and turn a count into a confirmation of
it.** A gate reads the query's source and fails if any quantity column appears
in its select list.

## A FOREIGN KEY IS NOT A TENANT CHECK

> **A foreign-key check runs as the TABLE OWNER, so RLS does not filter it. A
> uuid belonging to another restaurant satisfies a single-column FK perfectly —
> the row exists, the policy never gets a say.**

Found on one column: `items.storage_location_id`, where a foreign uuid would
have placed one restaurant's item on another's shelf. `assertLocation` fixed
that column. **The class was 99 foreign keys across 51 tables.**

And that is the RLS argument again, in a third costume: *99 places to remember
is not a backstop*. The same sentence has now been earned by a missing
`and restaurant_id = …` in a WHERE clause, by views running as their owner, and
by this.

`composite_tenant_foreign_keys` made every one reference **`(restaurant_id,
id)`** instead of `(id)`, so a foreign uuid cannot satisfy the constraint
because **the PAIR does not exist in the parent**. Measured after: 99 composite,
0 single, `pos_lines` still CASCADE, live reads unaffected — and a direct
attempt to place a Thrayam item on the probe tenant's shelf refused by the
database with `23503 … violates foreign key constraint
items_storage_location_id_fkey`.

**MATCH SIMPLE, and the precondition it rests on.** A NULL in any child column
skips the check entirely, which is right for an optional reference —
`storage_location_id`, `reverses_id`, `default_vendor_id`. It is only safe
because `restaurant_id` is NOT NULL on all 69 base tables that carry it, so the
pair can never be half-null and skip the check while holding a real id. Tier 5
asserts that precondition rather than assuming it.

**Keep the app-side refusals anyway.** `assertLocation` is defence in depth and
gives a NAMED refusal — "that storage location is not on this restaurant's
list" — where the constraint gives a `foreign_key_violation` nobody can read.
The database decides; the app explains.

**Tier 5 of `audit:tenancy`** asserts every FK whose child and parent both carry
`restaurant_id` is composite, because this is exactly the kind of thing a future
migration undoes without noticing — several tables were created the same week
with single-column keys and nobody saw. Proved able to fail both ways: pointing
its column test at a name that does not exist made it name all 99 and exit 1,
and scoping it to an empty schema made the vacuity guard fire rather than
passing on nothing.

## A FIXTURE THAT CANNOT TELL TWO ANSWERS APART IS NOT A FIXTURE

The walking-order gate **passed with the ordering deliberately reversed**. Every
live item was unplaced, so `location_order` was null on all six rows, the loop
`continue`d on every one, and it asserted nothing while reporting a tick.

Fourth of its family, and the family is now clear enough to state as one rule:

| | Why it could not fail |
|---|---|
| the converging attendance probe | the row it checked had been written by an EARLIER run |
| the extra-hours gate | it wrote its own insert, so the app's column list was never exercised |
| the prune's invisibility check | both generations carried IDENTICAL figures |
| the walking-order gate | every item was unplaced, so it examined ZERO rows |

**The fix is always the same: make the two sides genuinely different, and make
the fixture capable of distinguishing them.** Here that meant placing three
items on the probe tenant inside a rolled-back transaction, arranged so that
**walking order CONTRADICTS alphabetical order** — A on the last shelf, B on the
first, C unplaced. Any arrangement where the two orderings agree would have
passed under either implementation and proved nothing.

Two details that made it real rather than approximate: `listCountableItems`
gained an optional handle (the `getClosePrefill` shape) so the gate calls the
APP'S OWN QUERY rather than a hand-written copy of it; and the probe rolls back,
so nothing accumulates in a tenant nobody is watching.

**And the new risk that ordering created, worth its own sentence.** The sheet
now JOINS `stock_on_hand` to order by value within a location. **Joining is
fine; SELECTING a quantity from it would put the book on the counter's screen
and turn a blind count into a confirmation of it.** A gate reads the query's
source and fails if any quantity column reaches its select list — the ordering
may use the book, the sheet may never show it.

## A FIELD THAT BLOCKS A FEATURE DOES NOT GO BEHIND A FOLD

`ItemNew` grew a "＋ More details" fold so a create form could carry every
INSERT-granted column without becoming a wall. That was right, and it put two
fields in the wrong place.

**The evidence is in the data: every item had no reorder level AND no storage
location.** Both were behind the fold, and both switch a whole tab on — no
reorder level means the Reorder tab can never show anything, no location means
the count sheet is one "Not placed yet" band. A fold does not merely hide a
field; on the fields that gate a feature it decides whether the feature exists.

So the test is not "is this field important" — every field's author thinks so —
it is **does anything break if it stays empty**:

| | | |
|---|---|---|
| storage location | promoted | *where it lives — sets the order you walk when counting* |
| reorder level | promoted | *when stock falls to this, it appears on Reorder* |
| conversion, GST, item type, notes | stay folded | nothing breaks if they are blank |

Each promoted field carries ONE LINE saying what it unlocks, because a field
somebody does not understand is a field they skip, and a fold is not the only
way to make something invisible.

`ItemEdit` has no fold at all, so both were already on screen there; its copy is
now the same two sentences word for word. **The same wording in both places is
not tidiness — a field that means one thing on create and another on edit is two
fields.**

This is the readiness card's principle applied one layer earlier: **ask for what
the app cannot work without WHERE IT WILL BE ANSWERED, not where it is tidy.**
The card tells you afterwards that nobody placed the items; the form is what
stops it happening.

### And the reason he could not see it at all

Both candidates were true, and the larger one was not the fold. **Production was
serving a commit from before the work existed** — `b06919d`, with ten commits
sitting local-only. Checked from Vercel deployment metadata rather than local
HEAD, which is the only way to answer "is it deployed": `git log` describes a
laptop.

**Check what is SERVED before diagnosing what is RENDERED.** A UI question asked
against undeployed code has an answer that is true and useless.

## AFTER SAVING, THE PAGE MUST NOT SIT STILL

Rajesh's words, and the acceptance test for every write in the app. He found
the gap by saving an item and watching nothing happen — the third time a
"finished" sweep turned out to have a bucket left in it, and the third time he
found it by using the app rather than any gate finding it.

**What the earlier sweep actually reached:** the 11 full-screen reveals and the
6 navigators. The masters, the settings screens and the voids were left on a
toast — and `ItemEdit` and `VendorEdit` on a literal `saved ✓` rendered at the
TOP of a long form while the save button sits at the bottom. On a phone nothing
in view changed at all.

Three rules follow from the test:

- **a) SAY NUMBERS, NOT A CHECKMARK.** "Black Pepper saved — dry store,
  reorders at 2 kg" tells you what landed. A checkmark is a claim. For a master,
  read back what changed *including the field that unlocks something*: a
  location set means the count sheet gained a row.
- **b) IT MUST BE VISIBLE FROM WHERE THE BUTTON IS.** `SaveAck` scrolls itself
  into view for exactly this reason. A marker beside a heading fails it when the
  button is a screen away. *(The toast does not: it is `fixed inset-x-0
  bottom-4`, bottom-anchored near the thumb — worth knowing, because "a toast at
  the top" is the usual version of this complaint and is not what this app has.)*
- **c) SAY WHAT IS STILL MISSING**, while somebody is still holding the thing
  they could fix. "5 of 6 items still have no location."

### The census, and why it is enumerated rather than filtered

`smoke:a2` walks every exported action in a `'use server'` file whose body
writes, finds its call sites, and requires each to render `SaveAck` — or to be
on an exempt list **with a reason that is printed on every run**:

    104 writing actions · 89 acknowledged · 9 exempt · 6 with no UI call site

Nine exemptions, three kinds, each named: **full-screen reveal** (BillEntry,
CountEntry, DayClose — the form is replaced by the result), **navigates to a
real next screen** (CreateRecipe, StatementImport, PrepareRun), and **inline row
control** (UnmatchButton, CancelIndent, SettleShort — a `<span>` inside a table
row, acting on the row it sits in, where the row moving lists IS the change and
a hatched band inside a table cell would be worse than the toast).

**An exemption that no longer applies fails the gate.** A reason nobody re-reads
is how a filter grows into a hiding place — so the list cannot rot quietly.

### The gate had the substring flaw. Again.

Proving it could fail, I renamed `<SaveAck` to `<SaveAckX` in ItemEdit and the
gate **stayed green**: `/<SaveAck/` matches `<SaveAckX` too. That is precisely
the `<DateLink` / `<DateLinkX` flaw already recorded in this file — repeated
inside the gate written to stop a recurrence. Fixed to `/<SaveAck[\s/>]/`, a
real JSX boundary, and re-proved.

**Match on a boundary, never on a prefix.** Third instance now, and the pattern
is always the same: the perturbation that should break the check is a rename,
and a prefix match survives one.

### Three transforms, three ways of pointing at the wrong source

Doing forty files by script produced three failures worth keeping, because all
three are the same mistake as the gate's:

- `^import .*$` matched the OPENING line of a multi-line import and split it in
  half;
- an anchor on `const [x] = useState(` matched a MULTI-LINE initializer and put
  the new state inside its object literal;
- a `return (` anchor matched a small helper component earlier in the file, so
  the acknowledgement rendered in a stat tile instead of the form.

Each looked plausible and each was pointed at the wrong text. **A transform that
edits source is subject to the same rule as a gate that reads it: anchor on
structure, and verify where the edit landed rather than that it applied.** The
check afterwards — *is every render below its own state, in the same component?*
— is what caught the third.

## RETIRE-NEVER-DELETE ALREADY HAS ITS DOOR BACK — checked, not assumed

The brief was that ten masters carry a status column, every list filters to
active, and a mistaken retirement therefore vanishes with no way back. **That is
not true today**, and the checking is the useful part.

Measured across every table whose `status` CHECK is exactly `active | inactive`
— twelve, not ten:

| | listing query filters to active? | marks retired? | can un-retire? |
|---|---|---|---|
| items, vendors, recipes, list_options, sections | no filter at all | yes | yes |
| staff, app_users | no filter — see below | yes | yes |
| partners, money_accounts, meters | `includeRetired`, screen passes `true` | yes | yes |
| storage_locations | `includeRetired` **defaults true** | yes | yes |

Eleven tenant masters, all listing the retired, all marking them, all with a
status write on their update action. `categories` is the twelfth and is a global
master shared by every tenant with no screen. Zero rows are retired anywhere, so
nothing was ever at risk.

**WHERE THE WRONG PREMISE CAME FROM, and it is a rule.** `grep "status =
'active'"` over `src/server` returns about thirty hits, which reads as "every
list filters". Almost all of them are **pickers** (issue to a department, choose
an item for a bill) and **computations** (headcount, labour cost), where showing
only active is correct and intended. Two more were pure false positives:

- `listRoster` has no filter; the one four lines below belongs to
  `listActiveStaff`, a picker;
- `listUsers`'s `status = 'active'` is inside its **ORDER BY**, sorting active
  first — the opposite of hiding.

### A BRIEF STATING A PREMISE IS A BRIEF ASKING WHETHER IT HOLDS

Rajesh's own note, recorded because it is the more useful half:

> *"I asserted 'every list filters to active' from the retire-never-delete rule
> without reading one listing query. Fourth instance of me inferring app
> behaviour from a RULE rather than the SOURCE."*

The four:

| | The rule that was reasoned from | What the source said |
|---|---|---|
| kitchen analytics | — | the figures were already published |
| `kitchen_wastage.qty` | "value-only, so qty is unused" | live behind a `component \| value` mode toggle |
| `saveProduction` | "a picker is only a courtesy" | it already refused a dish BY NAME, server-side |
| every master list | "retire-never-delete, so lists filter to active" | not one listing query filters |

**Every one is the same shape: a correct rule, applied to code that already
handled it.** A rule describes what the code SHOULD do, and the code was
written by somebody following the rule — so "the rule implies X" and "the code
does X" agree far more often than not, which is exactly what makes the
occasional disagreement invisible.

**A BRIEF STATING A PREMISE IS A BRIEF ASKING WHETHER IT HOLDS.** Check it, in
the source, before building on it — and say so plainly
when it does not, because the check is often worth more than the build. Three
of the four above ended with nothing built and something learned.

> **A column appearing in a query is not that query filtering on it, and a
> filter in a neighbouring function is not this one's.** Slice the function
> before reading its WHERE, and strip the ORDER BY before deciding something is
> hidden.

That is the same family as reading a rendered form instead of its handler, and
as a gate slicing its own body — every one of them is a signal taken from near
the thing rather than from the thing.

**SO THE CONTROL WAS NOT BUILT.** A filter offering Active / Retired / All on
eleven screens that already show all rows would be a second answer to a question
already answered — the exact fault the brief itself names under "deliberately
not building". What was genuinely missing is the part that keeps the TWELFTH
master honest, because there are four different ways of arriving at the right
behaviour today and nothing holds any of them.

`smoke:a2` reads the family **from the database**, not from a list in the file,
and requires every retirable table to name where its retired rows are listed and
what marks them — with `categories` exempt and its reason printed. A twelfth
master fails until somebody says. Proved able to fail both ways: removing one
registration named it as unprotected, and making one listing query filter to
active named it as hiding.

## THE VIEW TOGGLE — two options, and where the third would have gone wrong

`/store/stock/on-hand` carries **By category** (default) and **By value**. No
third option, and the reason generalises: the three-jobs argument maps to the
three **TABS**, not to three toggles inside one of them. "By shelf" here would
be Count duplicated inside On hand — two answers to one question, which is the
fault this codebase keeps removing.

**By value is not a lesser view.** At a few hundred items "what are my ten
biggest holdings" is a different question from "what is Dry Goods worth", and
grouping HIDES it. Live proof at six items: `PLT-001` (₹7,442) sits below
`MET-001` (₹4,263) grouped, and above it flat.

`src/components/ViewToggle.tsx` is the shared segmented control, built once
because a dozen of these are coming — dishes vs subs, detail vs summary, draft
vs approved vs paid. Twelve copies would be twelve places for the next change,
the same argument as PersonLink, DateLink and the ABC badge.

**The choice lives in the URL and the DEFAULT WRITES NO PARAM.** A clean URL is
the common case, and `?view=by-category` on every link would be noise meaning
"unchanged". `readStockView` is the one front door for both mounts — a
hand-written ternary in each route file is two chances to disagree, the same
reason `readPeriodParam` exists. An unrecognised value falls back rather than
throwing: a pasted URL with a typo should show the page, not a 500.

### The bug the toggle would have introduced

`FilterInput` rebuilt its URL from `pathname` + `q` **alone**, so it silently
dropped every other param. On a page with one control that is invisible; the
moment a second control shares the URL, typing in the filter resets the view
beside it.

> **A control that writes to the URL must preserve the params already on it.**
> Rebuilding from its own value works until the day a second control exists,
> and then it looks like the other control is broken.

Both controls now start from `new URLSearchParams(sp.toString())`, and the gate
asserts that in source — the failure is silent, so nothing else would catch it.

The gate also asserts the two orderings genuinely DIFFER, by finding a pair that
swaps between them. A toggle whose two states return the same rows is
decoration, and that is exactly what a careless `order by` edit would leave
behind.

## TWELVE TOGGLES, ONE CONTROL, ONE READER

`ViewToggle` writes to the URL; `VIEW_KEYS` in `src/lib/views.ts` holds every
option list; `readView` narrows a param against it. Twelve screens, one
component, one reader — the argument that already made `PersonLink`,
`DateLink`, the ABC badge and `readPeriodParam` single things.

**`readStockView` was deleted rather than kept.** It was a second front door
for one screen while every other toggle went through `readView`, and two doors
is exactly what a shared reader exists to remove. The gate asserts every key is
read, that each offers a real choice, that the default is what an absent param
yields, and that an unrecognised value falls back rather than throwing.

**Each toggle is a genuinely different question, argued per screen** — the
by-shelf reasoning applies everywhere: a second answer to a question already
answered is the fault, not a convenience.

| screen | and why the second state is not the first |
|---|---|
| On hand | grouping HIDES the biggest holdings |
| Reorder | vendor is the trip; urgency is the risk |
| Recipes | "what is in Chinese" is not "what is expensive" — two independent toggles, not one |
| Sales books | by-item reads POS names straight from the lines, so it works with nothing mapped |
| Mapping | reviewing a decision is not working a 218-row queue |
| Parties | `balance <> 0` is right for a QUEUE and hides a live party at zero |
| Registers | the summary totals the detail's OWN rows, so they cannot disagree |
| Attendance | "who is absent most" cannot be paged out of a day sheet |
| Employees | the roster order must not move between mornings; the wage bill is elsewhere |
| Payroll | what is waiting on me, across three people's stages |
| Activity | grouping answers it without having to pick a filter first |

### The gate, and where it says UNTESTED

The rule: **assert the two states differ by finding a pair that swaps.** A
toggle whose states agree is decoration, and that is what a careless `ORDER BY`
edit leaves behind.

But live data often cannot tell two orderings apart — one dish and two staff
are identical under every sort — so the gate **reports UNTESTED rather than
passing**, and the load-bearing half is a SOURCE assertion that each query's
`ORDER BY` or `WHERE` still branches on its view parameter. That holds whatever
the data happens to look like. It already found something real: **parties
owed(4) vs all(5)** — a live vendor at exactly zero that the payment queue was
hiding, which is the case that made the toggle worth building.

## RUPEES · PERCENT — the lens, and the refusal that is the point

`src/lib/units.ts`. Food cost, labour and prime cost are quoted as percentages
by universal convention, because a P&L in rupees alone cannot be compared to a
benchmark or to last month at a different volume: **₹1,20,000 of food is 24% on
₹5,00,000 of sales and 60% on ₹2,00,000.** Both asserted by value.

**THE PRECONDITION IS THE FEATURE.** A percentage needs a denominator, and 94%
of this restaurant's revenue is unmapped — so most department percentages are
unanswerable today and say so. `asUnits` returns a REFUSAL, never 0%, which is
the difference between "labour was free" and "we do not know what we sold".

**Three refusals, deliberately distinct**, because they are three different
facts: *no sales figure exists*, *sales were measured as zero*, and *nothing
was recorded to state at all*. The gate asserts all three are unassessable AND
that their wording differs — one shared sentence would leave a reader unable to
tell which they are looking at. An absent figure is a refusal in RUPEES too: it
is not ₹0.00 any more than it is 0%.

Built last and deliberately not held for the data: it is ready the moment the
mapping queue is worked, with no change here.

**Five screens, and the fifth was argued out.** The P&L routes every cell
through one `Money` component. The day sheet's three ratios, the staff
dashboard's labour card and the department food-cost card each gained the
RUPEES side — and on all three the money shows *even where the percentage
refuses*, because the missing half is the DENOMINATOR: the wage bill and the
consumption are real, and on the days no POS has been fetched they are the only
figures there are.

**The owner dashboard did NOT get the toggle**, and that is a decision rather
than an omission. Its two ratio-shaped cards are "Food cost % against target"
and "Margin by section" — the second is already in rupees, and the first is a
TARGET COMPARISON, where rupees has no reference line to compare against. A
units toggle there would draw a bar chart against a target that means nothing.
The consumed rupees are one tap away on the card's own href and on the
department pages, which now carry the lens.

**And the gate's first version cried wolf.** A repo-wide sweep for
percentages flagged three files that were already correct — a dish card
rendering a dash, a guarded settlement ternary, and a stock row whose
`toFixed(1)` is DAYS of cover, not a percent at all. The instrument was wrong,
not the code, so it is scoped to the screens that actually offer the lens. And
the rule it asserts is the REFUSAL, not the function: `requires()` +
`<Unassessed>` guards a percentage as well as `asUnits` does, and on a
dashboard it does it better, because its sentence is screen-specific where a
shared formatter can only be generic.

*(Named `units.ts` — `src/lib/share.ts` has been the WhatsApp day-close summary
since phase 11, and writing the new module there first overwrote it. Restored
from git. Check whether a filename is taken before claiming it.)*

## THE TOOL DID EXACTLY WHAT I TOLD IT, AND WHAT I TOLD IT WAS NOT WHAT I MEANT

Three of these now, and they are one entry because they are one shape. None is
a bug in a tool; each is an instruction that was obeyed literally and meant
something else.

| | What was written | What it did |
|---|---|---|
| the SaveAck gate | `/<SaveAck/` | matched `<SaveAckX` too, so a rename left the gate green |
| a SQL comment | ``-- filtering on `balance <> 0` …`` inside a `` sql`…` `` template | the backtick CLOSED the template, mid-comment |
| a new module | `cat > src/lib/share.ts` | silently overwrote the WhatsApp day-close summary, which had lived there since phase 11 |

Every one passed its immediate check. The regex compiled and matched. The
comment was valid SQL. The write succeeded and reported nothing. **A tool
succeeding is not the tool doing what was intended** — which is the same
sentence as *a statement that succeeds is not a statement that did something*,
one layer up, about the author rather than the database.

**The check is the same in all three: read what is already there, and read what
the delimiter does, before writing.**

- Before matching a name, ask what ELSE the pattern matches — a prefix always
  matches its own extensions, so anchor on a boundary.
- Before nesting text inside a delimiter, ask what characters END that
  delimiter. A backtick is not punctuation inside a template literal; it is the
  terminator. So is a quote inside a quoted string and `*/` inside a block
  comment.
- Before claiming a filename, LOOK. `ls` costs nothing; a silent overwrite of a
  module nothing in the current task mentions costs a restore from git and, if
  it had been uncommitted, the file.

The last one is worth stating on its own, because it is the only one of the
three that destroys rather than misleads: **`cat >` and `Write` do not ask.**
Every other footgun here announced itself the moment a gate ran; this one was
found only because TypeScript happened to notice two exports had vanished.
