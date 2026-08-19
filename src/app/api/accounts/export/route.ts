// Registers out as CSV. A route handler rather than a server action because
// the answer is a FILE — the browser must download it, not re-render a page.
//
// The proxy gates /api/accounts like every other path, and this re-checks
// the session anyway: a download link is the easiest thing in an app to
// forward to somebody who should not have it.
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { getRegister, isRegisterKey, REGISTER_TITLES } from '@/server/register-queries'
import { canAccess } from '@/lib/roles'
import { csvFilename, toCsv } from '@/lib/csv'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user || !canAccess(user.role, '/accounts/export')) {
    return new NextResponse('Not yours to download', { status: 403 })
  }

  const url = new URL(request.url)
  const key = url.searchParams.get('register') ?? ''
  if (!isRegisterKey(key)) return new NextResponse('Unknown register', { status: 400 })

  const periodParam = url.searchParams.get('period') ?? ''
  // The CSV must cover exactly what the screen covered — the register page
  // carries its ?period= into this href, custom range included, so the same
  // front door reads it here.
  const today = await businessToday()
  const period = resolvePeriod(readPeriodParam(periodParam, today).param, today)

  const restaurant = await getRestaurant()
  const rows = await getRegister(restaurant.id, key, period.from, period.to)

  // Debit and credit go out as PLAIN NUMBERS, not formatted rupees: this
  // file is going into someone else's software, and ₹1,04,500.00 is a
  // string to every one of them.
  const csv = toCsv(
    ['Date', 'Doc', 'Kind', 'Party', 'Narration', 'Account', 'Debit', 'Credit'],
    rows.map((r) => [
      r.entry_date,
      r.doc_no,
      r.kind,
      r.party,
      r.narration,
      r.account_name,
      r.debit,
      r.credit,
    ]),
  )

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csvFilename(REGISTER_TITLES[key], period.from, period.to)}"`,
      'cache-control': 'no-store',
    },
  })
}
