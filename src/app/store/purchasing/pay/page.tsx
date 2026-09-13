import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getAgingCheck, getVendorAging, listBillsOutstanding, listVendorAging } from '@/server/aging-queries'
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
  const [modes, aging, accounts, check] = await Promise.all([
    getList(restaurant.id, 'payment_mode'),
    listVendorAging(restaurant.id),
    listMoneyAccounts(restaurant.id),
    getAgingCheck(restaurant.id),
  ])

  // The preselected vendor's own row and bills, so the form opens with the
  // balance prefilled and says what it is made of.
  const [selectedAging, selectedBills] =
    preselect === undefined
      ? [null, []]
      : await Promise.all([getVendorAging(restaurant.id, preselect), listBillsOutstanding(restaurant.id, preselect)])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Pay a vendor</h1>
        <p className={pageSubCls}>{restaurant.name} — oldest due first, from bills_outstanding</p>
      </header>
      <PaymentClient
        modes={modes}
        accounts={accounts}
        aging={aging}
        check={check}
        preselectVendorId={preselect ?? null}
        selectedAging={selectedAging}
        selectedBills={selectedBills}
      />
    </>
  )
}
