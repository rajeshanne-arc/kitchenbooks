import 'server-only'
import { tsql } from '@/lib/db'
import type { DayEvidence, DaySummaryRow, SalesHourRow } from '@/lib/types'

// THE OWNER DAY SHEET — a flash report.
//
// `day_summary` is one row per business date and the range view of the same
// thing IS the owner dashboard: one control, two grains, no second query
// path. This file reads the row, the hour curve, the channel split, and the
// COUNTS that decide what may be said at all.
//
// ISSUED IS NOT CONSUMED. The view keeps them apart and so does the page. A
// kitchen draws 10 kg on Monday and cooks it over three days; true
// consumption is opening + issued − closing, and a closing exists only if the
// chef filed one that night. A daily food cost built on issues alone is noise
// wearing a percentage.

export async function getDaySummary(restaurantId: string, date: string): Promise<DaySummaryRow | null> {
  const rows = await tsql<DaySummaryRow[]>`
    select business_date::text as business_date,
           revenue::text as revenue, orders::int as orders, covers::int as covers,
           cash_revenue::text as cash_revenue, comps::int as comps, comp_value::text as comp_value,
           cancelled::int as cancelled, unknown_status::int as unknown_status,
           per_cover::text as per_cover, off_book::text as off_book, other_income::text as other_income,
           purchases::text as purchases, bills::int as bills,
           issued::text as issued, returned::text as returned, issued_net::text as issued_net,
           store_wastage::text as store_wastage, kitchen_wastage::text as kitchen_wastage,
           labour::text as labour, giveaway_cost::text as giveaway_cost,
           gst_collected::text as gst_collected, service_charge::text as service_charge,
           effective_gst_pct::text as effective_gst_pct,
           expected_cash::text as expected_cash, cash_counted::text as cash_counted,
           difference::text as difference, day_closed, sections_closed::int as sections_closed
    from day_summary
    where restaurant_id = ${restaurantId} and business_date = ${date}::date`
  return rows[0] ?? null
}

/**
 * WHAT MAY BE SAID AT ALL.
 *
 * `day_summary` coalesces most of its money columns to 0, so a day with no
 * bills entered reports ₹0 of purchases — indistinguishable from a day that
 * genuinely bought nothing, and a flash report is read fast by somebody who
 * believes a number. These counts are the difference, and every card on the
 * page declares which one it rests on.
 */
export async function getDayEvidence(restaurantId: string, date: string): Promise<DayEvidence> {
  const rows = await tsql<DayEvidence[]>`
    select
      (select count(*)::int from purchases
        where restaurant_id = ${restaurantId} and bill_date = ${date}::date) as bills,
      (select count(*)::int from issues
        where restaurant_id = ${restaurantId} and issue_date = ${date}::date) as issues,
      (select count(*)::int from wastage
        where restaurant_id = ${restaurantId} and waste_date = ${date}::date) as store_losses,
      (select count(*)::int from kitchen_wastage
        where restaurant_id = ${restaurantId} and waste_date = ${date}::date) as kitchen_losses,
      (select count(*)::int from attendance_current
        where restaurant_id = ${restaurantId} and att_date = ${date}::date) as marks,
      (select count(*)::int from staff
        where restaurant_id = ${restaurantId} and status = 'active') as roster,
      (select count(*)::int from staff
        where restaurant_id = ${restaurantId} and status = 'active'
          and employment_type <> 'contract' and base_salary is null) as no_salary,
      (select count(*)::int from sections
        where restaurant_id = ${restaurantId} and status = 'active'
          and dept_group in ('Kitchen', 'Bar')) as closable_sections,
      (select count(*)::int from pos_fetches
        where restaurant_id = ${restaurantId} and business_date = ${date}::date) as fetches`
  return rows[0]
}

/** Revenue by channel for one day — Zomato, Swiggy, the counter. */
export async function getDayChannels(
  restaurantId: string,
  date: string,
): Promise<{ channel: string; orders: number; revenue: string }[]> {
  return tsql<{ channel: string; orders: number; revenue: string }[]>`
    select coalesce(channel, '(not stated)') as channel,
           count(*)::int as orders,
           sum(order_total)::text as revenue
    from sales_current
    where restaurant_id = ${restaurantId} and business_date = ${date}::date
      and status_class = 'revenue'
    group by coalesce(channel, '(not stated)')
    order by sum(order_total) desc`
}

/** One day's hour curve. `per_cover` is NULL where covers is zero. */
export async function getDayHours(restaurantId: string, date: string): Promise<SalesHourRow[]> {
  return tsql<SalesHourRow[]>`
    select hour::int as hour, orders::int as orders, covers::int as covers,
           revenue::text as revenue, per_cover::text as per_cover
    from sales_by_hour
    where restaurant_id = ${restaurantId} and business_date = ${date}::date
    order by hour asc`
}

/** Wages for the day, per department, with the heads behind them. */
export async function getDayLabour(
  restaurantId: string,
  date: string,
): Promise<{ section_name: string | null; labour_cost: string; worked_heads: number; absent_heads: number; extra_hours: string }[]> {
  return tsql<
    { section_name: string | null; labour_cost: string; worked_heads: number; absent_heads: number; extra_hours: string }[]
  >`
    select section_name, labour_cost::text as labour_cost,
           worked_heads::int as worked_heads, absent_heads::int as absent_heads,
           coalesce(extra_hours, 0)::text as extra_hours
    from labour_cost_daily
    where restaurant_id = ${restaurantId} and att_date = ${date}::date
    order by labour_cost desc`
}

/** Every business date that has a day_summary row, newest first — the date
 *  list the sheet pages through. */
export async function listDayDates(restaurantId: string, limit = 60): Promise<string[]> {
  const rows = await tsql<{ d: string }[]>`
    select business_date::text as d from day_summary
    where restaurant_id = ${restaurantId}
    order by business_date desc
    limit ${limit}`
  return rows.map((r) => r.d)
}
