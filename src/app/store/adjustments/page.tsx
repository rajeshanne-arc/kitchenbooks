import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { listAdjustments, listUnacceptedCounts } from '@/server/adjustment-queries'
import AdjustmentForm from '@/components/store/AdjustmentForm'
import Honesty from '@/components/Honesty'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

// Every correction the book has ever taken, and the two ways one is made:
// accepted from a count, or entered here on its own.
//
// A correction is an EVENT — it can never be edited or deleted, only stood
// beside. That is why this page reads as a log rather than a table of
// settings, and why the reason is on every row: months later the only
// question anyone asks about a ±40 kg is why.

export default async function AdjustmentsPage() {
  const restaurant = await getRestaurant()
  const [rows, unaccepted, reasons] = await Promise.all([
    listAdjustments(restaurant.id),
    listUnacceptedCounts(restaurant.id),
    getList(restaurant.id, 'adjustment_reason'),
  ])

  return (
    <section className="mt-4 space-y-4">
      <div>
        <h1 className={pageTitleCls}>Adjustments</h1>
        <p className={pageSubCls}>
          What the book was corrected by, when, and on whose say-so. Stock on hand already carries every row below.
        </p>
      </div>

      {unaccepted.length > 0 && (
        <Honesty
          level="alarm"
          verdict={unaccepted.length === 1 ? 'a count is waiting' : 'counts are waiting'}
          action={{
            href: `/store/count/${unaccepted[0].count_id}`,
            label: `Open the count of ${fmtDate(unaccepted[0].count_date)}`,
          }}
        >
          {unaccepted.length === 1 ? (
            <>A count from {fmtDate(unaccepted[0].count_date)} has not been accepted.</>
          ) : (
            <>
              {unaccepted.length} counts have not been accepted, the oldest from{' '}
              {fmtDate(unaccepted[0].count_date)}.
            </>
          )}{' '}
          Until somebody accepts {unaccepted.length === 1 ? 'it' : 'them'}, the book still carries the old figure and
          the same variance will turn up again at the next count with nobody knowing why.
        </Honesty>
      )}

      {/* The order below is the whole point of the flow, so it is numbered
          rather than described. Getting it wrong is silent. */}
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>Starting a book from scratch</h2>
        <p className="mt-1.5 text-sm text-stone-500">
          Opening stock is entered on purpose, in this order — it is never inferred from anything.
        </p>
        <ol className="mt-3 space-y-2.5 text-sm text-stone-700">
          <li className="flex gap-2.5">
            <span className="font-mono text-xs font-semibold text-stone-400">1</span>
            <span>
              Set the opening rate on every item that has stock —{' '}
              <Link href="/store/masters/items" className="font-medium text-emerald-700 underline underline-offset-2">
                Masters → Items
              </Link>
              .
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-mono text-xs font-semibold text-stone-400">2</span>
            <span>
              Count against the empty book —{' '}
              <Link href="/store/count/new" className="font-medium text-emerald-700 underline underline-offset-2">
                Count
              </Link>
              . Everything will show as a surplus, because the book holds nothing yet.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-mono text-xs font-semibold text-stone-400">3</span>
            <span>Accept that count. The surplus becomes the opening stock, one adjustment per item.</span>
          </li>
        </ol>
        <p className="mt-3 text-sm font-medium text-red-800">
          The order is not a preference. A count line freezes its unit cost from what the item has been costing, and
          an item with no purchases behind it costs nothing until an opening rate is set — so counting before the
          rates are in values the opening stock at ZERO and the books start wrong.
        </p>
      </section>

      <AdjustmentForm reasons={reasons} />

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>The log</h2>
          <span className="text-xs text-stone-400">stock_adjustments · value is qty × frozen cost</span>
        </div>
        <p className="mt-1.5 text-sm text-stone-500">
          A negative is stock the book thought it had and the shelf did not. A positive is stock that was there all
          along and the book had never been told about.
        </p>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            The book has never been corrected. Nothing is wrong with that — every count so far has either matched or
            is still waiting for somebody to accept it.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Date</th>
                  <th className={thCls}>Item</th>
                  <th className={thCls}>Code</th>
                  <th className={thNumCls}>Change</th>
                  <th className={thNumCls}>Cost</th>
                  <th className={thNumCls}>Value</th>
                  <th className={thCls}>Why</th>
                  <th className={thCls}>Entered</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  // A negative is stock the book thought it had and the
                  // shelf did not — the sign alone is easy to skim past.
                  const short = decimalStringToPaise(a.value) < 0
                  return (
                    <tr key={a.id} className={trCls}>
                      <td className={tdCls}>{fmtDate(a.adj_date)}</td>
                      <td className={tdCls}>{a.item_name}</td>
                      <td className={tdCodeCls}>{a.item_code}</td>
                      <td className={`${tdNumCls} ${short ? 'text-red-700' : 'text-stone-900'}`}>
                        {short ? a.qty : `+${a.qty}`} {a.purchase_unit}
                        <span className="block font-sans text-[11px] text-stone-500">
                          {short ? 'off the book' : 'onto the book'}
                        </span>
                      </td>
                      <td className={tdNumCls}>{formatMoneyString(a.unit_cost)}</td>
                      <td className={`${tdNumCls} ${short ? 'text-red-700' : 'text-stone-900'}`}>
                        {formatMoneyString(a.value)}
                      </td>
                      <td className={tdCls}>
                        <span className="block">{a.reason}</span>
                        {a.note !== null && <span className="block text-[11px] text-stone-500">{a.note}</span>}
                      </td>
                      <td className={tdCls}>
                        <span className="block text-xs text-stone-500">{a.entered_by ?? 'not recorded'}</span>
                        {/* Where a correction came from is half of what it
                            means — a count somebody accepted, or a decision
                            somebody made on its own. */}
                        {a.count_id !== null ? (
                          <Link
                            href={`/store/count/${a.count_id}`}
                            className="text-[11px] font-medium text-emerald-700 underline underline-offset-2"
                          >
                            from a count
                          </Link>
                        ) : (
                          <span className="text-[11px] text-stone-500">on its own</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
