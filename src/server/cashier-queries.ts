// Read side of the cashier group's four sheet modules — settlements,
// off-book orders, non-revenue (giveaways), dues — plus the analytics the
// cash tabs surface. Every number reads a table or named view
// (dues_outstanding, day_close_ladder); nothing is recomputed client-side.
import 'server-only'
import { sql, tsql } from '@/lib/db'
import type {
  DifferenceTrendRow,
  DueOutstandingRow,
  DueRow,
  NonRevenueRow,
  OffBookRow,
  Partner,
  PartnerPanelRow,
  PartnerSummaryRow,
  SettlementDeductionRow,
  SettlementRow,
  VoucherCategorySummaryRow,
} from '@/lib/types'

// ------------------------------------------------------------ settlements

const SETTLEMENT_SELECT = `
  select s.id, s.partner, s.period_start::text as period_start, s.period_end::text as period_end,
         s.gross_sales::text as gross_sales, s.commission::text as commission,
         s.other_deductions::text as other_deductions, s.amount_received::text as amount_received,
         s.received_date::text as received_date, s.note, s.reverses_id,
         (s.reverses_id is not null) as is_reversal,
         exists (select 1 from partner_settlements x where x.reverses_id = s.id) as is_voided,
         s.entered_by, s.created_at::text as created_at
  from partner_settlements s`

export async function getSettlement(restaurantId: string, id: string): Promise<SettlementRow | null> {
  const rows = await tsql<SettlementRow[]>`
    ${sql.unsafe(SETTLEMENT_SELECT)}
    where s.restaurant_id = ${restaurantId} and s.id = ${id}`
  return rows[0] ?? null
}

export async function listSettlements(restaurantId: string, limit = 40): Promise<SettlementRow[]> {
  return tsql<SettlementRow[]>`
    ${sql.unsafe(SETTLEMENT_SELECT)}
    where s.restaurant_id = ${restaurantId}
    order by s.period_end desc, s.created_at desc
    limit ${limit}`
}

/** Per-partner totals over every settlement (reversals net out in the
 * sums). outstanding = gross − commission − deductions − received: what
 * the partner still owes for the periods filed. */
export async function getPartnerSummaries(restaurantId: string): Promise<PartnerSummaryRow[]> {
  return tsql<PartnerSummaryRow[]>`
    select partner,
           count(*) filter (where reverses_id is null)::int as settlements,
           coalesce(sum(gross_sales), 0)::text as gross_sales,
           coalesce(sum(commission), 0)::text as commission,
           coalesce(sum(other_deductions), 0)::text as other_deductions,
           coalesce(sum(amount_received), 0)::text as amount_received,
           (coalesce(sum(gross_sales), 0) - coalesce(sum(commission), 0)
            - coalesce(sum(other_deductions), 0) - coalesce(sum(amount_received), 0))::text as outstanding
    from partner_settlements
    where restaurant_id = ${restaurantId}
    group by partner
    order by partner asc`
}

// -------------------------------------------------------- off-book orders

const OFFBOOK_SELECT = `
  select o.id, o.order_date::text as order_date, o.description, o.amount::text as amount,
         o.payment_mode, o.note, o.reverses_id,
         (o.reverses_id is not null) as is_reversal,
         exists (select 1 from off_book_orders x where x.reverses_id = o.id) as is_voided,
         o.entered_by, o.created_at::text as created_at
  from off_book_orders o`

export async function getOffBook(restaurantId: string, id: string): Promise<OffBookRow | null> {
  const rows = await tsql<OffBookRow[]>`
    ${sql.unsafe(OFFBOOK_SELECT)}
    where o.restaurant_id = ${restaurantId} and o.id = ${id}`
  return rows[0] ?? null
}

export async function listOffBook(restaurantId: string, limit = 40): Promise<OffBookRow[]> {
  return tsql<OffBookRow[]>`
    ${sql.unsafe(OFFBOOK_SELECT)}
    where o.restaurant_id = ${restaurantId}
    order by o.order_date desc, o.created_at desc
    limit ${limit}`
}

// ------------------------------------------------------------ non-revenue

const NR_SELECT = `
  select n.id, n.nr_date::text as nr_date, n.reason, n.recipe_id,
         r.code as recipe_code, r.name as recipe_name,
         n.description, n.qty::text as qty, n.menu_value::text as menu_value,
         n.cost_value::text as cost_value, n.given_to, n.note, n.reverses_id,
         (n.reverses_id is not null) as is_reversal,
         exists (select 1 from non_revenue x where x.reverses_id = n.id) as is_voided,
         n.entered_by, n.created_at::text as created_at
  from non_revenue n
  left join recipes r on r.id = n.recipe_id`

