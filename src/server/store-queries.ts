// Read side of the consumption spine. Every derived number comes from the
// named views: item_costs (issue_cost), stock_on_hand (quantities & values),
// section_consumption (monthly section totals). Event aggregates (an issue's
// own total) sum the stored generated `value` column — never recomputed.
import 'server-only'
import { txn, sql, tsql } from '@/lib/db'
import type {
  ExpiringStockRow,
  PriceMovementRow,
  ChecklistRow,
  IndentPrefill,
  IndentRow,
  IssuableItemHit,
  IssueDetail,
  IssueLineRow,
  ItemSuggestion,
  ReorderRow,
  ReturnDetail,
  ReturnLineRow,
  Section,
  SectionConsumptionDay,
  SectionMonthRow,
  StockRow,
  PaymentLogRow,
  StockView,
  CategoryRollupRow,
  StockSnap,
  StoreLogRow,
  WastageDetail,
} from '@/lib/types'

/** Departments that can RECEIVE stock — what the issue picker offers.
 *
 *  Not all sixteen. `sections` is one table: the same row codes a dish,
 *  posts a staff member and receives an issue, and the picker was offering
 *  every org unit — so stock could be issued from the Store to the Store,
 *  and to Accounts, Valet and Security, none of which consume anything the
 *  store holds. Same class as the dish picker offering Security.
 *
 *  `receives_stock` is the filter, exactly as `codes_dishes` gates the dish
 *  coder: a fact about the department, set once, visible on its own screen. */
export async function getSections(restaurantId: string): Promise<Section[]> {
  return tsql<Section[]>`
    select id, code, name, sort_order, status, dept_group, receives_stock
    from sections
    where restaurant_id = ${restaurantId} and status = 'active' and receives_stock
    order by sort_order asc`
}

/** Every active department, receiving or not — for screens that ADMINISTER
 *  departments rather than issue to them. */
export async function getAllSections(restaurantId: string): Promise<Section[]> {
  return tsql<Section[]>`
    select id, code, name, sort_order, status, dept_group, receives_stock
    from sections
    where restaurant_id = ${restaurantId} and status = 'active'
    order by sort_order asc`
}

export async function searchIssuableItems(restaurantId: string, q: string): Promise<IssuableItemHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  return tsql<IssuableItemHit[]>`
    select i.id, i.code, i.name, c.name as category_name, i.purchase_unit, u.name as unit_name,
           coalesce(s.on_hand_qty, 0)::text as on_hand_qty,
           (ic.issue_cost is not null) as has_cost
    from items i
    join categories c on c.code = i.category
    join units u on u.code = i.purchase_unit
    left join stock_on_hand s on s.item_id = i.id
    left join item_costs ic on ic.item_id = i.id
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
      and (i.name ilike ${like} or i.code ilike ${like})
    order by (i.name ilike ${prefix}) desc, i.name asc
    limit 10`
}

/**
 * What this department actually takes — the Issues sheet's best habit, restored.
 *
 * The sheet filled the last ten days' items for a department, most frequent
 * first, and the app lost it: every issue started from a blank typeahead over
 * all 300-odd items, so the store manager searched for onions every single
 * morning. `section_frequent_items` is the last 30 days, ignoring voids.
 *
 * RANKED FREQUENCY THEN RECENCY, and it SCOPES WITHOUT EXCLUDING: these sit at
 * the top of the picker and the general search stays underneath. A department
 * taking something for the first time has no history here, and a picker that
 * only offered history would make that item unfindable.
 *
 * `typical_qty` rides along as a HINT beside the box, never as a prefill —
 * the same ruling as the closing form, where a quantity nobody counted is
 * worse than a blank one.
 */
export async function getSectionFrequentItems(
  restaurantId: string,
  sectionId: string,
): Promise<ItemSuggestion[]> {
  const rows = await tsql<
    {
      id: string
      code: string
      name: string
      category_name: string
      purchase_unit: string
      unit_name: string
      on_hand_qty: string
      has_cost: boolean
      times: number
      last: string
      typical_qty: string
    }[]
  >`
    select f.item_id as id, f.item_code as code, f.item_name as name,
           c.name as category_name, f.purchase_unit, u.name as unit_name,
           coalesce(s.on_hand_qty, 0)::text as on_hand_qty,
           (ic.issue_cost is not null) as has_cost,
           f.times_issued::int as times,
           f.last_issued::text as last,
           round(f.typical_qty, 3)::text as typical_qty
    from section_frequent_items f
    join items i on i.id = f.item_id
    join categories c on c.code = i.category
    join units u on u.code = f.purchase_unit
    left join stock_on_hand s on s.item_id = f.item_id
    left join item_costs ic on ic.item_id = f.item_id
    where f.restaurant_id = ${restaurantId}
      and f.section_id = ${sectionId}
      and i.status = 'active'
    order by f.times_issued desc, f.last_issued desc, f.item_name asc
    limit 20`
  return rows.map((r) => ({
    item: {
      id: r.id,
      code: r.code,
      name: r.name,
      category_name: r.category_name,
      purchase_unit: r.purchase_unit,
      unit_name: r.unit_name,
      on_hand_qty: r.on_hand_qty,
      has_cost: r.has_cost,
    },
    times: r.times,
    last: r.last,
    typical_qty: r.typical_qty,
    last_rate: null,
    source_purchase_line_id: null,
  }))
}

