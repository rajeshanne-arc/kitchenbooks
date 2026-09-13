import { getRestaurant } from '@/server/queries'
import AwaitingPanel, { MyOutcomesPanel } from '@/components/approvals/AwaitingPanel'
import { getList } from '@/server/settings'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getAgingCheck, listOldestBillsPerVendor, listVendorAging } from '@/server/aging-queries'
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
  // fetched once for the whole list rather than on expand — an expand that has
  // to fetch is worse than a link that moves you. The bills are capped in SQL
  // at the oldest three per vendor, so the payload does not grow with the
  // ledger: 250 unpaid bills across 28 vendors today, 84 rows shipped.
  const [modes, aging, accounts, check, bills] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listVendorAging(restaurant.id),
    listMoneyAccounts(restaurant.id),
    getAgingCheck(restaurant.id),
    listOldestBillsPerVendor(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Pay a vendor</h1>
        <p className={pageSubCls}>{restaurant.name} — oldest due first, from bills_outstanding</p>
      </header>
      <AwaitingPanel />
      <MyOutcomesPanel />
      <PaymentClient
        modes={modes}
        accounts={accounts}
        aging={aging}
        check={check}
        bills={bills}
        preopenVendorId={preselect ?? null}
      />
    </>
  )
}
