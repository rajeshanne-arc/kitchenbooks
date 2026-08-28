import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { countVendorsWithoutPhone, listPurchaseOrders } from '@/server/po-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import {
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
// only thing that says "please send us this", and it is raised from Reorder,
// where the app already knows what is short and who supplies it.

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
      <header className="pb-4">
        <h1 className={pageTitleCls}>Purchase orders</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what was asked of a vendor, and what arrived against it. Raised from Reorder,
          where the shelf already says what is short.
        </p>
      </header>

      {/* THE BLOCKER, ON THE SCREEN THAT NEEDS IT. Not one of the five active
          vendors has a phone number, so not one order can be sent. */}
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
