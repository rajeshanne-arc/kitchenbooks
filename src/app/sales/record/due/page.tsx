import { getRestaurant } from '@/server/queries'
import { getDuesOutstanding, listDues } from '@/server/cashier-queries'
import { getNameHistory } from '@/server/settings'
import { listPosReceivables } from '@/server/sales-queries'
import DuesClient from '@/components/cash/DuesClient'
import PosReceivables from '@/components/cash/PosReceivables'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function DuesPage() {
  const restaurant = await getRestaurant()
  const [parties, rows, outstanding, receivables] = await Promise.all([
    getNameHistory(restaurant.id, 'due_party'),
    listDues(restaurant.id, 20),
    getDuesOutstanding(restaurant.id),
    listPosReceivables(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Dues</h1>
        <p className={pageSubCls}>credit out, repayments in — one ledger per party</p>
      </header>
      {/* ABOVE the manual form, because it is a finding rather than a form:
          the POS already knows we are owed this and the ledger does not.
          Renders nothing when the queue is empty — a permanent "0 waiting" is
          a thing people learn to dismiss. */}
      <div className="pb-4">
        <PosReceivables rows={receivables} parties={parties} />
      </div>
      <DuesClient parties={parties} rows={rows} outstanding={outstanding} />
    </>
  )
}
