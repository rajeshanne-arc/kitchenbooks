// The owner's P&L, straight from pnl_monthly. Numbers arrive as the view
// computed them — cogs and staff_food are NULL until the month has ending
// closings (the pending-closing law lives in section_food_cost; the page
// says so instead of showing a confident wrong number).
import 'server-only'
import { sql } from '@/lib/db'
import type { PnlRow } from '@/lib/types'

export async function getPnlMonthly(restaurantId: string, limit = 13): Promise<PnlRow[]> {
  return sql<PnlRow[]>`
    select month::text as month,
           coalesce(revenue, 0)::text as revenue,
           coalesce(off_book_revenue, 0)::text as off_book_revenue,
           coalesce(other_income, 0)::text as other_income,
           cogs::text as cogs,
           staff_food::text as staff_food,
           coalesce(sections_pending_closing, 0)::int as sections_pending_closing,
           coalesce(giveaway_cost, 0)::text as giveaway_cost,
           coalesce(labour, 0)::text as labour,
           coalesce(expenses, 0)::text as expenses,
           coalesce(gross_margin, 0)::text as gross_margin,
           coalesce(net_before_purch_overheads, 0)::text as net_before_purch_overheads
    from pnl_monthly
    where restaurant_id = ${restaurantId}
    order by month desc
    limit ${limit}`
}