/**
 * Stock on hand, ordered so the screen can GROUP BY CATEGORY.
 *
 * A STOCK SCREEN IS NOT ONE JOB, and this is the owner's: what is it worth.
 * Category is how inventory is presented in every accounting standard, so the
 * grouping is not a preference — it is the shape the reader already knows.
 * Ordering is category, then value within it, so the group's own list still
 * leads with what matters.
 *
 * TWO VIEWS, NOT THREE. By category is the owner's monthly question and the
 * default; BY VALUE is a flat list, value descending, and it is not a lesser
 * view — at a few hundred items "what are my ten biggest holdings" is a
 * different question from "what is Dry Goods worth", and grouping HIDES it.
 *
 * There is deliberately no "by shelf": Count already walks by location, and
 * the three-jobs argument maps to the three TABS rather than to three toggles
 * inside one of them. Two answers to one question is the fault this codebase
 * keeps removing.
 *
 * `abc` and `days_on_hand` are LEFT JOINed and stay NULL rather than being
 * coalesced: an item absent from stock_abc has no share of the value, and
 * days_on_hand is deliberately NULL below 7 days of issue history because one
 * issue makes max = min and the average would read the whole quantity as a
 * single day's usage. The screen says "not enough history" in both cases.
 */
export async function listStock(
  restaurantId: string,
  q: string,
  view: StockView = 'by-category',
  /** one category, when the reader has tapped one in the fold. A category
   *  filter and a search filter are the SAME operation, so they share this one
   *  renderer and one code path rather than growing a second, foldable one. */
  cat = '',
): Promise<StockRow[]> {
  const like = `%${q}%`
  return tsql<StockRow[]>`
    select s.item_id, s.code, s.name, s.category,
           -- LEFT, NOT INNER. An item whose category code is absent from the
           -- categories table was silently DROPPED FROM THIS LIST — the same
           -- fault the rollup guards against, one query earlier and with
           -- nothing summing 15 numbers to catch it. Unclassified now.
           coalesce(c.name, 'Unclassified') as category_name,
           s.purchase_unit, i.status,
           s.purchased_qty::text as purchased_qty,
           s.issued_qty::text as issued_qty,
           s.wasted_qty::text as wasted_qty,
           s.on_hand_qty::text as on_hand_qty,
           s.issue_cost::text as issue_cost,
           s.on_hand_value::text as on_hand_value,
           a.abc,
           a.pct_of_value::text as pct_of_value,
           d.days_on_hand::text as days_on_hand,
           d.days_of_history::int as days_of_history
    from stock_on_hand s
    join items i on i.id = s.item_id
    left join categories c on c.code = s.category
    left join stock_abc a on a.restaurant_id = s.restaurant_id and a.item_id = s.item_id
    left join stock_days_on_hand d on d.restaurant_id = s.restaurant_id and d.item_id = s.item_id
    where s.restaurant_id = ${restaurantId}
      and (s.name ilike ${like} or s.code ilike ${like})
      ${cat === '' ? sql`` : sql`and s.category = ${cat}`}
    order by ${view === 'by-category' ? sql`c.name asc,` : sql``}
             s.on_hand_value desc, s.code asc`
}

/** Items nobody has placed on a shelf. Counted for the store dashboard's
 *  readiness block, beside "no item carries a reorder level": a thing that is
 *  empty until somebody does it, and that blocks nothing until the first
 *  count — at which point an unplaced item is one that gets walked past. */
export async function countUnplacedItems(restaurantId: string): Promise<{ unplaced: number; total: number }> {
  const [row] = await tsql<{ unplaced: number; total: number }[]>`
    select count(*) filter (where storage_location_id is null)::int as unplaced,
           count(*)::int as total
    from items where restaurant_id = ${restaurantId} and status = 'active'`
  return { unplaced: row?.unplaced ?? 0, total: row?.total ?? 0 }
}

export async function stockTotalValue(restaurantId: string): Promise<string> {
  const rows = await tsql<{ total: string }[]>`
    select coalesce(sum(on_hand_value), 0)::text as total
    from stock_on_hand where restaurant_id = ${restaurantId}`
  return rows[0]?.total ?? '0'
}

export async function getSectionsWithMonth(restaurantId: string, monthStart: string): Promise<SectionMonthRow[]> {
  return tsql<SectionMonthRow[]>`
    select s.id, s.code, s.name, s.sort_order, s.status,
           coalesce(sc.consumed_value, 0)::text as consumed_value
    from sections s
    left join section_consumption sc
      on sc.restaurant_id = s.restaurant_id and sc.section_code = s.code and sc.month = ${monthStart}::date
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    order by s.sort_order asc`
}

export async function getChecklist(restaurantId: string, dateStr: string): Promise<ChecklistRow[]> {
  return tsql<ChecklistRow[]>`
    select s.id, s.code, s.name, s.sort_order,
           (select count(*)::int from issues i
            where i.section_id = s.id and i.issue_date = ${dateStr} and i.reverses_id is null
              and not exists (select 1 from issues r where r.reverses_id = i.id)) as issues_today
    from sections s
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    order by s.sort_order asc`
}

const ISSUE_SELECT = `
  select i.id, i.issue_date::text as issue_date, i.section_id, s.code as section_code, s.name as section_name,
         i.note, i.indent_id, i.reverses_id, i.entered_by, i.created_at::text as created_at,
         (i.reverses_id is not null) as is_reversal,
         exists (select 1 from issues r where r.reverses_id = i.id) as is_voided,
         (select count(*)::int from issue_lines il where il.issue_id = i.id) as line_count,
         (select coalesce(sum(il.value), 0)::text from issue_lines il where il.issue_id = i.id) as total_value
  from issues i
  join sections s on s.id = i.section_id`

export async function getIssue(restaurantId: string, id: string): Promise<IssueDetail | null> {
  const rows = await tsql<IssueDetail[]>`
    ${sql.unsafe(ISSUE_SELECT)}
    where i.restaurant_id = ${restaurantId} and i.id = ${id}`
  return rows[0] ?? null
}

