// Read side of stock counts and dish-cost photographs. Variances come from
// the count_variances view over numbers that were FROZEN at count time —
// nothing here recomputes them against today's stock. The first-count
// warning is COMPUTED from real issue history, never asserted.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type { CountableItem, CountHeader, CountVarianceRow, SnapshotGroup, SnapshotRow } from '@/lib/types'
import { businessToday } from '@/server/business-day'

/** Days of consumption history behind the book stock: today minus the first
 * live (non-voided) issue, inclusive. 0 when nothing has ever been issued.
 * Under 14, a count mostly measures missing bills — warn, never block. */
export async function getIssueHistoryDays(restaurantId: string): Promise<number> {
  const rows = await tsql<{ days: number | null }[]>`
    select (${await businessToday()}::date - min(i.issue_date) + 1)::int as days
    from issues i
    where i.restaurant_id = ${restaurantId}
      and i.reverses_id is null
      and not exists (select 1 from issues r where r.reverses_id = i.id)`
  return rows[0]?.days ?? 0
}

/**
 * Every active item IN WALKING ORDER — storage location first, and value
 * within each location.
 *
 * THIS SUPERSEDES `on_hand_value desc`, which was a deliberate ruling and is
 * recorded as one in AGENTS.md, so the argument matters. That ordering was
 * doing TWO jobs: saying which items matter most, and setting the order of
 * the walk. It was good at the first and actively bad at the second — value
 * order sends a counter back and forth across the store, and a count that is
 * exhausting is a count that stops happening.
 *
 * `stock_abc` now does the first job better, because importance belongs in
 * the SCHEDULE (A weekly, B fortnightly, C monthly) rather than in the row
 * order. That frees the row order to be the walk. Value still orders within a
 * location, where it costs no extra steps.
 *
 * Items with NO location sort LAST and the sheet says so loudly: on a physical
 * walk they are the ones that get missed.
 *
 * Book quantities are still absent by construction — the count is blind and
 * `CountableItem` does not carry one.
 */
export async function listCountableItems(
  restaurantId: string,
  // OPTIONAL HANDLE so a caller inside a transaction can lend its own — the
  // getClosePrefill shape. It is what lets a gate place items, run THIS
  // function, and roll back, instead of testing a hand-written copy of it.
  db: typeof tsql = tsql,
): Promise<CountableItem[]> {
  return db<CountableItem[]>`
    select i.id, i.code, i.name, i.purchase_unit, u.name as unit_name, c.name as category_name,
           i.storage_location_id as location_id,
           l.name as location_name, l.kind as location_kind,
           l.sort_order as location_order,
           a.abc
    from items i
    join units u on u.code = i.purchase_unit
    join categories c on c.code = i.category
    left join storage_locations l
      on l.id = i.storage_location_id and l.restaurant_id = ${restaurantId}
    left join stock_on_hand s on s.item_id = i.id and s.restaurant_id = ${restaurantId}
    left join stock_abc a on a.item_id = i.id and a.restaurant_id = ${restaurantId}
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
    order by l.sort_order asc nulls last, l.name asc nulls last,
             s.on_hand_value desc nulls last, i.code asc`
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

/**
 * A COUNT IN PROGRESS, and what each room still owes.
 *
 * The sheet already walks by storage location, so two people counting two
 * rooms is a FILTER and an ATTRIBUTION rather than a new screen. This is the
 * other half: what has been covered, by whom, and what has not been started.
 *
 * "NOT STARTED" AND "NOTHING TO COUNT" ARE DIFFERENT FACTS, and the count is
 * only complete when every location that HOLDS SOMETHING is covered. A room
 * with no stock in it needs nobody to walk it; a room with stock and no lines
 * is the reason a count is not finished. Items nobody has placed are their own
 * row, because on a physical walk they are exactly what gets missed.
 */
export async function getCountProgress(
  restaurantId: string,
  countId: string,
  // OPTIONAL HANDLE, the getClosePrefill shape — so a gate can build a
  // fixture, run THIS query against it and roll back, rather than asserting
  // against a hand-written copy that cannot test the real one.
  db: typeof tsql = tsql,
): Promise<{
  location_id: string | null
  location_name: string
  items: number
  counted: number
  counters: string | null
}[]> {
  return db<{
    location_id: string | null
    location_name: string
    items: number
    counted: number
    counters: string | null
  }[]>`
    select i.storage_location_id as location_id,
           coalesce(l.name, 'Not placed yet') as location_name,
           count(*)::int as items,
           count(scl.id)::int as counted,
           nullif(string_agg(distinct scl.counted_by, ', '), '') as counters
    from items i
    left join storage_locations l
      on l.restaurant_id = i.restaurant_id and l.id = i.storage_location_id
    left join stock_count_lines scl
      on scl.restaurant_id = i.restaurant_id and scl.item_id = i.id and scl.count_id = ${countId}
    where i.restaurant_id = ${restaurantId} and i.status = 'active'
    group by i.storage_location_id, l.name, l.sort_order
    -- WALKING ORDER, the same as the sheet. Unplaced items sink to the bottom
    -- and are named there rather than hidden.
    order by (i.storage_location_id is null) asc, l.sort_order asc nulls last, l.name asc`
}

/** The count somebody else may still be adding to: the most recent one for
 *  today that nobody has accepted. Null when there is none, which is the
 *  ordinary state and means the next save starts one. */
export async function getOpenCount(
  restaurantId: string,
  countDate: string,
): Promise<{ id: string; count_date: string; entered_by: string | null; lines: number } | null> {
  const rows = await tsql<{ id: string; count_date: string; entered_by: string | null; lines: number }[]>`
    select c.id, c.count_date::text as count_date, c.entered_by,
           (select count(*)::int from stock_count_lines l where l.count_id = c.id) as lines
    from stock_counts c
    where c.restaurant_id = ${restaurantId}
      and c.count_date = ${countDate}::date
      and c.accepted_at is null
    order by c.created_at desc
    limit 1`
  return rows[0] ?? null
}
