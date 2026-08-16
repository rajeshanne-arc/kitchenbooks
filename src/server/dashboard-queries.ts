// The owner's ten questions, every answer from a named view, every card
// able to point at its source. Nothing here recomputes what a view already
// states; nulls stay null so honesty pills render instead of zeros.
import 'server-only'
import { tsql } from '@/lib/db'
import { getSalesDay } from '@/server/sales-queries'
import type {
  EntryPulse,
  SalesDayRow,
  SalesSeriesPoint,
  SectionCostRangeRow,
  SettlementGapRow,
} from '@/lib/types'
import { businessYesterday } from '@/server/business-day'

export type YesterdayCard = {
  date: string
  sales: SalesDayRow | null
  difference: string | null // day_close_ladder; null = not closed
}

export async function getYesterday(restaurantId: string): Promise<YesterdayCard> {
  const date = await businessYesterday()
  const sales = await getSalesDay(restaurantId, date)
  const diff = await tsql<{ difference: string }[]>`
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
  const vendors = await tsql<{ name: string; balance: string }[]>`
    select v.name, d.balance::text as balance
    from vendor_dues d
    join vendors v on v.id = d.vendor_id
    where v.restaurant_id = ${restaurantId} and d.balance <> 0
    order by d.balance desc
    limit 5`
  const [tot] = await tsql<{ total: string }[]>`
    select coalesce(sum(d.balance), 0)::text as total
    from vendor_dues d
    join vendors v on v.id = d.vendor_id
    where v.restaurant_id = ${restaurantId}`
  const owners = await tsql<{ person: string; balance: string }[]>`
    select person, balance::text as balance
    from owners_owed
    where restaurant_id = ${restaurantId} and balance <> 0
    order by balance desc`
  return { vendorTotal: tot?.total ?? '0', vendors, owners }
}

export type UnmappedCard = { items: number; revenue: string }

// THE PERIOD IS ONE PERIOD. These three were unscoped while the cards that
// read them gained period-scoped preconditions — so a card would refuse to
// reassure about a month it had no fetch for and still ALARM about rows from
// outside it. Viewing "last month" listed July's unclosed days. Shrugging
// about the wrong period is defensible; alarming about it is not.
export async function getUnmappedSummary(
  restaurantId: string,
  from: string,
  to: string,
): Promise<UnmappedCard> {
  // NOT `unmapped_pos_items`, and this is why: that view groups per item
  // across ALL time and carries no date, so the period filter this card needs
  // named a column that has never existed. /owner and /sales both 500'd on
  // every load for five days.
  //
  // The dashboard has ONE period control and every card must answer for it —
  // an all-time figure sitting among period-scoped ones is a different lie
  // from a crash. So the summary reads the view's own base relations with the
  // date filter added, mirroring its WHERE exactly. The tidy fix is a view
  // that carries business_date; until that migration exists the duplication
  // is stated here rather than hidden.
  const [row] = await tsql<{ items: number; revenue: string }[]>`
    select count(*)::int as items, coalesce(sum(t.revenue), 0)::text as revenue
    from (
      select pl.pos_item_id, sum(pl.amount) as revenue
      from sales_current sc
      join pos_lines pl on pl.order_id = sc.id
      left join pos_item_map m
        on m.restaurant_id = sc.restaurant_id and m.pos_item_id = pl.pos_item_id
      where sc.restaurant_id = ${restaurantId}
        and sc.business_date between ${from}::date and ${to}::date
        and sc.status_class = 'revenue'
        and m.recipe_id is null
      group by pl.pos_item_id
    ) t`
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
  const [store] = await tsql<{ v: string }[]>`
    select coalesce(sum(value), 0)::text as v from wastage
    where restaurant_id = ${restaurantId} and date_trunc('month', waste_date)::date = ${monthStart}::date`
  const [kitchen] = await tsql<{ v: string }[]>`
    select coalesce(sum(value), 0)::text as v from kitchen_wastage
    where restaurant_id = ${restaurantId} and date_trunc('month', waste_date)::date = ${monthStart}::date`
  const reasons = await tsql<{ reason: string; value: string }[]>`
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
  return tsql<StockAlarmRow[]>`
    select code, name, on_hand_qty::text as on_hand_qty, purchase_unit
    from stock_on_hand
    where restaurant_id = ${restaurantId} and on_hand_qty < 0
    order by on_hand_qty asc`
}

