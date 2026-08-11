import { getRestaurant } from '@/server/queries'
import { getPartnerSummaries, listSettlements } from '@/server/cashier-queries'
import { getList } from '@/server/settings'
import SettlementsClient from '@/components/cash/SettlementsClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SettlementsPage() {
  const restaurant = await getRestaurant()
  const [partners, rows, summaries] = await Promise.all([
    getList(restaurant.id, 'partner'),
    listSettlements(restaurant.id, 15),
    getPartnerSummaries(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Settlements</h1>
        <p className={pageSubCls}>what Swiggy and Zomato grossed, kept, and paid</p>
      </header>
      <SettlementsClient partners={partners} rows={rows} summaries={summaries} />
    </>
  )
}
