// The seven registers, and the parties and tax reads beside them.
//
// ONE SHAPE for all seven: date · doc · party · narration · debit · credit.
// An accountant already knows what "purchase register" means; the app's job
// is to put rows under the word, not to invent a new arrangement of them.
// Every register reads a NAMED VIEW — purchase_register, sales_register,
// money_movements — so nothing here recomputes a figure the database has
// already stated.
import 'server-only'
import { sql } from '@/lib/db'
import type {
  AggregatorReceivableRow,
  GstDayRow,
  RegisterKey,
  RegisterRow,
  StaffFundBalance,
  VendorStatementRow,
  WithholdingRow,
} from '@/lib/types'

/** money_movements.kind values, exactly as the view emits them. Grouped
 *  rather than listed at each call site so a renamed kind breaks in ONE
 *  place instead of leaking an empty register. */
const MOVEMENT_KINDS = {
  payment: ['Payment'],
  expense: ['Expense', 'Tax deposited'],
  // A wage is a wage whichever table it came from — the money-out tables are
  // an artefact of porting the sheets one tab at a time, and the register is
  // where that artefact must not show. 'Payroll' joined them in migration
  // 0016, which made paid payroll lines reach money_movements.
  wages: ['Casual labour', 'Contract bill', 'Staff advance', 'Payroll'],
} as const

export const REGISTER_KEYS: RegisterKey[] = [
  'purchase',
  'sales',
  'payment',
  'expense',
  'cash',
  'bank',
  'wages',
]

export const REGISTER_TITLES: Record<RegisterKey, string> = {
  purchase: 'Purchase register',
  sales: 'Sales register',
  payment: 'Payment register',
  expense: 'Expense register',
  cash: 'Cash register',
  bank: 'Bank register',
  wages: 'Wages register',
}

/** What each register reads, said on the screen — the same discipline as
 *  the dashboard cards naming their view. */
export const REGISTER_SOURCES: Record<RegisterKey, string> = {
  purchase: 'purchase_register',
  sales: 'sales_register',
  payment: 'money_movements',
  expense: 'money_movements · expenses and tax deposited',
  cash: 'money_movements · cash accounts',
  bank: 'money_movements · bank accounts',
  wages: 'money_movements',
}

export const isRegisterKey = (k: string): k is RegisterKey =>
  (REGISTER_KEYS as string[]).includes(k)

/** Money OUT is a debit here and money IN is a credit, from the books'
 *  point of view rather than the bank's. money_movements already signs
 *  every row (a payment is negative, a receipt positive), so this splits
 *  that one signed number into the two columns an accountant reads. */
const MOVEMENT_SELECT = `
  select mm.move_date::text as entry_date, mm.doc_no, mm.kind,
         coalesce(mm.party, '') as party,
         coalesce(mm.narration, '') as narration,
         case when mm.amount < 0 then (-mm.amount)::text else null end as debit,
         case when mm.amount > 0 then mm.amount::text else null end as credit,
         mm.amount::text as amount,
         ma.name as account_name
  from money_movements mm
  left join money_accounts ma on ma.id = mm.account_id`

export async function getRegister(
  restaurantId: string,
  key: RegisterKey,
  from: string,
  to: string,
): Promise<RegisterRow[]> {
  if (key === 'purchase') {
    return sql<RegisterRow[]>`
      select bill_date::text as entry_date, doc_no, 'Purchase' as kind,
             vendor as party,
             trim(both ' · ' from coalesce(bill_no, '') || ' · ' || coalesce(gstin, '')) as narration,
             bill_total::text as debit, null as credit,
             bill_total::text as amount, null as account_name
      from purchase_register
      where restaurant_id = ${restaurantId}
        and bill_date between ${from}::date and ${to}::date
      order by bill_date asc, doc_no asc`
  }

  if (key === 'sales') {
    // Sales are money IN, so they sit in the credit column. taxable_value
    // and tax_collected stay separate on the screen; the register total is
    // the gross, which is what actually arrived.
    return sql<RegisterRow[]>`
      select business_date::text as entry_date, null as doc_no, 'Sales' as kind,
             channel as party,
             ('taxable ' || taxable_value::text || ' · tax ' || tax_collected::text) as narration,
             null as debit, gross::text as credit,
             gross::text as amount, null as account_name
      from sales_register
      where restaurant_id = ${restaurantId}
        and business_date between ${from}::date and ${to}::date
      order by business_date asc, channel asc`
  }

  if (key === 'cash' || key === 'bank') {
    return sql<RegisterRow[]>`
      ${sql.unsafe(MOVEMENT_SELECT)}
      where mm.restaurant_id = ${restaurantId}
        and mm.move_date between ${from}::date and ${to}::date
        and ma.kind = ${key}
      order by mm.move_date asc, mm.created_at asc`
  }

  const kinds = MOVEMENT_KINDS[key]
  return sql<RegisterRow[]>`
    ${sql.unsafe(MOVEMENT_SELECT)}
    where mm.restaurant_id = ${restaurantId}
      and mm.move_date between ${from}::date and ${to}::date
      and mm.kind = any(${kinds as unknown as string[]})
    order by mm.move_date asc, mm.created_at asc`
}

