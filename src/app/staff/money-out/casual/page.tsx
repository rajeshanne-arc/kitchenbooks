import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { listCasualLabour } from '@/server/expenses-queries'
import { getSections } from '@/server/store-queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { CasualLabourClient } from '@/components/staff/LabourOutClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function CasualLabourPage() {
  const restaurant = await getRestaurant()
  const [modes, rows, sections, accounts] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listCasualLabour(restaurant.id),
    getSections(restaurant.id),
    listMoneyAccounts(restaurant.id),
  ])
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Casual labour</h1>
        <p className={pageSubCls}>{restaurant.name} — daily hands who are not on the roster</p>
      </header>
      <CasualLabourClient accounts={accounts} modes={modes} sections={sections} rows={rows} />
    </>
  )
}
