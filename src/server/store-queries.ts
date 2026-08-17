// Read side of the consumption spine. Every derived number comes from the
// named views: item_costs (issue_cost), stock_on_hand (quantities & values),
// section_consumption (monthly section totals). Event aggregates (an issue's
// own total) sum the stored generated `value` column — never recomputed.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type {
  ChecklistRow,
  IndentPrefill,
  IndentRow,
  IssuableItemHit,
  IssueDetail,
  IssueLineRow,
  ReorderRow,
  ReturnDetail,
  ReturnLineRow,
  Section,
  SectionConsumptionDay,
  SectionMonthRow,
  StockRow,
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

export async function listStock(restaurantId: string, q: string): Promise<StockRow[]> {
  const like = `%${q}%`
  return tsql<StockRow[]>`
    select s.item_id, s.code, s.name, c.name as category_name, s.purchase_unit, i.status,
           s.purchased_qty::text as purchased_qty,
           s.issued_qty::text as issued_qty,
           s.wasted_qty::text as wasted_qty,
           s.on_hand_qty::text as on_hand_qty,
           s.issue_cost::text as issue_cost,
           s.on_hand_value::text as on_hand_value
    from stock_on_hand s
    join items i on i.id = s.item_id
    join categories c on c.code = s.category
    where s.restaurant_id = ${restaurantId}
      and (s.name ilike ${like} or s.code ilike ${like})
    order by s.on_hand_value desc, s.code asc`
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

export async function listStoreLog(restaurantId: string, limit = 150): Promise<StoreLogRow[]> {
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
export async function getPurchaseSeries(
  restaurantId: string,
  from: string,
  to: string,
): Promise<{ date: string; total: string }[]> {
  return tsql<{ date: string; total: string }[]>`
    select bill_date::text as date, sum(bill_total)::text as total
    from purchases
    where restaurant_id = ${restaurantId} and bill_date between ${from}::date and ${to}::date
    group by bill_date
    having sum(bill_total) <> 0
    order by bill_date asc`
}

/** Issue value per section across the period — where the stock went. */
export async function getIssuesBySection(
  restaurantId: string,
  from: string,
  to: string,
): Promise<{ section: string; value: string }[]> {
  return tsql<{ section: string; value: string }[]>`
    select s.name as section, sum(l.value)::text as value
    from issue_lines l
    join issues i on i.id = l.issue_id
    join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId} and i.issue_date between ${from}::date and ${to}::date
    group by s.name, s.sort_order
    having sum(l.value) > 0
    order by sum(l.value) desc`
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
    order by sum(p.bill_total) desc
    limit 8`
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
           issue_cost::text as issue_cost
    from reorder_due
    where restaurant_id = ${restaurantId}
    order by usual_vendor nulls last, name asc`
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
