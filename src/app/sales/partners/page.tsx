import { getRestaurant } from '@/server/queries'
import { listPartners } from '@/server/cashier-queries'
import PartnersClient from '@/components/cash/PartnersClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PartnersPage() {
  const restaurant = await getRestaurant()
  const partners = await listPartners(restaurant.id, true)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Partners</h1>
        <p className={pageSubCls}>
          {restaurant.name} — who sells on your behalf, and what they agreed to take
        </p>
      </header>
      <PartnersClient partners={partners} />
    </>
  )
}
