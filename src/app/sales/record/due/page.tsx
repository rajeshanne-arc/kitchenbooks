import { getRestaurant } from '@/server/queries'
import { getDuesOutstanding, listDues } from '@/server/cashier-queries'
import { getNameHistory } from '@/server/settings'
import DuesClient from '@/components/cash/DuesClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function DuesPage() {
  const restaurant = await getRestaurant()
  const [parties, rows, outstanding] = await Promise.all([
    getNameHistory(restaurant.id, 'due_party'),
    listDues(restaurant.id, 20),
    getDuesOutstanding(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Dues</h1>
        <p className={pageSubCls}>credit out, repayments in — one ledger per party</p>
      </header>
      <DuesClient parties={parties} rows={rows} outstanding={outstanding} />
    </>
  )
}
