import { getRestaurant } from '@/server/queries'
import { listCateringEvents } from '@/server/catering-queries'
import { getList } from '@/server/settings'
import CateringClient from '@/components/cash/CateringClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function CateringPage() {
  const restaurant = await getRestaurant()
  const [events, modes] = await Promise.all([
    listCateringEvents(restaurant.id),
    getList(restaurant.id, 'payment_mode'),
  ])
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Catering</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what came in, what actually went out, and the difference
        </p>
      </header>
      <CateringClient events={events} modes={modes} />
    </>
  )
}
