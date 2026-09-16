import { getRestaurant } from '@/server/queries'
import AwaitingPanel, { MyOutcomesPanel } from '@/components/approvals/AwaitingPanel'
import { GROUP_QUEUE_ROLE } from '@/server/approvals-queries'
import { getList } from '@/server/settings'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getAgingCheck, listVendorAging } from '@/server/aging-queries'
import PaymentClient from '@/components/store/PaymentClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// THE QUEUE IS ORDERED BY WHEN, NOT BY HOW MUCH.
//
// It used to open on vendor_dues sorted by balance, which answers "who is owed
// most" — a different question from the one the person walked in with. On live
// data the two disagree: K.RAJA is due 19 July for ₹10,458 and sits near the
// bottom by balance, while the largest balance is not the oldest debt.
//
// The store manager should not have to remember who is due.

export default async function StorePaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>
}) {
  const { vendor: preselect } = await searchParams
  const restaurant = await getRestaurant()
  // EVERYTHING THE EXPANSION NEEDS TRAVELS WITH THE QUEUE. A row opens IN
  // PLACE, so the bills it is made of and the vendor's routing details are
  // THE CAPPED PREVIEW IS GONE, AND WITH IT A QUERY. It shipped the oldest
  // three unpaid bills per vendor so an expanded row could state a composition
  // without fetching. The row now shows the RANGE and the bills inside it from
  // the moment it opens — all of them for one vendor, fetched by the row
  // itself — so the three-per-vendor payload had no reader left.
  const [modes, aging, accounts, check] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listVendorAging(restaurant.id),
    listMoneyAccounts(restaurant.id),
    getAgingCheck(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Pay a vendor</h1>
        <p className={pageSubCls}>{restaurant.name} — oldest due first, from bills_outstanding</p>
      </header>
      <AwaitingPanel role={GROUP_QUEUE_ROLE.store} />
      <MyOutcomesPanel entityTypes={['vendor']} />
      <PaymentClient
        modes={modes}
        accounts={accounts}
        aging={aging}
        check={check}
        preopenVendorId={preselect ?? null}
      />
    </>
  )
}