export async function getIssueLines(issueId: string): Promise<IssueLineRow[]> {
  return tsql<IssueLineRow[]>`
    select il.id, il.item_id, it.code as item_code, it.name as item_name, it.purchase_unit,
           il.qty::text as qty, il.unit_cost::text as unit_cost, il.value::text as value
    from issue_lines il
    join items it on it.id = il.item_id
    where il.issue_id = ${issueId}
    order by it.code asc, il.id asc`
}

// Returns run the same shape backwards. stock_on_hand already ADDS
// returned_qty back and section_consumption already SUBTRACTS return value
// from issued value — the views own that arithmetic, nothing recomputes it.
const RETURN_SELECT = `
  select r.id, r.return_date::text as return_date, r.section_id, s.code as section_code, s.name as section_name,
         r.reason, r.note, r.reverses_id, r.entered_by, r.created_at::text as created_at,
         (r.reverses_id is not null) as is_reversal,
         exists (select 1 from returns v where v.reverses_id = r.id) as is_voided,
         (select count(*)::int from return_lines rl where rl.return_id = r.id) as line_count,
         (select coalesce(sum(rl.value), 0)::text from return_lines rl where rl.return_id = r.id) as total_value
  from returns r
  join sections s on s.id = r.section_id`

export async function getReturn(restaurantId: string, id: string): Promise<ReturnDetail | null> {
  const rows = await tsql<ReturnDetail[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

export async function getReturnLines(returnId: string): Promise<ReturnLineRow[]> {
  return tsql<ReturnLineRow[]>`
    select rl.id, rl.item_id, it.code as item_code, it.name as item_name, it.purchase_unit,
           rl.qty::text as qty, rl.unit_cost::text as unit_cost, rl.value::text as value
    from return_lines rl
    join items it on it.id = rl.item_id
    where rl.return_id = ${returnId}
    order by it.code asc, rl.id asc`
}

export async function getIssueVoidedBy(issueId: string): Promise<{ id: string } | null> {
  const rows = await tsql<{ id: string }[]>`select id from issues where reverses_id = ${issueId} limit 1`
  return rows[0] ?? null
}

const WASTAGE_SELECT = `
  select w.id, w.waste_date::text as waste_date, w.item_id, it.code as item_code, it.name as item_name,
         it.purchase_unit, w.qty::text as qty, w.unit_cost::text as unit_cost, w.value::text as value,
         w.reason, w.note, w.reverses_id, w.entered_by, w.created_at::text as created_at,
         (w.reverses_id is not null) as is_reversal,
         exists (select 1 from wastage r where r.reverses_id = w.id) as is_voided
  from wastage w
  join items it on it.id = w.item_id`

export async function getWastage(restaurantId: string, id: string): Promise<WastageDetail | null> {
  const rows = await tsql<WastageDetail[]>`
    ${sql.unsafe(WASTAGE_SELECT)}
    where w.restaurant_id = ${restaurantId} and w.id = ${id}`
  return rows[0] ?? null
}

export async function getWastageVoidedBy(wastageId: string): Promise<{ id: string } | null> {
  const rows = await tsql<{ id: string }[]>`select id from wastage where reverses_id = ${wastageId} limit 1`
  return rows[0] ?? null
}

/**
 * The store's day — issues and wastage in one log.
 *
 * PERIOD-SCOPED, because it is the destination of the "Stock out" card and a
 * drill-down that answers over a different window than the number it was
 * clicked from is a lie that looks perfectly healthy. `from`/`to` omitted means
 * all time, which is what the Books tab shows when nobody has picked a period.
 */
export async function listStoreLog(
  restaurantId: string,
  limit = 150,
  from?: string,
  to?: string,
): Promise<StoreLogRow[]> {
  const issues = await tsql<
    {
      id: string
      date: string
      created_at: string
      is_reversal: boolean
      is_voided: boolean
      value: string
      section_code: string
      section_name: string
      line_count: number
    }[]
  >`
    select i.id, i.issue_date::text as date, i.created_at::text as created_at,
           (i.reverses_id is not null) as is_reversal,
           exists (select 1 from issues r where r.reverses_id = i.id) as is_voided,
           (select coalesce(sum(il.value), 0)::text from issue_lines il where il.issue_id = i.id) as value,
           s.code as section_code, s.name as section_name,
           (select count(*)::int from issue_lines il where il.issue_id = i.id) as line_count
    from issues i join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId}
      ${from === undefined || to === undefined ? sql`` : sql`and i.issue_date between ${from}::date and ${to}::date`}
    order by i.issue_date desc, i.created_at desc
    limit ${limit}`
  const waste = await tsql<
    {
      id: string
      date: string
      created_at: string
      is_reversal: boolean
      is_voided: boolean
      value: string
      item_name: string
      qty: string
      purchase_unit: string
      reason: string
    }[]
  >`
    select w.id, w.waste_date::text as date, w.created_at::text as created_at,
           (w.reverses_id is not null) as is_reversal,
           exists (select 1 from wastage r where r.reverses_id = w.id) as is_voided,
           w.value::text as value, it.name as item_name, w.qty::text as qty, it.purchase_unit, w.reason
    from wastage w join items it on it.id = w.item_id
    where w.restaurant_id = ${restaurantId}
      ${from === undefined || to === undefined ? sql`` : sql`and w.waste_date between ${from}::date and ${to}::date`}
    order by w.waste_date desc, w.created_at desc
    limit ${limit}`
  const merged: StoreLogRow[] = [
    ...issues.map((r) => ({ kind: 'issue' as const, ...r })),
    ...waste.map((r) => ({ kind: 'wastage' as const, ...r })),
  ]
  merged.sort((a, b) => (a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date)))
  return merged.slice(0, limit)
}

// ---------------------------------------------------------------- indents
// The store side of indents: the badge count, the pick list, and an open
// indent shaped to prefill the issue form. The indent records what was
// ASKED; the issue records what was GIVEN — two documents, one stamp.

// ───────────────────────── the store's own dashboard ─────────────────────
// Period-scoped, same rules as the owner's: event tables filter on the range,
// absent days stay absent rather than being drawn as zero.

/** Money in the door, by day — purchases net of voids. */
/**
 * THE CURRENT WINDOW AND ITS BASELINE, IN ONE ROUND TRIP.
 *
 * A comparison must add no trips: the page already fans out nineteen, and a
 * second batch per measure would be three more on a screen whose whole design
 * argument is one fan-out. So both windows ride the SAME statement — the WHERE
 * widens to cover the union and each row says which window it belongs to.
 *
 * `first_entry` is the ALL-TIME minimum for this measure, as an uncorrelated
 * subquery so Postgres runs it once as an InitPlan rather than per row. It is
 * what the "books did not exist" gate reads, and it is READ PER MEASURE at
 * query time — never a constant. Purchases began 5 Jun, issues 28 Aug, wastage
 * has not begun; they do not start together and never will.
 */
export async function getPurchaseSeries(
  restaurantId: string,
  from: string,
  to: string,
  /** the baseline window, or null for no comparison */
  base: { from: string; to: string } | null = null,
): Promise<ComparedSeries> {
  const bFrom = base?.from ?? from
  const bTo = base?.to ?? to
  const rows = await tsql<{ date: string; total: string; window: string; first_entry: string | null }[]>`
    select bill_date::text as date, sum(bill_total)::text as total,
           case when bill_date between ${from}::date and ${to}::date then 'current' else 'baseline' end as window,
           (select min(bill_date)::text from purchases where restaurant_id = ${restaurantId}) as first_entry
    from purchases
    where restaurant_id = ${restaurantId}
      and (bill_date between ${from}::date and ${to}::date
           or (${base !== null} and bill_date between ${bFrom}::date and ${bTo}::date))
    group by bill_date
    having sum(bill_total) <> 0
    order by bill_date asc`
  return splitWindows(rows)
}

/** Issue value per section across the period — where the stock went. */
/** Same one-trip shape as getPurchaseSeries: both windows in one statement,
 *  each row saying which it belongs to, and the measure's OWN all-time first
 *  entry — issues began 28 Aug where purchases began 5 Jun. */
export async function getIssuesBySection(
  restaurantId: string,
  from: string,
  to: string,
  base: { from: string; to: string } | null = null,
): Promise<{
  rows: { section: string; value: string }[]
  baselineTotal: string
  currentDays: number
  baselineDays: number
  firstEntry: string | null
}> {
  const bFrom = base?.from ?? from
  const bTo = base?.to ?? to
  // ONE STATEMENT. The meta CTE is LEFT JOINed to the grouping rather than
  // queried separately, for two reasons: a second query would be a second round
  // trip on a page whose whole design argument is one fan-out, and — the part
  // that actually bites — a grouped query returns NO ROWS when the window is
  // empty, which is precisely the state issues are in. Joining from meta means
  // there is always a row carrying the first-entry date and the day counts, so
  // the gates can speak even when the measure has nothing to say.
  const rows = await tsql<{
    section: string | null
    value: string | null
    win: string | null
    first_entry: string | null
    base_total: string
    cur_days: number
    base_days: number
  }[]>`
    with meta as (
      select (select min(issue_date)::text from issues where restaurant_id = ${restaurantId}) as first_entry,
             count(distinct i.issue_date) filter (
               where i.issue_date between ${from}::date and ${to}::date)::int as cur_days,
             count(distinct i.issue_date) filter (
               where ${base !== null} and i.issue_date between ${bFrom}::date and ${bTo}::date)::int as base_days,
             -- THE BASELINE TOTAL IS SUMMED IN SQL, at full numeric precision.
             -- Reducing the returned rows with Number() in JS would round every
             -- department's subtotal to a float before adding them, which is the
             -- paise fault this repo has now paid for twice. Uncorrelated, so it
             -- costs no extra round trip.
             coalesce((select sum(l2.value) from issue_lines l2
                       join issues i2 on i2.id = l2.issue_id
                       where i2.restaurant_id = ${restaurantId}
                         and ${base !== null}
                         and i2.issue_date between ${bFrom}::date and ${bTo}::date), 0)::text as base_total
      from issues i where i.restaurant_id = ${restaurantId}
    ), tagged as (
      -- THE WINDOW IS TAGGED ONCE, IN A SUBQUERY, and grouped by the alias.
      -- Repeating the CASE in the GROUP BY looks identical in the source and is
      -- not: postgres.js numbers each interpolation hole separately, so the two
      -- copies arrive as different parameter numbers and Postgres reads them as
      -- two different expressions — "column i.issue_date must appear in the
      -- GROUP BY clause". Tagging once removes the second copy entirely.
      -- win, not window: WINDOW is a reserved word, legal as an AS label and
      -- a syntax error the moment it is referenced bare in a select list or a
      -- GROUP BY. It parsed happily until the grouping moved into a subquery.
      select s.name as section, s.sort_order, l.value,
             case when i.issue_date between ${from}::date and ${to}::date
                  then 'current' else 'baseline' end as win
      from issue_lines l
      join issues i on i.id = l.issue_id
      join sections s on s.id = i.section_id
      where i.restaurant_id = ${restaurantId}
        and (i.issue_date between ${from}::date and ${to}::date
             or (${base !== null} and i.issue_date between ${bFrom}::date and ${bTo}::date))
    ), grp as (
      select section, win, sum(value)::text as value, sum(value) as v
      from tagged
      group by section, win
      having sum(value) > 0
    )
    select grp.section, grp.value, grp.win,
           meta.first_entry, meta.base_total, meta.cur_days, meta.base_days
    from meta left join grp on true
    order by grp.v desc nulls last`

  const current = rows
    .filter((r) => r.win === 'current' && r.section !== null)
    .map((r) => ({ section: r.section as string, value: r.value as string }))
  return {
    rows: current,
    baselineTotal: rows[0]?.base_total ?? '0',
    currentDays: rows[0]?.cur_days ?? 0,
    baselineDays: rows[0]?.base_days ?? 0,
    firstEntry: rows[0]?.first_entry ?? null,
  }
}

/** Payments made in the period, and what they totalled. */
export async function getPaymentsTotal(
  restaurantId: string,
  from: string,
  to: string,
): Promise<{ total: string; count: number }> {
  const [row] = await tsql<{ total: string; count: number }[]>`
    select coalesce(sum(p.amount), 0)::text as total, count(*)::int as count
    from payments p
    join vendors v on v.id = p.vendor_id
    where v.restaurant_id = ${restaurantId} and p.paid_date between ${from}::date and ${to}::date`
  return row ?? { total: '0', count: 0 }
}

/** What the store bought in the period, per vendor — the trip ledger. */
/**
 * WHO THE PERIOD'S GOODS CAME FROM — EVERY vendor, not the top eight.
 *
 * THE CAP WAS SILENT AND IT WAS ALREADY WRONG. This returned `limit 8`, and
 * the table sits under the Goods in hero: on 1–28 Aug there are THIRTY-ONE
 * vendors, so the column showed ₹13,08,177.71 beneath a heading saying
 * ₹17,77,607.50 — ₹4.69 lakh missing, in a table whose whole job is to break
 * that number down. Nobody adds eight rows by eye to notice.
 *
 * Thirty-one rows is a trivial payload, so the truncation moves to the SCREEN
 * where it can be named: the page shows the largest few and folds the rest into
 * one labelled row, so the column still adds up to the hero. No silent caps —
 * a top-N that does not say what it dropped reads as "all of it".
 */
export async function getPurchasesByVendor(
  restaurantId: string,
  from: string,
  to: string,
): Promise<{ vendor: string; total: string }[]> {
  return tsql<{ vendor: string; total: string }[]>`
    select v.name as vendor, sum(p.bill_total)::text as total
    from purchases p
    join vendors v on v.id = p.vendor_id
    where p.restaurant_id = ${restaurantId} and p.bill_date between ${from}::date and ${to}::date
    group by v.name
    having sum(p.bill_total) <> 0
    order by sum(p.bill_total) desc`
}

/** Items at or below their reorder level, straight from reorder_due.
 *
 * The view returns nothing until somebody sets a reorder_level on an item —
 * that is an empty answer, not a broken one, and the tab says so rather
 * than implying everything is well stocked. */
export async function listReorderDue(restaurantId: string): Promise<ReorderRow[]> {
  return tsql<ReorderRow[]>`
    select item_id, code, name, category, purchase_unit,
           on_hand_qty::text as on_hand_qty,
           reorder_level::text as reorder_level,
           par_level::text as par_level,
           suggested_qty::text as suggested_qty,
           usual_vendor, vendor_id,
           issue_cost::text as issue_cost,
           -- URGENCY, DEFINED HERE AND STATED ON SCREEN: how much of the
           -- reorder level is still on the shelf. Out of stock ranks above
           -- "just crossed the line", which alphabetical order cannot say.
           -- A zero or absent level cannot produce a ratio, so it sorts last
           -- rather than dividing by zero.
           case when reorder_level is null or reorder_level = 0 then null
                else (on_hand_qty / reorder_level)::numeric end as urgency
    from reorder_due
    where restaurant_id = ${restaurantId}
    order by urgency asc nulls last, name asc`
}

/** What the Stock tab's badge is counting, and which view to open. */
export type StockBadge = {
  /** items showing less than nothing on the shelf — a bill is probably missing */
  negative: number
  /** counts saved and never accepted into the book */
  unaccepted: number
  /** items at or below their reorder level */
  reorder: number
}

/**
 * The Stock badge fires on ANY of three problems, not just reorder.
 *
 * One statement, three scalar subqueries: this renders with the tab strip on
 * every page in the group, so it must cost one round trip and not three. It
 * sits beside the page's own reads in the layout+page fan-out — the thing
 * that once deadlocked this app at `max: 4`.
 *
 * Nothing new is computed. `stock_on_hand`, `stock_counts.accepted_at` and
 * `reorder_due` are the same sources the four views already read.
 */
export async function getStockBadge(restaurantId: string): Promise<StockBadge> {
  const [row] = await tsql<{ negative: number; unaccepted: number; reorder: number }[]>`
    select
      (select count(*)::int from stock_on_hand
        where restaurant_id = ${restaurantId} and on_hand_qty < 0) as negative,
      (select count(*)::int from stock_counts
        where restaurant_id = ${restaurantId} and accepted_at is null) as unaccepted,
      (select count(*)::int from reorder_due
        where restaurant_id = ${restaurantId}) as reorder`
  return {
    negative: row?.negative ?? 0,
    unaccepted: row?.unaccepted ?? 0,
    reorder: row?.reorder ?? 0,
  }
}

/**
 * Which Stock view the badge opens — the MOST SERIOUS thing firing.
 *
 * The order is not arbitrary. Negative stock means the arithmetic is already
 * impossible and a bill is missing. An unaccepted count means somebody
 * measured a discrepancy and nobody has stood behind it. Reorder is ordinary
 * work. Landing on a fixed default instead would send a manager to the
 * shopping list while the book says minus four kilos.
 *
 * Null when nothing is firing — and then the tab wears no badge at all.
 */
/**
 * WHERE A BADGED TAB LANDS — the one that is firing, worst first.
 *
 * AN ALERT CARRYING AN ACTION BEATS ONE CARRYING INFORMATION, and each of
 * these is already a place where something can be DONE rather than merely
 * read: negative stock opens the shelf that cannot be true, an unaccepted
 * count opens the decision nobody took, and reorder opens the list whose
 * vendor cards raise a purchase order. That last one only became an action
 * when Raise PO existed; before it, the badge led to a fact.
 */
export function stockBadgeHref(b: StockBadge): string | null {
  if (b.negative > 0) return '/store/stock/on-hand'
  if (b.unaccepted > 0) return '/store/stock/count'
  if (b.reorder > 0) return '/store/stock/reorder'
  return null
}

export async function countReorderDue(restaurantId: string): Promise<number> {
  const [row] = await tsql<{ n: number }[]>`
    select count(*)::int as n from reorder_due where restaurant_id = ${restaurantId}`
  return row?.n ?? 0
}

/** How many items carry a reorder_level at all — the honesty denominator
 *  behind an empty Reorder tab. */
export async function countItemsWithReorderLevel(restaurantId: string): Promise<number> {
  const [row] = await tsql<{ n: number }[]>`
    select count(*)::int as n from items
    where restaurant_id = ${restaurantId} and status = 'active' and reorder_level is not null`
  return row?.n ?? 0
}

export async function countOpenIndents(restaurantId: string): Promise<number> {
  const rows = await tsql<{ n: number }[]>`
    select count(*)::int as n from open_indents where restaurant_id = ${restaurantId}`
  return rows[0]?.n ?? 0
}

export async function listOpenIndents(
  restaurantId: string,
  sectionId?: string,
  session?: string,
): Promise<IndentRow[]> {
  return tsql<IndentRow[]>`
    select i.id, i.indent_date::text as indent_date, i.section_id, i.session,
           s.code as section_code, s.name as section_name, i.status, i.note,
           i.entered_by, i.created_at::text as created_at,
           (select count(*)::int from indent_lines l where l.indent_id = i.id) as line_count
    from indents i join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId} and i.status = 'open'
      ${sectionId ? sql`and i.section_id = ${sectionId}` : sql``}
      ${session ? sql`and i.session = ${session}` : sql``}
    order by i.indent_date desc, i.created_at desc
    limit 30`
}

/** One open indent with its lines joined to live stock/cost — ready to
 * drop into the issue form. Items retired or costless since the indent
 * still appear (has_cost false) so the store sees the full ask. */
export async function getIndentPrefill(restaurantId: string, indentId: string): Promise<IndentPrefill | null> {
  const rows = await tsql<
    (Omit<IndentPrefill, 'lines'> & { status: string })[]
  >`
    select i.id, i.indent_date::text as indent_date, i.section_id, i.session,
           s.code as section_code, s.name as section_name, i.note, i.status
    from indents i join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId} and i.id = ${indentId}`
  const head = rows[0]
  if (!head) return null
  const lines = await tsql<(IssuableItemHit & { qty: string })[]>`
    select it.id, it.code, it.name, c.name as category_name, it.purchase_unit, u.name as unit_name,
           coalesce(st.on_hand_qty, 0)::text as on_hand_qty,
           (ic.issue_cost is not null) as has_cost,
           l.qty_requested::text as qty
    from indent_lines l
    join items it on it.id = l.item_id
    join categories c on c.code = it.category
    join units u on u.code = it.purchase_unit
    left join stock_on_hand st on st.item_id = it.id
    left join item_costs ic on ic.item_id = it.id
    where l.indent_id = ${indentId}
    order by it.name asc`
  return {
    id: head.id,
    indent_date: head.indent_date,
    session: head.session,
    section_id: head.section_id,
    section_code: head.section_code,
    section_name: head.section_name,
    note: head.note,
    lines: lines.map(({ qty, ...item }) => ({ item, qty })),
  }
}

export async function getStockSnaps(restaurantId: string, itemIds: string[]): Promise<StockSnap[]> {
  if (itemIds.length === 0) return []
  return tsql<StockSnap[]>`
    select s.item_id, s.code, s.name, s.purchase_unit,
           s.on_hand_qty::text as on_hand_qty, s.on_hand_value::text as on_hand_value
    from stock_on_hand s
    where s.restaurant_id = ${restaurantId} and s.item_id = any(${itemIds})
    order by s.code asc`
}

/** Per-department, per-session daily consumption VALUE, net of returns —
 *  section_consumption_daily.
 *
 *  QUANTITY ON THE INDENT, VALUE ON THE DASHBOARD. The indent form stays
 *  purely in quantities on purpose: at the moment of asking for onions, a
 *  rupee figure invites the chef to trim the request to look good rather
 *  than ask for what the menu needs. But the chef IS accountable for what
 *  their department consumed at month end, so the value belongs here —
 *  after the asking, where it informs rather than distorts.
 *
 *  The view nets returns already; nothing here re-subtracts them. */
export async function getSectionConsumptionDaily(
  restaurantId: string,
  from: string,
  to: string,
  sectionCodes?: string[],
): Promise<SectionConsumptionDay[]> {
  return tsql<SectionConsumptionDay[]>`
    select section_code, section_name, move_date::text as move_date, session,
           consumed_value::text as consumed_value, movements::int as movements
    from section_consumption_daily
    where restaurant_id = ${restaurantId}
      and move_date between ${from}::date and ${to}::date
      and (${sectionCodes ?? null}::text[] is null or section_code = any(${sectionCodes ?? null}::text[]))
    order by move_date asc, section_code asc, session asc`
}

/**
 * What every vendor's price did, bill over bill, in a period.
 *
 * PARTITIONED BY (VENDOR, ITEM) IN THE VIEW, which is the whole point: an
 * item-wide average would call Sneha's ₹300 a fall and RR's ₹330 a rise on the
 * same Chicken Boneless, and both would be wrong.
 *
 * FIRST PURCHASES ARE EXCLUDED, not shown as a change from nothing. A row with
 * no previous rate is a vendor's first bill for that item — real, and not a
 * movement — so it is left out of a report whose entire subject is movement.
 * The count of them is returned so the screen can say how much it is not
 * showing rather than implying the list is everything.
 */
export async function getPriceMovements(
  restaurantId: string,
  from: string,
  to: string,
): Promise<{ rows: PriceMovementRow[]; firstPurchases: number }> {
  return txn(async (tx) => {
    const rows = await tx<PriceMovementRow[]>`
      -- vendor_id so the name can be a door. The view has always published
      -- it; only the select list was leaving it behind.
      select vendor_id, vendor_name, item_id, item_code, item_name, purchase_unit,
             bill_date::text as bill_date, bill_no,
             qty::text as qty, rate::text as rate,
             previous_rate::text as previous_rate,
             previous_date::text as previous_date,
             change_value::text as change_value,
             change_pct::text as change_pct,
             cost_of_change::text as cost_of_change
      from price_movements
      where restaurant_id = ${restaurantId}
        and bill_date >= ${from}::date and bill_date <= ${to}::date
        and previous_rate is not null
        and change_value <> 0
      -- WORST FIRST BY WHAT IT COST, not by percentage: a 40% rise on a
      -- ₹20 item matters less than a 6% rise on the chicken, and the
      -- ordering is the report's argument.
      order by cost_of_change desc nulls last, bill_date desc`
    const [firsts] = await tx<{ n: number }[]>`
      select count(*)::int as n from price_movements
      where restaurant_id = ${restaurantId}
        and bill_date >= ${from}::date and bill_date <= ${to}::date
        and previous_rate is null`
    return { rows, firstPurchases: firsts?.n ?? 0 }
  })
}

/**
 * Dated deliveries of things still on the book, soonest first.
 *
 * THE VIEW PUBLISHES NO "TODAY" ON PURPOSE — `business_date()` reads settings
 * and so answers only inside a tenant-announcing transaction, which would make
 * a view that called it correct only while RLS happened to be filtering it.
 * That is a rule holding by accident. The comparison is made here, against the
 * app's own business day, and the caller passes it in.
 *
 * `on_hand_qty` IS THE ITEM'S TOTAL, not the batch's, because stock is a
 * running quantity and there is no lot tracking. Callers must render this as a
 * prompt to go and look, never as a claim about which goods are on the shelf.
 */
export async function getExpiringStock(
  restaurantId: string,
  today: string,
  withinDays: number,
): Promise<ExpiringStockRow[]> {
  return tsql<ExpiringStockRow[]>`
    select item_id, code, name, category, purchase_unit,
           on_hand_qty::text as on_hand_qty,
           issue_cost::text as issue_cost,
           bill_date::text as bill_date,
           expiry_date::text as expiry_date,
           qty_received::text as qty_received,
           vendor_name, bill_no
    from expiring_stock
    where restaurant_id = ${restaurantId}
      -- make_interval(days => n) reads as a bare column called "days" to the
      -- schema gate's scanner, and blinding it to that word would be wrong —
      -- a table may legitimately have a column called days. Multiplying an
      -- interval says the same thing with no named argument, so the SQL is
      -- fixed rather than the gate taught to look away.
      and expiry_date <= (${today}::date + (${withinDays} * interval '1 day'))
    -- EXPIRED FIRST, then soonest. A date already past is not a warning, it is
    -- a thing to go and throw away.
    order by expiry_date asc, name asc`
}


/**
 * STOCK VALUE ROLLED UP BY CATEGORY — fifteen rows instead of three hundred and
 * sixty. 360 rows is a query result, not a screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SILENT DROP THIS EXISTS TO PREVENT.
 *
 * The value card totals `stock_on_hand` directly; this totals it JOINED to
 * `categories`. A category code present on an item and absent from the
 * categories table would drop those items from the fold and leave the card
 * untouched — fifteen subtotals that each look plausible and do not add up.
 * NOBODY SUMS FIFTEEN NUMBERS BY EYE, so it would fail silently and forever.
 *
 * So the join is LEFT and unresolved codes land under UNCLASSIFIED, never
 * dropped; and the caller asserts these subtotals against the card exactly, in
 * paise. Measured today: both are ₹25,92,511.86, and excluding one category
 * from the join moves the rollup to ₹18,98,750.36 — caught, and named.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `kind` comes from `categories.kind`, which already holds exactly the split
 * the screen needs — ingredient becomes cost of goods sold, operational becomes
 * operating cost. No mapping table and no constant: the column is the answer.
 *
 * GROUPED FROM THE ITEM SIDE, so a category with no items never renders. MNT
 * exists with zero items and must not appear; OFF has one item worth ₹0 and
 * must. Those are different facts and an `items > 0` filter would conflate
 * them — the row is here because an item points at it, not because it has
 * value.
 */
export async function stockCategoryRollup(restaurantId: string): Promise<{
  rows: CategoryRollupRow[]
  /** exact, computed in SQL — see the note below on why not in paise */
  reconciles: boolean
  cardExact: string
  rollupExact: string
}> {
  const rows = await tsql<CategoryRollupRow[]>`
    select coalesce(c.code, '')                       as category,
           coalesce(c.name, 'Unclassified')           as category_name,
           coalesce(c.kind, 'unclassified')           as kind,
           count(*)::int                              as items,
           count(*) filter (where s.on_hand_qty < 0)::int as negatives,
           sum(s.on_hand_value)::text                 as value
    from stock_on_hand s
    join items i on i.restaurant_id = s.restaurant_id and i.id = s.item_id
    left join categories c on c.code = i.category
    where s.restaurant_id = ${restaurantId}
    group by 1, 2, 3
    order by sum(s.on_hand_value) desc`

  // ── THE RECONCILIATION, COMPUTED IN SQL AND AT FULL PRECISION ───────────
  //
  // NOT in paise, and that is a correction rather than a shortcut. The first
  // version summed each category rounded to paise and compared it with the
  // card rounded to paise — and reported a mismatch of ONE PAISA on live data.
  // Nothing was dropped: on_hand_value is qty × a weighted average carrying
  // eighteen decimals, so fifteen roundings do not add up to one rounding.
  // Rounding is not associative and never will be.
  //
  // What this check is FOR is "no item fell out of the join". That question has
  // an exact answer, so it is asked exactly — and a tolerance would have been
  // the thing that let a real one-item discrepancy through.
  //
  // The subtotals are still DISPLAYED rounded, and across fifteen of them the
  // last paise may not visibly add up. That is arithmetic, not a missing item.
  const [check] = await tsql<{ card: string; roll: string; ok: boolean }[]>`
    with card as (
      select coalesce(sum(on_hand_value), 0) v
      from stock_on_hand where restaurant_id = ${restaurantId}
    ), roll as (
      select coalesce(sum(s.on_hand_value), 0) v
      from stock_on_hand s
      join items i on i.restaurant_id = s.restaurant_id and i.id = s.item_id
      left join categories c on c.code = i.category
      where s.restaurant_id = ${restaurantId}
    )
    select card.v::text as card, roll.v::text as roll, (card.v = roll.v) as ok
    from card, roll`

  return {
    rows,
    reconciles: check?.ok ?? false,
    cardExact: check?.card ?? '0',
    rollupExact: check?.roll ?? '0',
  }
}

/**
 * HAS ANYTHING EVER LEFT THE STORE — all time, never period-scoped.
 *
 * The claim the honesty block makes is about the BOOKS, not about a month: a
 * register with one side is a running total of purchases whatever window you
 * look at it through. It clears itself the day one issue is saved, which is why
 * it is a query and not a setting.
 */
export async function hasAnyIssue(restaurantId: string): Promise<boolean> {
  const [row] = await tsql<{ any: boolean }[]>`
    select exists (select 1 from issue_lines where restaurant_id = ${restaurantId}) as any`
  return row?.any ?? false
}

/** What the block needs to say it in figures: when the books open, and how many
 *  bills have landed since. The opening date is the earliest movement of any
 *  kind, which is the opening count rather than the first bill. */
export async function issueContext(
  restaurantId: string,
): Promise<{ issued: boolean; since: string | null; bills: number }> {
  const [row] = await tsql<{ issued: boolean; since: string | null; bills: number }[]>`
    select exists (select 1 from issue_lines where restaurant_id = ${restaurantId}) as issued,
           least(
             (select min(adj_date) from stock_adjustments where restaurant_id = ${restaurantId}),
             (select min(bill_date) from purchases where restaurant_id = ${restaurantId})
           )::text as since,
           (select count(*)::int from purchases where restaurant_id = ${restaurantId}) as bills`
  return row ?? { issued: false, since: null, bills: 0 }
}


/**
 * EVERY VENDOR PAYMENT IN A WINDOW — the destination of the "Paid out" card.
 *
 * THERE WAS NO PAYMENTS LOG. Payments live at /store/purchasing/pay, which is a
 * FORM, and a number must never link to a form: a reader clicking a figure is
 * asking "what is this made of", and being handed a blank entry screen answers
 * a different question and loses their place. So the log exists now rather than
 * the card being left dead — three clickable figures and one that is not
 * teaches that some numbers are clickable, which is worse than none being.
 *
 * NO CAP. Seventeen payments today and a few hundred a year; a limit here would
 * be the silent truncation this page has already been caught by once, on a list
 * whose whole job is to add up to the number above it.
 */
export async function listPaymentsLog(
  restaurantId: string,
  from: string,
  to: string,
): Promise<PaymentLogRow[]> {
  return tsql<PaymentLogRow[]>`
    select p.id, p.doc_no, p.paid_date::text as paid_date, p.amount::text as amount,
           p.mode, p.note, p.entered_by,
           v.code as vendor_code, v.name as vendor_name,
           a.name as account_name
    from payments p
    join vendors v on v.restaurant_id = p.restaurant_id and v.id = p.vendor_id
    left join money_accounts a on a.restaurant_id = p.restaurant_id and a.id = p.account_id
    where p.restaurant_id = ${restaurantId}
      and p.paid_date between ${from}::date and ${to}::date
    order by p.paid_date desc, p.created_at desc`
}


/**
 * One measure, two windows, and what the gates need to judge them.
 *
 * `activeDays` counts DISTINCT DATES carrying an entry — not calendar days in
 * the window. Twenty-six active days against four is the difference between a
 * month somebody was entering and a month somebody was not, and calendar length
 * cannot see it: both windows are twenty-eight days long.
 */
export type ComparedSeries = {
  current: { date: string; total: string }[]
  baseline: { date: string; total: string }[]
  currentDays: number
  baselineDays: number
  /** the ALL-TIME first entry for this measure, or null if there is none */
  firstEntry: string | null
}

function splitWindows(
  rows: { date: string; total: string; window: string; first_entry: string | null }[],
): ComparedSeries {
  const current = rows.filter((r) => r.window === 'current').map(({ date, total }) => ({ date, total }))
  const baseline = rows.filter((r) => r.window === 'baseline').map(({ date, total }) => ({ date, total }))
  return {
    current,
    baseline,
    currentDays: current.length,
    baselineDays: baseline.length,
    firstEntry: rows[0]?.first_entry ?? null,
  }
}
