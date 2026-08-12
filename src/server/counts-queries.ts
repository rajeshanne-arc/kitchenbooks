// Read side of stock counts and dish-cost photographs. Variances come from
// the count_variances view over numbers that were FROZEN at count time —
// nothing here recomputes them against today's stock. The first-count
// warning is COMPUTED from real issue history, never asserted.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import { todayIST } from '@/server/store-queries'
import type { CountableItem, CountHeader, CountVarianceRow, SnapshotGroup, SnapshotRow } from '@/lib/types'

/** Days of consumption history behind the book stock: today minus the first
 * live (non-voided) issue, inclusive. 0 when nothing has ever been issued.
 * Under 14, a count mostly measures missing bills — warn, never block. */
export async function getIssueHistoryDays(restaurantId: string): Promise<number> {
  const rows = await tsql<{ days: number | null }[]>`
    select (${todayIST()}::date - min(i.issue_date) + 1)::int as days
    from issues i
    where i.restaurant_id = ${restaurantId}
      and i.reverses_id is null
      and not exists (select 1 from issues r where r.reverses_id = i.id)`
  return rows[0]?.days ?? 0
}

/** Every active item in stock order (value desc, like the stock page) — the
 * counter walks the store richest shelf first. Book quantities are not
 * shown; the count is blind and the variance appears after the save. */
export async function listCountableItems(restaurantId: string): Promise<CountableItem[]> {
  return tsql<CountableItem[]>`
    select i.id, i.code, i.name, i.purchase_unit, u.name as unit_name, c.name as category_name
    from items i
    join units u on u.code = i.purchase_unit
    join categories c on c.code = i.category
    left join stock_on_hand s on s.item_id = i.id
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
    order by s.on_hand_value desc nulls last, i.code asc`
}

const HEADER_SELECT = `
  select c.id, c.count_date::text as count_date, c.note, c.created_at::text as created_at,
         (select count(*)::int from stock_count_lines l where l.count_id = c.id) as line_count,
         (select coalesce(sum(l.variance_value), 0)::text from stock_count_lines l where l.count_id = c.id)
           as total_variance_value
  from stock_counts c`

export async function listCounts(restaurantId: string, limit = 30): Promise<CountHeader[]> {
  return tsql<CountHeader[]>`
    ${sql.unsafe(HEADER_SELECT)}
    where c.restaurant_id = ${restaurantId}
    order by c.count_date desc, c.created_at desc
    limit ${limit}`
}

export async function getCount(restaurantId: string, id: string): Promise<CountHeader | null> {
  const rows = await tsql<CountHeader[]>`
    ${sql.unsafe(HEADER_SELECT)}
    where c.restaurant_id = ${restaurantId} and c.id = ${id}`
  return rows[0] ?? null
}

/** Variances for one count, worst shortage first — negative is loud. Reads
 * the STORED generated columns (the same values count_variances wraps, plus
 * item_id which the view omits) — never a recomputation. */
export async function getCountVariances(restaurantId: string, countId: string): Promise<CountVarianceRow[]> {
  return tsql<CountVarianceRow[]>`
    select l.item_id, i.code, i.name, i.purchase_unit,
           l.counted_qty::text as counted_qty,
           l.book_qty::text as book_qty,
           l.unit_cost::text as unit_cost,
           l.variance_qty::text as variance_qty,
           l.variance_value::text as variance_value
    from stock_count_lines l
    join stock_counts c on c.id = l.count_id
    join items i on i.id = l.item_id
    where c.restaurant_id = ${restaurantId} and l.count_id = ${countId}
    order by l.variance_value asc, i.code asc`
}

// ---------------------------------------------------------------- snapshots

export async function listSnapshots(restaurantId: string): Promise<SnapshotGroup[]> {
  return tsql<SnapshotGroup[]>`
    select snap_date::text as snap_date, count(*)::int as dishes, max(created_at)::text as created_at
    from dish_cost_snapshots
    where restaurant_id = ${restaurantId}
    group by snap_date
    order by snap_date desc
    limit 36`
}

export async function getSnapshot(restaurantId: string, snapDate: string): Promise<SnapshotRow[]> {
  return tsql<SnapshotRow[]>`
    select code, name, section_code, dish_cost::text as dish_cost,
           selling_price::text as selling_price, food_cost_pct::text as food_cost_pct
    from dish_cost_snapshots
    where restaurant_id = ${restaurantId} and snap_date = ${snapDate}
    order by section_code asc, code asc`
}
