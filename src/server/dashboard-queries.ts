// The owner's ten questions, every answer from a named view, every card
// able to point at its source. Nothing here recomputes what a view already
// states; nulls stay null so honesty pills render instead of zeros.
import 'server-only'
import { sql } from '@/lib/db'
import { getSalesDay, yesterdayIST } from '@/server/sales-queries'
import type { SalesDayRow } from '@/lib/types'

export type YesterdayCard = {
  date: string
  sales: SalesDayRow | null
  difference: string | null // day_close_ladder; null = not closed
}

export async function getYesterday(restaurantId: string): Promise<YesterdayCard> {
  const date = yesterdayIST()
  const sales = await getSalesDay(restaurantId, date)
  const diff = await sql<{ difference: string }[]>`
    select difference::text as difference from day_close_ladder
    where restaurant_id = ${restaurantId} and close_date = ${date}::date`
  return { date, sales, difference: diff[0]?.difference ?? null }
}

export type OwedCard = {
  vendorTotal: string
  vendors: { name: string; balance: string }[]
  owners: { person: string; balance: string }[]
}

export async function getOwed(restaurantId: string): Promise<OwedCard> {
  const vendors = await sql<{ name: string; balance: string }[]>`
    select v.name, d.balance::text as balance
    from vendor_dues d
    join vendors v on v.id = d.vendor_id
    where v.restaurant_id = ${restaurantId} and d.balance <> 0
    order by d.balance desc
    limit 5`
  const [tot] = await sql<{ total: string }[]>`
    select coalesce(sum(d.balance), 0)::text as total
    from vendor_dues d
    join vendors v on v.id = d.vendor_id
    where v.restaurant_id = ${restaurantId}`
  const owners = await sql<{ person: string; balance: string }[]>`
    select person, balance::text as balance
    from owners_owed
    where restaurant_id = ${restaurantId} and balance <> 0
    order by balance desc`
  return { vendorTotal: tot?.total ?? '0', vendors, owners }
}

export type UnmappedCard = { items: number; revenue: string }

export async function getUnmappedSummary(restaurantId: string): Promise<UnmappedCard> {
  const [row] = await sql<{ items: number; revenue: string }[]>`
    select count(*)::int as items, coalesce(sum(revenue), 0)::text as revenue
    from unmapped_pos_items
    where restaurant_id = ${restaurantId}`
  return row ?? { items: 0, revenue: '0' }
}

export type WasteCard = {
  storeValue: string
  kitchenValue: string
  reasons: { reason: string; value: string }[]
}

/** Store + kitchen waste for one month; reversal pairs net themselves out
 * of the sums. Top reasons across both logs. */
export async function getWasteMonth(restaurantId: string, monthStart: string): Promise<WasteCard> {
  const [store] = await sql<{ v: string }[]>`
    select coalesce(sum(value), 0)::text as v from wastage
    where restaurant_id = ${restaurantId} and date_trunc('month', waste_date)::date = ${monthStart}::date`
  const [kitchen] = await sql<{ v: string }[]>`
    select coalesce(sum(value), 0)::text as v from kitchen_wastage
    where restaurant_id = ${restaurantId} and date_trunc('month', waste_date)::date = ${monthStart}::date`
  const reasons = await sql<{ reason: string; value: string }[]>`
    select reason, sum(value)::text as value from (
      select reason, value from wastage
      where restaurant_id = ${restaurantId} and date_trunc('month', waste_date)::date = ${monthStart}::date
      union all
      select reason, value from kitchen_wastage
      where restaurant_id = ${restaurantId} and date_trunc('month', waste_date)::date = ${monthStart}::date
    ) w
    where reason <> 'void'
    group by reason
    having sum(value) <> 0
    order by sum(value) desc
    limit 5`
  return { storeValue: store?.v ?? '0', kitchenValue: kitchen?.v ?? '0', reasons }
}

export type StockAlarmRow = { code: string; name: string; on_hand_qty: string; purchase_unit: string }

export async function getStockAlarms(restaurantId: string): Promise<StockAlarmRow[]> {
  return sql<StockAlarmRow[]>`
    select code, name, on_hand_qty::text as on_hand_qty, purchase_unit
    from stock_on_hand
    where restaurant_id = ${restaurantId} and on_hand_qty < 0
    order by on_hand_qty asc`
}

export async function getUnknownStatusCount(restaurantId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from sales_current
    where restaurant_id = ${restaurantId} and status_class = 'unknown'`
  return row?.n ?? 0
}

export async function getMissingCloses(restaurantId: string, limit = 14): Promise<string[]> {
  const rows = await sql<{ business_date: string }[]>`
    select business_date::text as business_date from missing_closes
    where restaurant_id = ${restaurantId}
    order by business_date desc
    limit ${limit}`
  return rows.map((r) => r.business_date)
}

export type StaffCard = {
  activeStaff: number
  unassigned: number
  markedToday: number
  markable: number
}

export async function getStaffCard(restaurantId: string, today: string): Promise<StaffCard> {
  const [row] = await sql<StaffCard[]>`
    select
      (select count(*)::int from staff where restaurant_id = ${restaurantId} and status = 'active') as "activeStaff",
      (select count(*)::int from staff
        where restaurant_id = ${restaurantId} and status = 'active' and section_id is null) as "unassigned",
      (select count(distinct ac.staff_id)::int
         from attendance_current ac
         join staff st on st.id = ac.staff_id
        where st.restaurant_id = ${restaurantId} and st.status = 'active'
          and ac.att_date = ${today}::date) as "markedToday",
      (select count(*)::int from staff
        where restaurant_id = ${restaurantId} and status = 'active') as "markable"`
  return row ?? { activeStaff: 0, unassigned: 0, markedToday: 0, markable: 0 }
}
