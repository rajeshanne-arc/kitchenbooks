// Read side of sales. Every displayed number comes from the named views —
// sales_by_day (V22 ruling: comps are OUT of money, IN orders and covers,
// already encoded there — never re-derived), sales_current (latest fetch
// per date wins), unmapped_pos_items, sales_by_section. Unknown statuses
// are surfaced, never banked.
import 'server-only'
import { sql } from '@/lib/db'
import { todayIST } from '@/server/store-queries'
import type {
  DishOption,
  PosMapRow,
  QtySoldRow,
  SalesDayRow,
  UnknownOrderRow,
  UnmappedPosItem,
} from '@/lib/types'

/** Yesterday in IST — the default Fetch Day target: yesterday is complete,
 * today is still ringing up. */
export function yesterdayIST(): string {
  const d = new Date(`${todayIST()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const DAY_SELECT = `
  select d.business_date::text as business_date,
         coalesce(d.orders, 0)::int as orders,
         coalesce(d.covers, 0)::int as covers,
         coalesce(d.revenue, 0)::text as revenue,
         coalesce(d.cash_revenue, 0)::text as cash_revenue,
         coalesce(d.comps, 0)::int as comps,
         coalesce(d.comp_value, 0)::text as comp_value,
         coalesce(d.cancelled, 0)::int as cancelled,
         coalesce(d.unknown_status, 0)::int as unknown_status,
         f.n as fetch_count,
         f.last as last_fetched_at
  from sales_by_day d
  join lateral (
    select count(*)::int as n, max(pf.fetched_at)::text as last
    from pos_fetches pf
    where pf.restaurant_id = d.restaurant_id and pf.business_date = d.business_date
  ) f on true`

export async function getSalesDays(restaurantId: string, limit = 45): Promise<SalesDayRow[]> {
  return sql<SalesDayRow[]>`
    ${sql.unsafe(DAY_SELECT)}
    where d.restaurant_id = ${restaurantId}
    order by d.business_date desc
    limit ${limit}`
}

export async function getSalesDay(restaurantId: string, businessDate: string): Promise<SalesDayRow | null> {
  const rows = await sql<SalesDayRow[]>`
    ${sql.unsafe(DAY_SELECT)}
    where d.restaurant_id = ${restaurantId} and d.business_date = ${businessDate}`
  return rows[0] ?? null
}

/** Unknown-status orders, loud and listed — never silently banked. */
export async function listUnknownOrders(restaurantId: string, limit = 50): Promise<UnknownOrderRow[]> {
  return sql<UnknownOrderRow[]>`
    select business_date::text as business_date, pos_order_id, status_raw, channel,
           order_total::text as order_total
    from sales_current
    where restaurant_id = ${restaurantId} and status_class = 'unknown'
    order by business_date desc, pos_order_id desc
    limit ${limit}`
}

/** The mapping queue, biggest money first — the top rows are half the
 * revenue; map those and the sections view is already mostly true. */
export async function listUnmapped(restaurantId: string): Promise<UnmappedPosItem[]> {
  return sql<UnmappedPosItem[]>`
    select pos_item_id, item_name,
           coalesce(qty, 0)::text as qty,
           coalesce(revenue, 0)::text as revenue
    from unmapped_pos_items
    where restaurant_id = ${restaurantId}
    order by revenue desc nulls last, pos_item_id asc`
}

export async function listMappings(restaurantId: string): Promise<PosMapRow[]> {
  return sql<PosMapRow[]>`
    select m.id, m.pos_item_id, m.item_name, m.recipe_id,
           r.code as recipe_code, r.name as recipe_name, s.code as section_code
    from pos_item_map m
    left join recipes r on r.id = m.recipe_id
    left join sections s on s.id = r.section_id
    where m.restaurant_id = ${restaurantId}
    order by coalesce(m.item_name, m.pos_item_id) asc`
}

export async function countUnmapped(restaurantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from unmapped_pos_items where restaurant_id = ${restaurantId}`
  return rows[0]?.n ?? 0
}

/** Active dishes for the mapping picker — a POS item maps to a DISH; the
 * dish's section is how the money lands on the sections page. */
export async function listDishOptions(restaurantId: string): Promise<DishOption[]> {
  return sql<DishOption[]>`
    select r.id, r.code, r.name, s.code as section_code
    from recipes r
    join sections s on s.id = r.section_id
    where r.restaurant_id = ${restaurantId} and r.kind = 'dish' and r.status = 'active'
    order by s.sort_order asc, r.code asc`
}

/** Qty sold per recipe for one month, from mapped revenue lines of the
 * latest fetches. */
export async function getQtySold(restaurantId: string, monthStart: string): Promise<QtySoldRow[]> {
  return sql<QtySoldRow[]>`
    select m.recipe_id,
           coalesce(sum(pl.qty), 0)::text as qty_sold,
           coalesce(sum(pl.amount), 0)::text as sales_value
    from sales_current sc
    join pos_lines pl on pl.order_id = sc.id
    join pos_item_map m on m.restaurant_id = sc.restaurant_id and m.pos_item_id = pl.pos_item_id
    where sc.restaurant_id = ${restaurantId} and sc.status_class = 'revenue'
      and m.recipe_id is not null
      and date_trunc('month', sc.business_date)::date = ${monthStart}::date
    group by m.recipe_id`
}
