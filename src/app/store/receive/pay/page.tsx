import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { listVendorsWithDues } from '@/server/books-queries'
import PaymentClient from '@/components/store/PaymentClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// The payment tab opens on the QUEUE, not on a search box. Nobody arrives
// here wondering who to pay — they arrive because something is owed, and the
// list of who is owed what, worst first, is the answer to the question they
// walked in with. Search is still there for the vendor who is owed nothing.

export default async function StorePaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>
}) {
  const { vendor: preselect } = await searchParams
  const restaurant = await getRestaurant()
  const [modes, dues] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listVendorsWithDues(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Pay a vendor</h1>
        <p className={pageSubCls}>
          {restaurant.name} — dues come live from vendor_dues; the payment is one INSERT
        </p>
      </header>
      <PaymentClient modes={modes} dues={dues} preselectVendorId={preselect ?? null} />
    </>
  )
}
