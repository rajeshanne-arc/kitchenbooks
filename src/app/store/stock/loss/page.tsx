import WastageEntry from '@/components/store/WastageEntry'
import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function WastagePage() {
  const restaurant = await getRestaurant()
  const reasons = await getList(restaurant.id, 'waste_reason')
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Record wastage</h1>
        <p className={pageSubCls}>{restaurant.name} store</p>
      </header>
      <WastageEntry reasons={reasons} />
    </>
  )
}