export async function getUnknownStatusCount(
  restaurantId: string,
  from: string,
  to: string,
): Promise<number> {
  const [row] = await tsql<{ n: number }[]>`
    select count(*)::int as n from sales_current
    where restaurant_id = ${restaurantId} and status_class = 'unknown'
      and business_date between ${from}::date and ${to}::date`
  return row?.n ?? 0
}

export async function getMissingCloses(
  restaurantId: string,
  from: string,
  to: string,
  limit = 14,
): Promise<string[]> {
  const rows = await tsql<{ business_date: string }[]>`
    select business_date::text as business_date from missing_closes
    where restaurant_id = ${restaurantId}
      and business_date between ${from}::date and ${to}::date
    order by business_date desc
    limit ${limit}`
  return rows.map((r) => r.business_date)
}

// ─────────────────────────── period-scoped reads ───────────────────────────
// Everything below takes the ONE period the control resolved. Event tables
// filter on the date range; the monthly views are read per month-start and
// summed, so a three-month period never blends a percentage.

/** Daily revenue across the period — the sales line. Days with no fetch are
 * simply absent: a missing day is not a zero-rupee day, and drawing it as
 * one would invent a collapse that did not happen. */
export async function getSalesSeries(
  restaurantId: string,
  from: string,
  to: string,
): Promise<SalesSeriesPoint[]> {
  return tsql<SalesSeriesPoint[]>`
    select business_date::text as date, revenue::text as revenue, orders, covers
    from sales_by_day
    where restaurant_id = ${restaurantId}
      and business_date between ${from}::date and ${to}::date
    order by business_date asc`
}

/** The aggregator gap: what we billed against what they admit to.
 *
 * gap is a GENERATED column (billed_by_us − claimed_by_them), so a positive
 * gap is money we say we earned and they have not accepted. The agreed rate
 * comes off the partners master; the effective rate is what they actually
 * deducted. Both are stated — the card never picks one and calls it truth.
 *
 * Rows with nothing to compare (billed or claimed still null) are counted
 * separately rather than silently treated as zero. */
export async function getSettlementGap(
  restaurantId: string,
  from: string,
  to: string,
): Promise<SettlementGapRow[]> {
  return tsql<SettlementGapRow[]>`
    select ps.partner,
           coalesce(sum(ps.billed_by_us), 0)::text as billed,
           coalesce(sum(ps.claimed_by_them), 0)::text as claimed,
           coalesce(sum(ps.gap), 0)::text as gap,
           coalesce(sum(ps.gross_sales), 0)::text as gross_sales,
           coalesce(sum(ps.commission), 0)::text as commission,
           coalesce(sum(ps.amount_received), 0)::text as received,
           max(p.agreed_commission_pct)::text as agreed_pct,
           count(*) filter (where ps.billed_by_us is null or ps.claimed_by_them is null)::int as uncompared,
           count(*)::int as settlements
    from partner_settlements ps
    left join partners p
      on p.restaurant_id = ps.restaurant_id
     and lower(trim(p.name)) = lower(trim(ps.partner))
    where ps.restaurant_id = ${restaurantId}
      and ps.period_start >= ${from}::date
      and ps.period_end <= ${to}::date
    group by ps.partner
    having count(*) > 0
    order by coalesce(sum(ps.gap), 0) desc, ps.partner asc`
}

/** Store + kitchen waste across the period, by reason. Reversal pairs net
 * themselves out of the sums. */
