import { getRestaurant } from '@/server/queries'
import {
  getKitchenSections,
  getLastProductionSet,
  getProductionHistory,
  listProductions,
} from '@/server/kitchen-queries'
import { listProducibles } from '@/server/recipes-queries'
import ProductionEntry from '@/components/kitchen/ProductionEntry'
import ProductionList from '@/components/kitchen/ProductionList'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ProductionPage() {
  const restaurant = await getRestaurant()
  const [sections, producibles, recent, history] = await Promise.all([
    getKitchenSections(restaurant.id),
    listProducibles(restaurant.id),
    listProductions(restaurant.id),
    getProductionHistory(restaurant.id),
  ])

  // REFILL FROM LAST, resolved per department on the server so the chef sees
  // the offer the moment a department is picked rather than after a round
  // trip. One small read per department, and there are nine.
  const lastSets = Object.fromEntries(
    await Promise.all(
      sections.map(async (s) => [s.id, await getLastProductionSet(restaurant.id, s.id)] as const),
    ),
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Production</h1>
        <p className={pageSubCls}>batches recorded, unit cost frozen from the recipe card</p>
      </header>

      <div className="space-y-4">
        <ProductionEntry
          sections={sections}
          producibles={producibles}
          history={history}
          lastSets={lastSets}
        />
        <ProductionList rows={recent} />
      </div>
    </>
  )
}
