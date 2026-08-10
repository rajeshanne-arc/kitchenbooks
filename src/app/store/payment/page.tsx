import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import GroupTabs from '@/components/GroupTabs'
import PaymentClient from '@/components/store/PaymentClient'

export const dynamic = 'force-dynamic'

export default async function StorePaymentPage() {
  const restaurant = await getRestaurant()
  const modes = await getList(restaurant.id, 'payment_mode')

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Vendor payment</h1>
        <p className="mt-0.5 text-sm text-stone-400">
          {restaurant.name} — dues come live from vendor_dues; the payment is one INSERT
        </p>
      </header>
      <GroupTabs group="store" />
      <PaymentClient modes={modes} />
    </main>
  )
}
