// The four reports found missing in the sheet sweep, plus the owner's
// activity log. Every one reads a view the migration already publishes —
// nothing here computes a figure the database has not already stated.
import 'server-only'
import { sql } from '@/lib/db'
import type {
  ActivityRow,
  CashHandoverRow,
  DailyPurchaseRow,
  GstServiceRow,
  SlowMovingRow,
} from '@/lib/types'

/** GST and service charge by day. Rajesh reconciles the effective rate
 *  against the expected 5% — his sheet runs ~4.9% — so effective_gst_pct is
 *  the column the report exists for. */
export async function getGstServiceByDay(
  restaurantId: string,
  from: string,
  to: string,
): Promise<GstServiceRow[]> {
  return sql<GstServiceRow[]>`
    select business_date::text as business_date,
           coalesce(food_bev, 0)::text as food_bev,
           coalesce(gst_collected, 0)::text as gst_collected,
           coalesce(service_charge, 0)::text as service_charge,
           coalesce(container, 0)::text as container,
           effective_gst_pct::text as effective_gst_pct
    from gst_service_by_day
    where restaurant_id = ${restaurantId}
      and business_date between ${from}::date and ${to}::date
    order by business_date desc`
}

/** Who took how much out of the drawer, by day. */
export async function getCashHandovers(
  restaurantId: string,
  from: string,
  to: string,
): Promise<CashHandoverRow[]> {
  return sql<CashHandoverRow[]>`
    select close_date::text as close_date, person, amount::text as amount
    from cash_handovers
    where restaurant_id = ${restaurantId}
      and close_date between ${from}::date and ${to}::date
    order by close_date desc, amount desc`
}

/** Cash tied up on the shelf: on hand, what it is worth, how long since
 *  anybody bought it. */
export async function getSlowMovingStock(restaurantId: string): Promise<SlowMovingRow[]> {
  return sql<SlowMovingRow[]>`
    select item_id, code, name, category,
           on_hand_qty::text as on_hand_qty, purchase_unit,
           on_hand_value::text as on_hand_value,
           last_bought::text as last_bought,
           days_since_bought
    from slow_moving_stock
    where restaurant_id = ${restaurantId}
    order by on_hand_value desc nulls last`
}

/** Spend by day, grouped by vendor. */
export async function getDailyPurchases(
  restaurantId: string,
  from: string,
  to: string,
): Promise<DailyPurchaseRow[]> {
  return sql<DailyPurchaseRow[]>`
    select bill_date::text as bill_date, vendor_name, vendor_code,
           bills::int as bills, spend::text as spend
    from daily_purchases
    where restaurant_id = ${restaurantId}
      and bill_date between ${from}::date and ${to}::date
    order by bill_date desc, spend desc`
}

/** The owner's activity log. Nothing new is recorded — entered_by and
 *  created_at already sat on every event table; this only reads them. */
export async function getActivityLog(
  restaurantId: string,
  opts: { from: string; to: string; person?: string; what?: string; limit?: number },
): Promise<ActivityRow[]> {
  const { from, to, person, what, limit = 300 } = opts
  return sql<ActivityRow[]>`
    select what, id, created_at::text as created_at, entered_by,
           on_date, amount::text as amount, is_reversal
    from activity_log
    where restaurant_id = ${restaurantId}
      and on_date between ${from} and ${to}
      and (${person ?? null}::text is null or entered_by = ${person ?? null})
      and (${what ?? null}::text is null or what = ${what ?? null})
    order by created_at desc
    limit ${limit}`
}

/** The distinct people and event types in the log — the filter options,
 *  taken from what actually happened rather than a hardcoded list. */
export async function getActivityFacets(
  restaurantId: string,
): Promise<{ people: string[]; kinds: string[] }> {
  const [people, kinds] = await Promise.all([
    sql<{ v: string }[]>`
      select distinct entered_by as v from activity_log
      where restaurant_id = ${restaurantId} and entered_by is not null order by 1`,
    sql<{ v: string }[]>`
      select distinct what as v from activity_log
      where restaurant_id = ${restaurantId} order by 1`,
  ])
  return { people: people.map((r) => r.v), kinds: kinds.map((r) => r.v) }
}
