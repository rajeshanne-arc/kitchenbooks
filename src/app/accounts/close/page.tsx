// Closing a period. The gate — no close while a query is open — is enforced
// in closePeriod and re-read inside its lock; this page only shows it early
// enough to be useful.
//
// The staff fund shares the screen because it is the other thing that has to
// be square before a month is finished — money held for the staff, not earned.
import { getRestaurant } from '@/server/queries'
import { listClosedPeriods, listOpenQueries } from '@/server/accountant-queries'
import { getStaffFundBalance } from '@/server/register-queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { todayIST } from '@/server/store-queries'
import CloseClient from '@/components/accountant/CloseClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

/** Last month, offered as the starting point — the period an accountant is
 *  almost always closing. Offered, never assumed: both dates stay editable. */
function lastMonth(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const y = month === 1 ? year - 1 : year
  const m = month === 1 ? 12 : month - 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

export default async function ClosePeriodPage() {
  const restaurant = await getRestaurant()
  const today = todayIST()
  // one fan-out, not four awaits — the pool is shared with the group layout
  const [blocking, closed, fund, accounts] = await Promise.all([
    listOpenQueries(restaurant.id),
    listClosedPeriods(restaurant.id),
    getStaffFundBalance(restaurant.id),
    listMoneyAccounts(restaurant.id),
  ])
  const offered = lastMonth(today)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Close</h1>
        <p className={pageSubCls}>
          {restaurant.name} — a month closes when nothing is still being asked about it.
        </p>
      </header>
      <CloseClient
        blocking={blocking}
        closed={closed}
        defaultStart={offered.from}
        defaultEnd={offered.to}
        fund={fund}
        accounts={accounts}
        today={today}
      />
    </>
  )
}
