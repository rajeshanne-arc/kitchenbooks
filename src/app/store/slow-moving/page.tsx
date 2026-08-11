import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSlowMovingStock } from '@/server/reports-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  cardCls, dataTableCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls,
  tdCls, tdCodeCls, tdNumCls, thCls, thNumCls, trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

// Slow-moving stock is CASH TIED UP — money already spent, sitting on a
// shelf, not turning into meals. It belongs beside Reorder because the two
// are the same question from opposite ends: what to buy, and what never
// should have been bought in that quantity.

export default async function SlowMovingPage() {
  const restaurant = await getRestaurant()
  const rows = await getSlowMovingStock(restaurant.id)
  const total = rows.reduce((n, r) => n + decimalStringToPaise(r.on_hand_value), 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Slow-moving stock</h1>
        <p className={pageSubCls}>{restaurant.name} — cash sitting on the shelf</p>
      </header>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing slow-moving</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            Every item with stock has been bought recently enough not to count as idle.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Tied up</h2>
              <span className="font-mono text-[10px] text-stone-400">slow_moving_stock</span>
            </div>
            <p className={`mt-1 text-[32px] ${heroNumCls} text-stone-900`}>{formatPaise(total)}</p>
            <p className="text-xs text-stone-600">
              across {rows.length} {rows.length === 1 ? 'item' : 'items'} — spent already, not yet food
            </p>
          </section>

          <section className={cardCls}>
            <h2 className={sectionHeadCls}>Worst first</h2>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Item</th>
                    <th className={thCls}>Code</th>
                    <th className={thNumCls}>On hand</th>
                    <th className={thCls}>Unit</th>
                    <th className={thNumCls}>Value</th>
                    <th className={thCls}>Last bought</th>
                    <th className={thNumCls}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.item_id} className={trCls}>
                      <td className={tdCls}>
                        <Link
                          href={`/store/masters/items/${r.item_id}`}
                          className="font-medium hover:text-emerald-700 hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className={tdCodeCls}>{r.code}</td>
                      <td className={tdNumCls}>{r.on_hand_qty}</td>
                      <td className={`${tdCls} text-stone-500`}>{r.purchase_unit}</td>
                      <td className={`${tdNumCls} font-semibold`}>{formatMoneyString(r.on_hand_value)}</td>
                      <td className={`${tdCls} text-stone-500`}>
                        {r.last_bought === null ? 'never' : fmtDate(r.last_bought)}
                      </td>
                      <td
                        className={`${tdNumCls} ${
                          r.days_since_bought !== null && r.days_since_bought > 60
                            ? 'font-semibold text-amber-800'
                            : 'text-stone-500'
                        }`}
                      >
                        {r.days_since_bought ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-400">
              &ldquo;Never&rdquo; means the item carries opening stock and has no purchase bill behind it.
            </p>
          </section>
        </div>
      )}
    </>
  )
}
