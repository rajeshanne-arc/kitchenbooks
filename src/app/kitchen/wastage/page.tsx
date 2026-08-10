import { getRestaurant } from '@/server/queries'
import { getKitchenSections, listKitchenWastage } from '@/server/kitchen-queries'
import { getList } from '@/server/settings'
import GroupTabs from '@/components/GroupTabs'
import KitchenWastageForm from '@/components/kitchen/KitchenWastageForm'
import KitchenWastageList from '@/components/kitchen/KitchenWastageList'

export const dynamic = 'force-dynamic'

export default async function KitchenWastagePage() {
  const restaurant = await getRestaurant()
  const [sections, wastage, wasteReasons] = await Promise.all([
    getKitchenSections(restaurant.id),
    listKitchenWastage(restaurant.id, 20),
    getList(restaurant.id, 'waste_reason'),
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Kitchen wastage</h1>
        <p className="mt-0.5 text-sm text-stone-400">what the sections lost after the store issued it</p>
      </header>
      <GroupTabs group="kitchen" />

      <div className="space-y-4">
        <KitchenWastageForm sections={sections} wasteReasons={wasteReasons} />
        <KitchenWastageList rows={wastage} />
      </div>
    </main>
  )
}
