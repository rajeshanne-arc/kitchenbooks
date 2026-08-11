import { getRestaurant } from '@/server/queries'
import { listOffBook } from '@/server/cashier-queries'
import { getList } from '@/server/settings'
import OffBookClient from '@/components/cash/OffBookClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function OffBookPage() {
  const restaurant = await getRestaurant()
  const [modes, rows] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listOffBook(restaurant.id, 20),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Off-book orders</h1>
        <p className={pageSubCls}>sales that never touched the POS — recorded, not hidden</p>
      </header>
      <OffBookClient modes={modes} rows={rows} />
    </>
  )
}
