// Read side of stock adjustments and count acceptance.
//
// ACCEPTING A VARIANCE IS A JUDGEMENT, NOT A CONSEQUENCE. A count records
// what was on the shelf and changes nothing; a person decides the shelf was
// right and the book was wrong, and THAT writes stock_adjustments. So the
// two questions this file answers are "what has been corrected" and "which
// counts is nobody standing behind yet".
//
// Nothing here recomputes stock. stock_on_hand already adds adjustments and
// subtracts vendor returns; an adjustment row is the event, the view is the
// arithmetic.
import 'server-only'
import type postgres from 'postgres'
import { sql, tsql } from '@/lib/db'
import type { CountAcceptance, StockAdjustmentRow } from '@/lib/types'

/** A refusal the person at the keyboard is meant to read, as opposed to a
 *  fault. Lives here rather than in the actions file because the checks that
 *  raise it are shared, and a 'use server' file exports only actions. */
export class AdjustmentRefusal extends Error {}

/** The log, newest first. `value` is the GENERATED qty × unit_cost — read,
 *  never worked out here. */
export async function listAdjustments(restaurantId: string, limit = 100): Promise<StockAdjustmentRow[]> {
  return tsql<StockAdjustmentRow[]>`
    select a.id, a.adj_date::text as adj_date, a.item_id,
           i.code as item_code, i.name as item_name, i.purchase_unit,
           a.qty::text as qty, a.unit_cost::text as unit_cost, a.value::text as value,
           a.reason, a.count_id, a.note, a.entered_by
    from stock_adjustments a
    join items i on i.id = a.item_id
    where a.restaurant_id = ${restaurantId}
    order by a.adj_date desc, a.created_at desc
    limit ${limit}`
}

/** One row, for the read-back that verifies a save actually landed. */
export async function getAdjustment(restaurantId: string, id: string): Promise<StockAdjustmentRow | null> {
  const rows = await tsql<StockAdjustmentRow[]>`
    select a.id, a.adj_date::text as adj_date, a.item_id,
           i.code as item_code, i.name as item_name, i.purchase_unit,
           a.qty::text as qty, a.unit_cost::text as unit_cost, a.value::text as value,
           a.reason, a.count_id, a.note, a.entered_by
    from stock_adjustments a
    join items i on i.id = a.item_id
    where a.restaurant_id = ${restaurantId} and a.id = ${id}`
  return rows[0] ?? null
}

/** What one acceptance actually wrote — shown on the count itself, so the
 *  judgement and its consequences sit on the same screen. */
export async function listAdjustmentsForCount(
  restaurantId: string,
  countId: string,
): Promise<StockAdjustmentRow[]> {
  return tsql<StockAdjustmentRow[]>`
    select a.id, a.adj_date::text as adj_date, a.item_id,
           i.code as item_code, i.name as item_name, i.purchase_unit,
           a.qty::text as qty, a.unit_cost::text as unit_cost, a.value::text as value,
           a.reason, a.count_id, a.note, a.entered_by
    from stock_adjustments a
    join items i on i.id = a.item_id
    where a.restaurant_id = ${restaurantId} and a.count_id = ${countId}
    order by a.value asc, i.code asc`
}

const ACCEPTANCE_SELECT = `
  select c.id as count_id, c.count_date::text as count_date, c.entered_by,
         c.accepted_at::text as accepted_at, c.accepted_by,
         (select count(*)::int from stock_count_lines l where l.count_id = c.id) as lines,
         (select count(*)::int from stock_count_lines l
           where l.count_id = c.id and l.variance_qty <> 0) as variance_lines,
         (select coalesce(sum(l.variance_value), 0)::text from stock_count_lines l
           where l.count_id = c.id) as variance_value
  from stock_counts c`

/** Every count with its acceptance state, newest first. `variance_lines` is
 *  how many adjustments an acceptance would write — zero is a real answer
 *  and still needs accepting: it says the book was right. */
export async function listCountAcceptances(restaurantId: string, limit = 30): Promise<CountAcceptance[]> {
  return tsql<CountAcceptance[]>`
    ${sql.unsafe(ACCEPTANCE_SELECT)}
    where c.restaurant_id = ${restaurantId}
    order by c.count_date desc, c.created_at desc
    limit ${limit}`
}

export async function getCountAcceptance(restaurantId: string, countId: string): Promise<CountAcceptance | null> {
  const rows = await tsql<CountAcceptance[]>`
    ${sql.unsafe(ACCEPTANCE_SELECT)}
    where c.restaurant_id = ${restaurantId} and c.id = ${countId}`
  return rows[0] ?? null
}

