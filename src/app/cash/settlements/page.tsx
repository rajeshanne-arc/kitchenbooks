import { getRestaurant } from '@/server/queries'
import { getPartnerSummaries, listSettlements } from '@/server/cashier-queries'
import { getList } from '@/server/settings'
import GroupTabs from '@/components/GroupTabs'
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
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className={pageTitleCls}>Settlements</h1>
        <p className={pageSubCls}>what Swiggy and Zomato grossed, kept, and paid</p>
      </header>
      <GroupTabs group="cashier" />
      <SettlementsClient partners={partners} rows={rows} summaries={summaries} />
    </main>
  )
}
