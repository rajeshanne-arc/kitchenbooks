import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import PaymentClient from '@/components/store/PaymentClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function StorePaymentPage() {
  const restaurant = await getRestaurant()
  const modes = await getList(restaurant.id, 'payment_mode')

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Vendor payment</h1>
        <p className={pageSubCls}>
          {restaurant.name} — dues come live from vendor_dues; the payment is one INSERT
        </p>
      </header>
      <PaymentClient modes={modes} />
    </>
  )
}
