// Read side of cash. The drawer math lives in day_close_ladder (owner-funded
// vouchers are ALREADY filtered out there — never re-add them in code); the
// owner ledger lives in owners_owed (one voucher log, netted). Closes store
// their own opening (photograph rule) — the app only ever PREFILLS it: from
// the previous day's COUNTED cash, or from settings.first_opening_cash on
// the very first day. A shortage must belong to the day it happened.
import 'server-only'
import { sql } from '@/lib/db'
import type { ClosePrefill, DayCloseLadderRow, OtherIncomeRow, OwnerOwedRow, VoucherRow } from '@/lib/types'

const LADDER_SELECT = `
  select l.close_date::text as close_date,
         l.opening_cash::text as opening_cash,
         l.pos_cash::text as pos_cash,
         l.other_income::text as other_income,
         l.extra_cash_in::text as extra_cash_in,
         l.cashier_vouchers::text as cashier_vouchers,
         l.handed_over::text as handed_over,
         l.handed_to,
         l.expected_cash::text as expected_cash,
         l.cash_counted::text as cash_counted,
         l.difference::text as difference,
         l.bank_settled::text as bank_settled,
         l.entered_by, l.created_at::text as created_at,
         (select count(*)::int from day_closes dc
          where dc.restaurant_id = l.restaurant_id and dc.close_date = l.close_date) as filings
  from day_close_ladder l`

export async function getLadder(restaurantId: string, limit = 45): Promise<DayCloseLadderRow[]> {
  return sql<DayCloseLadderRow[]>`
    ${sql.unsafe(LADDER_SELECT)}
    where l.restaurant_id = ${restaurantId}
    order by l.close_date desc
    limit ${limit}`
}

export async function getLadderDay(restaurantId: string, date: string): Promise<DayCloseLadderRow | null> {
  const rows = await sql<DayCloseLadderRow[]>`
    ${sql.unsafe(LADDER_SELECT)}
    where l.restaurant_id = ${restaurantId} and l.close_date = ${date}`
  return rows[0] ?? null
}

/** The pre-save ladder: opening resolved by the chain law, live components
 * for the date. Also the gatekeeper — the HARD STOP on a missing D-1 close
 * is decided here (and re-checked inside the save transaction). */
export async function getClosePrefill(restaurantId: string, date: string): Promise<ClosePrefill> {
  const prevDate = new Date(`${date}T00:00:00Z`)
  prevDate.setUTCDate(prevDate.getUTCDate() - 1)
  const prev = prevDate.toISOString().slice(0, 10)

  const [state] = await sql<
    {
      prev_counted: string | null
      any_closes: boolean
      min_close_date: string | null
      prior_filings: number
      existing_opening: string | null
      first_opening: string | null
      pos_cash: string
      other_income: string
      cashier_vouchers: string
    }[]
  >`
    select
      (select cash_counted::text from day_close_current
        where restaurant_id = ${restaurantId} and close_date = ${prev}::date) as prev_counted,
      exists (select 1 from day_closes where restaurant_id = ${restaurantId}) as any_closes,
      (select min(close_date)::text from day_closes where restaurant_id = ${restaurantId}) as min_close_date,
      (select count(*)::int from day_closes
        where restaurant_id = ${restaurantId} and close_date = ${date}::date) as prior_filings,
      (select opening_cash::text from day_close_current
        where restaurant_id = ${restaurantId} and close_date = ${date}::date) as existing_opening,
      (select value from settings
        where restaurant_id = ${restaurantId} and key = 'first_opening_cash') as first_opening,
      coalesce((select cash_revenue::text from sales_by_day
        where restaurant_id = ${restaurantId} and business_date = ${date}::date), '0') as pos_cash,
      coalesce((select sum(amount)::text from other_income
        where restaurant_id = ${restaurantId} and income_date = ${date}::date), '0') as other_income,
      coalesce((select sum(amount)::text from cash_vouchers
        where restaurant_id = ${restaurantId} and voucher_date = ${date}::date
          and paid_by = 'cashier'), '0') as cashier_vouchers`

  const base = {
    date,
    posCash: state.pos_cash,
    otherIncome: state.other_income,
    cashierVouchers: state.cashier_vouchers,
    priorFilings: state.prior_filings,
    anyCloses: state.any_closes,
  }

  if (state.prev_counted !== null) {
    return { ok: true, ...base, opening: state.prev_counted, openingSource: 'previous counted' }
  }
  if (!state.any_closes) {
    if (state.first_opening === null) {
      return {
        ok: false,
        blocked: 'no_opening',
        missingDate: null,
        anyCloses: false,
        error:
          'No opening cash on record. Use “Set opening cash” once — after the first close, every opening comes from the previous day’s count.',
      }
    }
    return { ok: true, ...base, opening: state.first_opening, openingSource: 'first_opening_cash' }
  }
  if (state.min_close_date === date && state.prior_filings > 0) {
    const opening = state.first_opening ?? state.existing_opening
    if (opening !== null) return { ok: true, ...base, opening, openingSource: 'first day (re-file)' }
  }
  return {
    ok: false,
    blocked: 'missing_prev',
    missingDate: prev,
    anyCloses: true,
    error: `${prev} has no close. Close ${prev} first — the ladder moves one day at a time, so a shortage belongs to the day it happened.`,
  }
}

