import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { canAccess } from '@/lib/roles'
import { csvFilename, toCsv } from '@/lib/csv'
import { tsql } from '@/lib/db'
import { businessToday } from '@/server/business-day'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Provider-neutral withholding handoff. The export reports amounts the
 * accountant entered and the customer's regime code; it never applies a tax
 * rate or claims to be a government filing format. */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user || !canAccess(user.role, '/accounts/payments/deposit')) return new NextResponse('Not yours to download', { status: 403 })
  const restaurant = await getRestaurant()
  const today = await businessToday()
  const params = new URL(request.url).searchParams
  const defaultFrom = `${today.slice(0, 7)}-01`
  const from = params.get('from') ?? defaultFrom
  const to = params.get('to') ?? today
  if (!DATE.test(from) || !DATE.test(to) || from > to) return new NextResponse('Invalid date range', { status: 400 })
  const rows = await tsql<{ wh_date: string; entity_type: string; party: string; regime_code: string | null; base_amount: string; rate_pct: string | null; amount: string; deposited_on: string | null; challan_ref: string | null; note: string | null; entered_by: string }[]>`
    select wh_date::text, entity_type, party, regime_code, base_amount::text,
           rate_pct::text, amount::text, deposited_on::text, challan_ref, note,
           entered_by
    from withholdings
    where restaurant_id = ${restaurant.id} and wh_date between ${from}::date and ${to}::date
    order by wh_date asc, created_at asc`
  const csv = toCsv(
    ['Withheld date', 'Payment kind', 'Party', 'Regime code', 'Payment base', 'Rate (derived)', 'Amount withheld', 'Deposited on', 'Challan/reference', 'Note', 'Entered by'],
    rows.map((row) => [row.wh_date, row.entity_type, row.party, row.regime_code, row.base_amount, row.rate_pct, row.amount, row.deposited_on, row.challan_ref, row.note, row.entered_by]),
  )
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${csvFilename('withholdings', from, to)}"`, 'cache-control': 'no-store' } })
}
