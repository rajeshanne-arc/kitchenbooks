// Read side of the consumption spine. Every derived number comes from the
// named views: item_costs (issue_cost), stock_on_hand (quantities & values),
// section_consumption (monthly section totals). Event aggregates (an issue's
// own total) sum the stored generated `value` column — never recomputed.
import 'server-only'
import { sql } from '@/lib/db'
import type {
  ChecklistRow,
  IndentPrefill,
  IndentRow,
  IssuableItemHit,
  IssueDetail,
  IssueLineRow,
  ReturnDetail,
  ReturnLineRow,
  Section,
  SectionMonthRow,
  StockRow,
  StockSnap,
  StoreLogRow,
  WastageDetail,
} from '@/lib/types'

/** Today's date in IST, YYYY-MM-DD — bookkeeping runs on kitchen time */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

/** First day of the current IST month, YYYY-MM-DD */
export function monthStartIST(): string {
  return `${todayIST().slice(0, 7)}-01`
}

export async function getSections(restaurantId: string): Promise<Section[]> {
  return sql<Section[]>`
    select id, code, name, sort_order, status, dept_group
    from sections
    where restaurant_id = ${restaurantId} and status = 'active'
    order by sort_order asc`
}

export async function searchIssuableItems(restaurantId: string, q: string): Promise<IssuableItemHit[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  return sql<IssuableItemHit[]>`
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
  return sql<StockRow[]>`
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
  const rows = await sql<{ total: string }[]>`
    select coalesce(sum(on_hand_value), 0)::text as total
    from stock_on_hand where restaurant_id = ${restaurantId}`
  return rows[0]?.total ?? '0'
}

export async function getSectionsWithMonth(restaurantId: string, monthStart: string): Promise<SectionMonthRow[]> {
  return sql<SectionMonthRow[]>`
    select s.id, s.code, s.name, s.sort_order, s.status,
           coalesce(sc.consumed_value, 0)::text as consumed_value
    from sections s
    left join section_consumption sc
      on sc.restaurant_id = s.restaurant_id and sc.section_code = s.code and sc.month = ${monthStart}::date
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    order by s.sort_order asc`
}

export async function getChecklist(restaurantId: string, dateStr: string): Promise<ChecklistRow[]> {
  return sql<ChecklistRow[]>`
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
  const rows = await sql<IssueDetail[]>`
    ${sql.unsafe(ISSUE_SELECT)}
    where i.restaurant_id = ${restaurantId} and i.id = ${id}`
  return rows[0] ?? null
}

export async function getIssueLines(issueId: string): Promise<IssueLineRow[]> {
  return sql<IssueLineRow[]>`
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
  const rows = await sql<ReturnDetail[]>`
    ${sql.unsafe(RETURN_SELECT)}
    where r.restaurant_id = ${restaurantId} and r.id = ${id}`
  return rows[0] ?? null
}

export async function getReturnLines(returnId: string): Promise<ReturnLineRow[]> {
  return sql<ReturnLineRow[]>`
    select rl.id, rl.item_id, it.code as item_code, it.name as item_name, it.purchase_unit,
           rl.qty::text as qty, rl.unit_cost::text as unit_cost, rl.value::text as value
    from return_lines rl
    join items it on it.id = rl.item_id
    where rl.return_id = ${returnId}
    order by it.code asc, rl.id asc`
}

export async function getIssueVoidedBy(issueId: string): Promise<{ id: string } | null> {
  const rows = await sql<{ id: string }[]>`select id from issues where reverses_id = ${issueId} limit 1`
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
  const rows = await sql<WastageDetail[]>`
    ${sql.unsafe(WASTAGE_SELECT)}
    where w.restaurant_id = ${restaurantId} and w.id = ${id}`
  return rows[0] ?? null
}

export async function getWastageVoidedBy(wastageId: string): Promise<{ id: string } | null> {
  const rows = await sql<{ id: string }[]>`select id from wastage where reverses_id = ${wastageId} limit 1`
  return rows[0] ?? null
}

export async function listStoreLog(restaurantId: string, limit = 150): Promise<StoreLogRow[]> {
  const issues = await sql<
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
  const waste = await sql<
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

export async function countOpenIndents(restaurantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from open_indents where restaurant_id = ${restaurantId}`
  return rows[0]?.n ?? 0
}

export async function listOpenIndents(restaurantId: string, sectionId?: string): Promise<IndentRow[]> {
  return sql<IndentRow[]>`
    select i.id, i.indent_date::text as indent_date, i.section_id,
           s.code as section_code, s.name as section_name, i.status, i.note,
           i.entered_by, i.created_at::text as created_at,
           (select count(*)::int from indent_lines l where l.indent_id = i.id) as line_count
    from indents i join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId} and i.status = 'open'
      ${sectionId ? sql`and i.section_id = ${sectionId}` : sql``}
    order by i.indent_date desc, i.created_at desc
    limit 30`
}

/** One open indent with its lines joined to live stock/cost — ready to
 * drop into the issue form. Items retired or costless since the indent
 * still appear (has_cost false) so the store sees the full ask. */
export async function getIndentPrefill(restaurantId: string, indentId: string): Promise<IndentPrefill | null> {
  const rows = await sql<
    (Omit<IndentPrefill, 'lines'> & { status: string })[]
  >`
    select i.id, i.indent_date::text as indent_date, i.section_id,
           s.code as section_code, s.name as section_name, i.note, i.status
    from indents i join sections s on s.id = i.section_id
    where i.restaurant_id = ${restaurantId} and i.id = ${indentId}`
  const head = rows[0]
  if (!head) return null
  const lines = await sql<(IssuableItemHit & { qty: string })[]>`
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
    section_id: head.section_id,
    section_code: head.section_code,
    section_name: head.section_name,
    note: head.note,
    lines: lines.map(({ qty, ...item }) => ({ item, qty })),
  }
}

export async function getStockSnaps(restaurantId: string, itemIds: string[]): Promise<StockSnap[]> {
  if (itemIds.length === 0) return []
  return sql<StockSnap[]>`
    select s.item_id, s.code, s.name, s.purchase_unit,
           s.on_hand_qty::text as on_hand_qty, s.on_hand_value::text as on_hand_value
    from stock_on_hand s
    where s.restaurant_id = ${restaurantId} and s.item_id = any(${itemIds})
    order by s.code asc`
}