export async function getNonRevenue(restaurantId: string, id: string): Promise<NonRevenueRow | null> {
  const rows = await tsql<NonRevenueRow[]>`
    ${sql.unsafe(NR_SELECT)}
    where n.restaurant_id = ${restaurantId} and n.id = ${id}`
  return rows[0] ?? null
}

export async function listNonRevenue(restaurantId: string, limit = 40): Promise<NonRevenueRow[]> {
  return tsql<NonRevenueRow[]>`
    ${sql.unsafe(NR_SELECT)}
    where n.restaurant_id = ${restaurantId}
    order by n.nr_date desc, n.created_at desc
    limit ${limit}`
}

/** The month's giveaway bill: frozen cost, entries, menu value — reversals
 * net out. Giveaways finally cost something. */
export async function getGiveawayMonth(
  restaurantId: string,
  monthStart: string,
): Promise<{ entries: number; cost_value: string; menu_value: string }> {
  const rows = await tsql<{ entries: number; cost_value: string; menu_value: string }[]>`
    select count(*) filter (where reverses_id is null)::int as entries,
           coalesce(sum(cost_value), 0)::text as cost_value,
           coalesce(sum(menu_value), 0)::text as menu_value
    from non_revenue
    where restaurant_id = ${restaurantId}
      and date_trunc('month', nr_date)::date = ${monthStart}::date`
  return rows[0] ?? { entries: 0, cost_value: '0', menu_value: '0' }
}

// ------------------------------------------------------------------- dues

const DUE_SELECT = `
  select d.id, d.due_date::text as due_date, d.party, d.amount::text as amount,
         d.against_what, d.ref, d.note, d.reverses_id,
         (d.reverses_id is not null) as is_reversal,
         exists (select 1 from due_payments x where x.reverses_id = d.id) as is_voided,
         d.entered_by, d.created_at::text as created_at
  from due_payments d`

export async function getDue(restaurantId: string, id: string): Promise<DueRow | null> {
  const rows = await tsql<DueRow[]>`
    ${sql.unsafe(DUE_SELECT)}
    where d.restaurant_id = ${restaurantId} and d.id = ${id}`
  return rows[0] ?? null
}

export async function listDues(restaurantId: string, limit = 40): Promise<DueRow[]> {
  return tsql<DueRow[]>`
    ${sql.unsafe(DUE_SELECT)}
    where d.restaurant_id = ${restaurantId}
    order by d.due_date desc, d.created_at desc
    limit ${limit}`
}

/** Who still owes / is owed — straight from the dues_outstanding view,
 * which nets on lower(trim(party)) so “Ramu” and “ramu ” are one ledger. */
export async function getDuesOutstanding(restaurantId: string): Promise<DueOutstandingRow[]> {
  return tsql<DueOutstandingRow[]>`
    select party, balance::text as balance
    from dues_outstanding
    where restaurant_id = ${restaurantId}
    order by balance desc, party asc`
}

/** Dishes for the giveaway picker — with selling price so the form can
 * offer menu_value, and costability so uncostable dishes explain
 * themselves before the server refuses. */
export async function listGiveawayDishes(
  restaurantId: string,
): Promise<{ id: string; code: string; name: string; selling_price: string | null; has_cost: boolean }[]> {
  return tsql<{ id: string; code: string; name: string; selling_price: string | null; has_cost: boolean }[]>`
    select r.id, r.code, r.name, r.selling_price::text as selling_price,
           (dc.dish_cost is not null) as has_cost
    from recipes r
    left join dish_costs dc on dc.recipe_id = r.id
    where r.restaurant_id = ${restaurantId} and r.kind = 'dish' and r.status = 'active'
    order by r.name asc`
}

// -------------------------------------------------------------- analytics

/** Difference across recent closes, oldest first — the trend the cashier
 * answers for. Straight from day_close_ladder (latest filing per date). */
