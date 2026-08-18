import { getRestaurant } from '@/server/queries'
import {
  creditNoteProgress,
  listAwaitingCreditNote,
  listCreditBillOptions,
  listReturnableBills,
  listVendorReturns,
} from '@/server/vendor-return-queries'
import { getList } from '@/server/settings'
import VendorReturnEntry from '@/components/store/VendorReturnEntry'
import VendorReturnList from '@/components/store/VendorReturnList'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// Goods going back to the vendor — the other half of Receive.
//
// The form is above and the waiting list below, on one screen on purpose: the
// person carrying a crate of rotten tomatoes out to a van is the same person
// who needs to know that the last three crates were never credited.

export default async function VendorReturnPage() {
  const restaurant = await getRestaurant()
  const [awaiting, recent, progress, bills, reasons] = await Promise.all([
    listAwaitingCreditNote(restaurant.id),
    listVendorReturns(restaurant.id),
    creditNoteProgress(restaurant.id),
    // A return is normally about a delivery, so the bills come with the page
    // rather than behind a search box — the same reasoning that opens the
    // payment screen on the dues queue instead of a vendor lookup.
    listReturnableBills(restaurant.id),
    getList(restaurant.id, 'vendor_return_reason'),
  ])
  // Only the vendors actually waiting on a credit note need their bills — one
  // query for all of them rather than one per open row.
  const billOptions = await listCreditBillOptions(
    restaurant.id,
    [...new Set(awaiting.map((r) => r.vendor_id))],
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Return to vendor</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what went back, and what credit is still owed for it
        </p>
      </header>
      <div className="space-y-6">
        <VendorReturnEntry bills={bills} reasons={reasons} />
        <VendorReturnList
          awaiting={awaiting}
          recent={recent}
          billOptions={billOptions}
          progress={progress}
        />
      </div>
    </>
  )
}