export async function getWasteRange(restaurantId: string, from: string, to: string): Promise<WasteCard> {
  const [store] = await tsql<{ v: string }[]>`
    select coalesce(sum(value), 0)::text as v from wastage
    where restaurant_id = ${restaurantId} and waste_date between ${from}::date and ${to}::date`
  const [kitchen] = await tsql<{ v: string }[]>`
    select coalesce(sum(value), 0)::text as v from kitchen_wastage
    where restaurant_id = ${restaurantId} and waste_date between ${from}::date and ${to}::date`
  const reasons = await tsql<{ reason: string; value: string }[]>`
    select reason, sum(value)::text as value from (
      select reason, value from wastage
      where restaurant_id = ${restaurantId} and waste_date between ${from}::date and ${to}::date
      union all
      select reason, value from kitchen_wastage
      where restaurant_id = ${restaurantId} and waste_date between ${from}::date and ${to}::date
    ) w
    where reason <> 'void'
    group by reason
    having sum(value) > 0
    order by sum(value) desc
    limit 6`
  return { storeValue: store?.v ?? '0', kitchenValue: kitchen?.v ?? '0', reasons }
}

/** section_costs summed over every month the period touches. Sales, cost and
 * margin are additive, so summing them is arithmetic on what the view already
 * stated — not a second implementation of its logic. */
export async function getSectionCostsRange(
  restaurantId: string,
  months: string[],
): Promise<SectionCostRangeRow[]> {
  return tsql<SectionCostRangeRow[]>`
    select s.code as section_code, s.name as section_name, s.dept_group,
           coalesce(sum(sc.total_cost), 0)::text as total_cost,
           coalesce(sum(sc.sales), 0)::text as sales,
           coalesce(sum(sc.margin), 0)::text as margin
    from sections s
    left join section_costs sc
      on sc.restaurant_id = s.restaurant_id
     and sc.section_code = s.code
     and sc.month = any(${months}::date[])
    where s.restaurant_id = ${restaurantId} and s.status = 'active'
    group by s.code, s.name, s.dept_group, s.sort_order
    having coalesce(sum(sc.sales), 0) <> 0 or coalesce(sum(sc.total_cost), 0) <> 0
    order by array_position(array['Management','Support','Kitchen','Service','Bar'], s.dept_group) asc,
             s.sort_order asc`
}

/** What has actually been entered in the period. This is what makes an empty
 * dashboard honest: with two bills and no sales the page must say so plainly
 * rather than draw nine zeroes and imply a catastrophic month. */
export async function getEntryPulse(restaurantId: string, from: string, to: string): Promise<EntryPulse> {
  const [row] = await tsql<EntryPulse[]>`
    select
      (select count(*)::int from purchases
        where restaurant_id = ${restaurantId} and bill_date between ${from}::date and ${to}::date
          and reverses_id is null) as bills,
      (select count(*)::int from issues
        where restaurant_id = ${restaurantId} and issue_date between ${from}::date and ${to}::date
          and reverses_id is null) as issues,
      (select count(*)::int from sales_by_day
        where restaurant_id = ${restaurantId} and business_date between ${from}::date and ${to}::date) as "salesDays",
      (select count(*)::int from day_close_current
        where restaurant_id = ${restaurantId} and close_date between ${from}::date and ${to}::date) as closes,
      (select count(*)::int from kitchen_closing_current
        where restaurant_id = ${restaurantId} and close_date between ${from}::date and ${to}::date) as "kitchenClosings",
      (select count(*)::int from expenses
        where restaurant_id = ${restaurantId} and expense_date between ${from}::date and ${to}::date
          and reverses_id is null) as expenses`
  return row ?? { bills: 0, issues: 0, salesDays: 0, closes: 0, kitchenClosings: 0, expenses: 0 }
}

export type StaffCard = {
  activeStaff: number
  unassigned: number
  markedToday: number
  markable: number
}

export async function getStaffCard(restaurantId: string, today: string): Promise<StaffCard> {
  const [row] = await tsql<StaffCard[]>`
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
