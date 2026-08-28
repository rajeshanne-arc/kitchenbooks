import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { countVendorsWithoutPhone, listPurchaseOrders } from '@/server/po-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import {
  btnCls,
  cardCls,
  codeCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import type { PoStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

// THE STORE'S OUTWARD DOCUMENT. Everything else in this app points inward — an
// indent is kitchen-to-store, a bill records what already arrived. This is the
// only thing that says "please send us this".
//
// TWO DOORS, AND THE ORDER OF THEM IS THE POINT. Reorder is the one that
// matters: it already knows what is short and who supplies it, so the
// suggestion is the feature. But raising an order from the shelf assumes all
// purchasing is REPLENISHMENT, and it is not — a party booking, a dish trial,
// a vendor's one-off deal will never appear in Reorder however good the levels
// get. New order is that exception, and it is named as one here so the
// suggested path does not quietly become the one nobody uses.

const TONE: Record<PoStatus, string> = {
  draft: 'text-stone-500',
  sent: 'text-emerald-700',
  received: 'text-stone-700',
  closed: 'text-stone-400',
  cancelled: 'text-red-700',
}

const WORD: Record<PoStatus, string> = {
  draft: 'draft — not sent',
  sent: 'sent',
  received: 'part received',
  closed: 'closed',
  cancelled: 'cancelled',
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const view = readView('orders', (await searchParams).view)
  const restaurant = await getRestaurant()
  const [orders, phones] = await Promise.all([
    listPurchaseOrders(restaurant.id, view === 'open'),
    countVendorsWithoutPhone(restaurant.id),
  ])

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="min-w-0">
          <h1 className={pageTitleCls}>Purchase orders</h1>
          <p className={pageSubCls}>
            {restaurant.name} — what was asked of a vendor, and what arrived against it. Most start in
            Reorder, where the shelf already says what is short; start one here for the buy it will never
            know about — a party, a trial, a one-off deal.
          </p>
        </div>
        {/* NO VENDOR PARAM. The picker on that page is the whole point of this
            door — Reorder already covers the case where the vendor is known. */}
        <Link href="/store/purchasing/orders/new" className={btnCls}>
          New order →
        </Link>
      </header>

      {/* THE BLOCKER, ON THE SCREEN THAT NEEDS IT. An order can always be
          written and printed; it can only be SENT to a vendor with a phone
          number, because wa.me is the channel. The figures are computed and
          the strip goes quiet on its own — so this comment names the rule and
          not the count. A comment quoting a live number has an expiry date,
          and this one had passed it: it read "not one of the five active
          vendors", from a dataset of five. There are 39. */}
      {phones.without > 0 && (
        <div className="mb-4">
          <Honesty
            verdict="nowhere to send them"
            level={phones.without === phones.total ? 'alarm' : 'pending'}
            meter={{ filled: phones.total - phones.without, total: phones.total, unit: 'vendors reachable' }}
            action={{ href: '/store/masters/vendors', label: 'Add numbers on the vendor master' }}
          >
            {phones.without} of {phones.total} active {phones.without === 1 ? 'vendor has' : 'vendors have'} no
            phone number, so an order to {phones.without === 1 ? 'them' : 'any of them'} can be written and
            printed but not sent. A purchase order with nowhere to send it is a PDF.
          </Honesty>
        </div>
      )}

      <ViewToggle
        param="view"
        value={view}
        options={[
          { value: 'open' as const, label: 'Open', hint: 'Drafts nobody has sent and orders nobody has delivered.' },
          { value: 'all' as const, label: 'All', hint: 'Every order raised, including cancelled ones.' },
        ]}
        defaultValue={VIEW_KEYS.orders[0]}
        label="Which orders to show"
      />

      <section className={`${cardCls} mt-3`}>
        {orders.length === 0 ? (
          <p className="text-sm text-stone-600">
            {view === 'open'
              ? 'No order is waiting on anybody. That is an empty list, not an empty store — raise one from Reorder when the shelf says so.'
              : 'No purchase order has been raised yet. The Reorder tab groups what is short by who supplies it, and each vendor there can be turned into one.'}{' '}
            <Link href="/store/stock/reorder" className="font-medium text-emerald-700 hover:underline">
              Reorder →
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Vendor</th>
                  <th className={thCls}>Date</th>
                  <th className={thNumCls}>Items</th>
                  <th className={thNumCls}>Value</th>
                  <th className={thCls}>State</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className={trCls}>
                    <td className={tdCodeCls}>
                      <Link href={`/store/purchasing/orders/${o.id}`} className="text-emerald-700 hover:underline">
                        {o.doc_no ?? '—'}
                      </Link>
                    </td>
                    <td className={tdCls}>
                      {o.vendor_name}
                      {o.vendor_phone === null && (
                        <span className="ml-1.5 text-[11px] text-red-700">no phone</span>
                      )}
                    </td>
                    <td className={`${tdCls} text-stone-600`}>{fmtDate(o.po_date)}</td>
                    <td className={tdNumCls}>{o.lines}</td>
                    <td className={tdNumCls}>{formatMoneyString(o.total)}</td>
                    <td className={`${tdCls} ${TONE[o.status]} text-[13px] font-medium`}>{WORD[o.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
