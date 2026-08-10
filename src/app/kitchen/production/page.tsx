import { getRestaurant } from '@/server/queries'
import { getKitchenSections, listProductions } from '@/server/kitchen-queries'
import { listSubCosts } from '@/server/recipes-queries'
import GroupTabs from '@/components/GroupTabs'
import ProductionEntry from '@/components/kitchen/ProductionEntry'
import ProductionList from '@/components/kitchen/ProductionList'

export const dynamic = 'force-dynamic'

export default async function ProductionPage() {
  const restaurant = await getRestaurant()
  const [sections, subs, recent] = await Promise.all([
    getKitchenSections(restaurant.id),
    listSubCosts(restaurant.id),
    listProductions(restaurant.id),
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Production</h1>
        <p className="mt-0.5 text-sm text-stone-400">batches recorded, unit cost frozen from the recipe card</p>
      </header>
      <GroupTabs group="kitchen" />

      <div className="space-y-4">
        <ProductionEntry sections={sections} subs={subs.filter((s) => s.status === 'active')} />
        <ProductionList rows={recent} />
      </div>
    </main>
  )
}