export async function getDifferenceTrend(restaurantId: string, limit = 30): Promise<DifferenceTrendRow[]> {
  const rows = await tsql<DifferenceTrendRow[]>`
    select l.close_date::text as close_date, l.difference::text as difference,
           (select count(*)::int from day_closes dc
            where dc.restaurant_id = l.restaurant_id and dc.close_date = l.close_date) as filings
    from day_close_ladder l
    where l.restaurant_id = ${restaurantId}
    order by l.close_date desc
    limit ${limit}`
  return rows.reverse()
}

/** Vouchers by category for one month — cashier-paid only (owner-funded
 * money never touched the drawer; it lives in owners_owed). */
export async function getVoucherCategorySummary(
  restaurantId: string,
  monthStart: string,
): Promise<VoucherCategorySummaryRow[]> {
  return tsql<VoucherCategorySummaryRow[]>`
    select category, count(*)::int as entries, coalesce(sum(amount), 0)::text as amount
    from cash_vouchers
    where restaurant_id = ${restaurantId} and paid_by = 'cashier'
      and date_trunc('month', voucher_date)::date = ${monthStart}::date
    group by category
    order by sum(amount) desc`
}

// ───────────────────────────── the partners master ────────────────────────
// The aggregators as ROWS, not as strings in a list. list_options could hold
// the name and nothing else; agreed_commission_pct is the number the whole
// settlement-gap card turns on, so the partners table is the master and the
// settlement form reads from it.

export async function listPartners(restaurantId: string, includeRetired = false): Promise<Partner[]> {
  return tsql<Partner[]>`
    select id, name, kind, agreed_commission_pct::text as agreed_commission_pct, status
    from partners
    where restaurant_id = ${restaurantId}
      and (${includeRetired} or status = 'active')
    order by status asc, name asc`
}

export async function getPartner(restaurantId: string, id: string): Promise<Partner | null> {
  const rows = await tsql<Partner[]>`
    select id, name, kind, agreed_commission_pct::text as agreed_commission_pct, status
    from partners
    where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

/** The itemised deductions under one settlement. */
export async function getSettlementDeductions(settlementId: string): Promise<SettlementDeductionRow[]> {
  return tsql<SettlementDeductionRow[]>`
    select id, deduction_type, amount::text as amount, note
    from settlement_deductions
    where settlement_id = ${settlementId}
    order by amount desc, deduction_type asc`
}

/** Every partner on the master, with what has been settled against them.
 *
 * LEFT JOIN from partners, so a partner with no settlement still appears —
 * "we have never reconciled Zomato" is a finding, and a row that is absent
 * cannot say it.
 *
 * effective_pct is commission ÷ gross: what they actually kept. agreed_pct
 * is what they said they would. The DIFFERENCE is the point of the screen,
 * and it is a separate question from the rupee gap: a small gap on a large
 * period can hide a rate that drifted, and a large gap can be one disputed
 * invoice charged at exactly the agreed rate.
 */
export async function getPartnerPanel(restaurantId: string): Promise<PartnerPanelRow[]> {
  return tsql<PartnerPanelRow[]>`
    select p.name as partner,
           p.kind,
           p.agreed_commission_pct::text as agreed_pct,
           count(ps.id) filter (where ps.reverses_id is null)::int as settlements,
           coalesce(sum(ps.gross_sales), 0)::text as gross_sales,
           coalesce(sum(ps.commission), 0)::text as commission,
           coalesce(sum(ps.billed_by_us), 0)::text as billed,
           coalesce(sum(ps.claimed_by_them), 0)::text as claimed,
           coalesce(sum(ps.gap), 0)::text as gap,
           coalesce(sum(ps.amount_received), 0)::text as received,
           (coalesce(sum(ps.gross_sales), 0) - coalesce(sum(ps.commission), 0)
            - coalesce(sum(ps.other_deductions), 0) - coalesce(sum(ps.amount_received), 0))::text as outstanding,
           count(ps.id) filter (where ps.billed_by_us is null or ps.claimed_by_them is null)::int as uncompared,
           case when coalesce(sum(ps.gross_sales), 0) > 0
                then round(coalesce(sum(ps.commission), 0) / sum(ps.gross_sales) * 100, 2)::text
                else null end as effective_pct
    from partners p
    left join partner_settlements ps
      on ps.restaurant_id = p.restaurant_id
     and lower(trim(ps.partner)) = lower(trim(p.name))
    where p.restaurant_id = ${restaurantId} and p.status = 'active'
    group by p.name, p.kind, p.agreed_commission_pct
    order by coalesce(sum(ps.gap), 0) desc, p.name asc`
}