/** The counts nobody has stood behind. Oldest first — the oldest unaccepted
 *  count is the one whose variance is about to reappear at the next count. */
export async function listUnacceptedCounts(restaurantId: string): Promise<CountAcceptance[]> {
  return tsql<CountAcceptance[]>`
    ${sql.unsafe(ACCEPTANCE_SELECT)}
    where c.restaurant_id = ${restaurantId} and c.accepted_at is null
    order by c.count_date asc, c.created_at asc`
}

/**
 * What a person is entitled to know BEFORE they accept this count.
 *
 * `prior` is how many counts came before it. 0 means this is the first the
 * restaurant has ever taken — the one that absorbs every bill that was never
 * entered, which is a different thing from finding theft.
 *
 * The other two are the DOUBLE-CORRECTION hazard, and they are the reason
 * this query exists at all. A count line freezes book_qty at count time, and
 * the adjustment it writes is a DIFFERENCE, not a new total. So:
 *   - two counts both taken while neither was accepted were measured against
 *     the same uncorrected book and both claim the same difference —
 *     accepting both takes it off the book twice;
 *   - a count whose book was frozen before somebody else's acceptance landed
 *     has already had part of its difference put right by that acceptance.
 * Either way the second acceptance is silent and reads like theft.
 *
 * It is STATED, never enforced. Refusing would strand the count: it could
 * never be accepted and would never stop being flagged as waiting. The
 * judgement stays with the person, which is the whole rule.
 */
export async function getAcceptanceContext(
  restaurantId: string,
  countId: string,
): Promise<{ prior: number; waiting: number; oldestWaiting: string | null; correctedSince: number }> {
  type Row = { prior: number; waiting: number; oldest_waiting: string | null; corrected_since: number }
  const rows = await tsql<Row[]>`
    select
      (select count(*)::int from stock_counts o
        where o.restaurant_id = c.restaurant_id
          and (o.count_date, o.created_at) < (c.count_date, c.created_at)) as prior,
      (select count(*)::int from stock_counts o
        where o.restaurant_id = c.restaurant_id and o.id <> c.id and o.accepted_at is null) as waiting,
      (select min(o.count_date)::text from stock_counts o
        where o.restaurant_id = c.restaurant_id and o.id <> c.id and o.accepted_at is null) as oldest_waiting,
      -- >= not >: an acceptance landing at the same instant the book here was
      -- frozen is ambiguous, and warning is the safe side of ambiguous.
      (select count(*)::int from stock_counts o
        where o.restaurant_id = c.restaurant_id and o.id <> c.id
          and o.accepted_at >= c.created_at) as corrected_since
    from stock_counts c
    where c.id = ${countId} and c.restaurant_id = ${restaurantId}`
  const r = rows[0]
  return {
    prior: r?.prior ?? 0,
    waiting: r?.waiting ?? 0,
    oldestWaiting: r?.oldest_waiting ?? null,
    correctedSince: r?.corrected_since ?? 0,
  }
}

/**
 * THE REFUSAL THAT PROTECTS OPENING STOCK.
 *
 * unit_cost is snapshotted server-side from item_costs.issue_cost — the
 * store never types a cost, here or anywhere. issue_cost is the weighted
 * average of what was actually bought, falling back to items.opening_rate,
 * and it is NULL for an item with neither. Adjusting such an item would
 * write stock in at ZERO and the books would start wrong, silently, which
 * is exactly the failure the opening-stock flow exists to prevent. So it is
 * refused by name, and the refusal says what to do about it.
 *
 * Takes the transaction rather than the pool: the cost must be read on the
 * same connection as the insert it feeds.
 */
export async function assertAdjustableItem(
  tx: postgres.TransactionSql,
  restaurantId: string,
  itemId: string,
): Promise<{ id: string; name: string; unitCost: string }> {
  const [item] = await tx<{ id: string; name: string; unit_cost: string | null }[]>`
    select i.id, i.name, ic.issue_cost::text as unit_cost
    from items i
    left join item_costs ic on ic.item_id = i.id
    where i.id = ${itemId} and i.restaurant_id = ${restaurantId} and i.status = 'active'`
  if (!item) throw new AdjustmentRefusal('That item does not exist, or has been retired')
  if (item.unit_cost === null) {
    throw new AdjustmentRefusal(
      `${item.name} has no cost yet — nothing has been bought and no opening rate is set. ` +
        'Set the opening rate on the item first, or this adjustment values the stock at zero.',
    )
  }
  return { id: item.id, name: item.name, unitCost: item.unit_cost }
}
