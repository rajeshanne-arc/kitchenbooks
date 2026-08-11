import { getRestaurant } from '@/server/queries'
import {
  getPartnerPanel,
  getPartnerSummaries,
  listPartners,
  listSettlements,
} from '@/server/cashier-queries'
import { getList } from '@/server/settings'
import PartnerPanel from '@/components/cash/PartnerPanel'
import PartnersClient from '@/components/cash/PartnersClient'
import SettlementsClient from '@/components/cash/SettlementsClient'
import { pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// PARTNERS IS THE SECTION; settlements live inside it, because a settlement
// is something a partner does. They were sibling tabs, which put the master
// and the thing it governs in two places and made the agreed rate feel like
// trivia rather than the number every settlement is measured against.
//
// Order on the page follows the question being asked: where does each
// partner stand, then file a new settlement, then edit the master.

export default async function PartnersPage() {
  const restaurant = await getRestaurant()
  const [panel, partners, rows, summaries, deductionTypes] = await Promise.all([
    getPartnerPanel(restaurant.id),
    listPartners(restaurant.id, true),
    listSettlements(restaurant.id, 15),
    getPartnerSummaries(restaurant.id),
    getList(restaurant.id, 'settlement_deduction'),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Partners</h1>
        <p className={pageSubCls}>
          {restaurant.name} — who sells on your behalf, what they agreed to take, and what they actually did
        </p>
      </header>

      <div className="space-y-4">
        <PartnerPanel rows={panel} />

        <div id="settlements" className="scroll-mt-4">
          <h2 className={`${sectionHeadCls} pb-2`}>Settlements</h2>
          <SettlementsClient
            partners={partners.filter((p) => p.status === 'active')}
            deductionTypes={deductionTypes}
            rows={rows}
            summaries={summaries}
          />
        </div>

        <div>
          <h2 className={`${sectionHeadCls} pb-2`}>The partner master</h2>
          <PartnersClient partners={partners} />
        </div>
      </div>
    </>
  )
}