/* ── parties ───────────────────────────────────────────────────────────── */

/** One vendor's account, the way a vendor asks for it: opening, then every
 *  bill and payment in date order. Printable because vendors ask for paper. */
export async function getVendorStatement(
  restaurantId: string,
  vendorId: string,
  from: string,
  to: string,
): Promise<VendorStatementRow[]> {
  return sql<VendorStatementRow[]>`
    select code, name, gstin, opening_balance::text as opening_balance,
           move_date::text as move_date, kind, doc_no,
           coalesce(narration, '') as narration,
           debit::text as debit, credit::text as credit
    from vendor_statement
    where restaurant_id = ${restaurantId} and vendor_id = ${vendorId}
      and move_date between ${from}::date and ${to}::date
    order by move_date asc, doc_no asc`
}

export async function getAggregatorReceivable(restaurantId: string): Promise<AggregatorReceivableRow[]> {
  return sql<AggregatorReceivableRow[]>`
    select partner, agreed_commission_pct::text as agreed_commission_pct,
           gross_billed::text as gross_billed, received::text as received,
           outstanding::text as outstanding, last_settled::text as last_settled
    from aggregator_receivable
    where restaurant_id = ${restaurantId}
    order by outstanding desc, partner asc`
}

/* ── tax ───────────────────────────────────────────────────────────────── */

/** Output tax as the POS reported it, day by day. effective_gst_pct is the
 *  view's own arithmetic, not a rate this app believes in. */
export async function getGstDays(
  restaurantId: string,
  from: string,
  to: string,
): Promise<GstDayRow[]> {
  return sql<GstDayRow[]>`
    select business_date::text as business_date, food_bev::text as food_bev,
           gst_collected::text as gst_collected, service_charge::text as service_charge,
           container::text as container, effective_gst_pct::text as effective_gst_pct
    from gst_service_by_day
    where restaurant_id = ${restaurantId}
      and business_date between ${from}::date and ${to}::date
    order by business_date asc`
}

/** Input tax: what suppliers charged, from the bills themselves. Whether
 *  it is a CREDIT or a COST is a setting, never an assumption — see the Tax
 *  screen, which states which one is in force. */
export async function getInputTax(
  restaurantId: string,
  from: string,
  to: string,
): Promise<{ taxable: string; tax: string; bills: number }> {
  const [row] = await sql<{ taxable: string; tax: string; bills: number }[]>`
    select coalesce(sum(taxable_value), 0)::text as taxable,
           coalesce(sum(gst_total), 0)::text as tax,
           count(*)::int as bills
    from purchase_register
    where restaurant_id = ${restaurantId}
      and bill_date between ${from}::date and ${to}::date`
  return row ?? { taxable: '0', tax: '0', bills: 0 }
}

/** What was withheld. RECORDED, never computed — see saveWithholding. */
export async function listWithholdings(
  restaurantId: string,
  limit = 100,
): Promise<WithholdingRow[]> {
  return sql<WithholdingRow[]>`
    select id, wh_date::text as wh_date, entity_type, party, regime_code,
           base_amount::text as base_amount,
           rate_pct::text as rate_pct,
           amount::text as amount,
           deposited_on::text as deposited_on, account_id, challan_ref, note, entered_by
    from withholdings
    where restaurant_id = ${restaurantId}
    order by wh_date desc, created_at desc
    limit ${limit}`
}

/* ── the staff fund ────────────────────────────────────────────────────── */

/** A LIABILITY, not income: money collected on behalf of the staff, less
 *  what has been handed to them. The view states all three figures. */
export async function getStaffFundBalance(restaurantId: string): Promise<StaffFundBalance> {
  const [row] = await sql<StaffFundBalance[]>`
    select collected::text as collected, distributed::text as distributed,
           owed_to_staff::text as owed_to_staff
    from staff_fund_balance
    where restaurant_id = ${restaurantId}`
  return row ?? { collected: '0', distributed: '0', owed_to_staff: '0' }
}
