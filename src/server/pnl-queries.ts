// The owner's P&L, straight from pnl_monthly. Numbers arrive as the view
// computed them — cogs stays NULL (never zero) until the month has ending
// closings, and pnl_diagnostics states in words what is still missing.
//
// The column names here are the view's CURRENT names. They were renamed in
// the schema (revenue -> food_beverage/net_sales, labour -> total_labour,
// expenses -> total_expenses) and this file kept selecting the old ones, so
// /owner/pnl answered 500 on every load. Read the view before editing.
import 'server-only'
import { sql } from '@/lib/db'
import type { PnlDiagnostic, PnlRow } from '@/lib/types'

export async function getPnlMonthly(restaurantId: string, limit = 13): Promise<PnlRow[]> {
  return sql<PnlRow[]>`
    select month::text as month,
           coalesce(food_beverage, 0)::text as food_beverage,
           coalesce(off_book, 0)::text as off_book,
           coalesce(net_sales, 0)::text as net_sales,
           opening_store::text as opening_store,
           opening_kitchen::text as opening_kitchen,
           coalesce(purchases, 0)::text as purchases,
           closing_store::text as closing_store,
           closing_kitchen::text as closing_kitchen,
           cogs::text as cogs,
           staff_food::text as staff_food,
           coalesce(wages, 0)::text as wages,
           coalesce(contract_vendors, 0)::text as contract_vendors,
           coalesce(casual_labour, 0)::text as casual_labour,
           coalesce(total_labour, 0)::text as total_labour,
           coalesce(controllable, 0)::text as controllable,
           coalesce(occupancy, 0)::text as occupancy,
           coalesce(total_expenses, 0)::text as total_expenses,
           coalesce(other_income, 0)::text as other_income,
           coalesce(orders, 0)::int as orders,
           coalesce(covers, 0)::int as covers
    from pnl_monthly
    where restaurant_id = ${restaurantId}
    order by month desc
    limit ${limit}`
}

/** What the view itself says is missing, per month. */
export async function getPnlDiagnostics(restaurantId: string): Promise<PnlDiagnostic[]> {
  return sql<PnlDiagnostic[]>`
    select month::text as month, severity, what
    from pnl_diagnostics
    where restaurant_id = ${restaurantId}
    order by month desc, severity asc`
}