export async function getOwnersOwed(restaurantId: string): Promise<OwnerOwedRow[]> {
  return sql<OwnerOwedRow[]>`
    select person,
           coalesce(paid_from_pocket, 0)::text as paid_from_pocket,
           coalesce(reimbursed, 0)::text as reimbursed,
           coalesce(balance, 0)::text as balance
    from owners_owed
    where restaurant_id = ${restaurantId}
    order by balance desc, person asc`
}

/** Names the pickers feed on: owners seen in the voucher log plus the
 * optional settings list ('owner_names', comma-separated). Free text breaks
 * the netting on “Asheel” vs “Asheel Sir” — pick, don't retype. */
export async function getOwnerNames(restaurantId: string): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select distinct coalesce(owner_name, paid_to) as name
    from cash_vouchers
    where restaurant_id = ${restaurantId}
      and (paid_by = 'owner' or category = 'owner_reimbursement')`
  const [setting] = await sql<{ value: string | null }[]>`
    select value from settings where restaurant_id = ${restaurantId} and key = 'owner_names'`
  const fromSettings = (setting?.value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return [...new Set([...fromSettings, ...rows.map((r) => r.name)])].sort()
}

export async function getVoucherCategories(restaurantId: string): Promise<string[]> {
  const rows = await sql<{ category: string }[]>`
    select distinct category from cash_vouchers where restaurant_id = ${restaurantId}`
  return [...new Set(['general', 'owner_reimbursement', ...rows.map((r) => r.category)])].sort()
}

const VOUCHER_SELECT = `
  select id, voucher_date::text as voucher_date, amount::text as amount, paid_to, paid_by,
         owner_name, category, note, created_at::text as created_at
  from cash_vouchers`

export async function getVoucher(restaurantId: string, id: string): Promise<VoucherRow | null> {
  const rows = await sql<VoucherRow[]>`
    ${sql.unsafe(VOUCHER_SELECT)}
    where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

export async function listVouchers(restaurantId: string, limit = 60): Promise<VoucherRow[]> {
  return sql<VoucherRow[]>`
    ${sql.unsafe(VOUCHER_SELECT)}
    where restaurant_id = ${restaurantId}
    order by voucher_date desc, created_at desc
    limit ${limit}`
}

const INCOME_SELECT = `
  select id, income_date::text as income_date, item, qty::text as qty, unit,
         amount::text as amount, buyer, received_by, created_at::text as created_at
  from other_income`

export async function getOtherIncome(restaurantId: string, id: string): Promise<OtherIncomeRow | null> {
  const rows = await sql<OtherIncomeRow[]>`
    ${sql.unsafe(INCOME_SELECT)}
    where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

export async function listOtherIncome(restaurantId: string, limit = 60): Promise<OtherIncomeRow[]> {
  return sql<OtherIncomeRow[]>`
    ${sql.unsafe(INCOME_SELECT)}
    where restaurant_id = ${restaurantId}
    order by income_date desc, created_at desc
    limit ${limit}`
}
