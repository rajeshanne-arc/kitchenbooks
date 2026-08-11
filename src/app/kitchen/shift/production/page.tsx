import { getRestaurant } from '@/server/queries'
import { getKitchenSections, listProductions } from '@/server/kitchen-queries'
import { listSubCosts } from '@/server/recipes-queries'
import ProductionEntry from '@/components/kitchen/ProductionEntry'
import ProductionList from '@/components/kitchen/ProductionList'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ProductionPage() {
  const restaurant = await getRestaurant()
  const [sections, subs, recent] = await Promise.all([
    getKitchenSections(restaurant.id),
    listSubCosts(restaurant.id),
    listProductions(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Production</h1>
        <p className={pageSubCls}>batches recorded, unit cost frozen from the recipe card</p>
      </header>

      <div className="space-y-4">
        <ProductionEntry sections={sections} subs={subs.filter((s) => s.status === 'active')} />
        <ProductionList rows={recent} />
      </div>
    </>
  )
}
