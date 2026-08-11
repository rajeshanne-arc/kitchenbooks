import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { listContractBills } from '@/server/expenses-queries'
import { ContractBillsClient } from '@/components/staff/LabourOutClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ContractBillsPage() {
  const restaurant = await getRestaurant()
  const [modes, rows] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listContractBills(restaurant.id),
  ])
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Contract bills</h1>
        <p className={pageSubCls}>{restaurant.name} — agencies who bill you for people</p>
      </header>
      <ContractBillsClient modes={modes} rows={rows} />
    </>
  )
}
