import { getRestaurant } from '@/server/queries'
import { getKitchenSections, listKitchenWastage } from '@/server/kitchen-queries'
import { getList } from '@/server/settings'
import KitchenWastageForm from '@/components/kitchen/KitchenWastageForm'
import KitchenWastageList from '@/components/kitchen/KitchenWastageList'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function KitchenWastagePage() {
  const restaurant = await getRestaurant()
  const [sections, wastage, wasteReasons] = await Promise.all([
    getKitchenSections(restaurant.id),
    listKitchenWastage(restaurant.id, 20),
    getList(restaurant.id, 'waste_reason'),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Kitchen wastage</h1>
        <p className={pageSubCls}>what the sections lost after the store issued it</p>
      </header>

      <div className="space-y-4">
        <KitchenWastageForm sections={sections} wasteReasons={wasteReasons} />
        <KitchenWastageList rows={wastage} />
      </div>
    </>
  )
}
