import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import {
  countItemsWithReorderLevel,
  listReorderDue,
} from '@/server/store-queries'
import { formatMoneyString } from '@/lib/money'
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
import Honesty from '@/components/Honesty'

export const dynamic = 'force-dynamic'

// What to buy, grouped by who to buy it from — because the trip is the unit
// of work, not the item. One card per vendor is one phone call or one visit.
//
// Every figure here is reorder_due's: on hand, the level it crossed, and the
// suggested quantity. Nothing is recomputed on this page.

export default async function ReorderPage() {
  const restaurant = await getRestaurant()
  const [rows, itemsWithLevel] = await Promise.all([
    listReorderDue(restaurant.id),
    countItemsWithReorderLevel(restaurant.id),
  ])

  // group by vendor, preserving the view's order within each group
  const groups = new Map<string, { vendor: string | null; vendorId: string | null; rows: typeof rows }>()
  for (const r of rows) {
    const key = r.vendor_id ?? '—'
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else groups.set(key, { vendor: r.usual_vendor, vendorId: r.vendor_id, rows: [r] })
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.vendor === null) return 1 // "no usual vendor" sinks to the bottom
    if (b.vendor === null) return -1
    return a.vendor.localeCompare(b.vendor)
  })

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Reorder</h1>
        <p className={pageSubCls}>
          {restaurant.name} — items at or below their reorder level, grouped by who supplies them
        </p>
      </header>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing to reorder</h2>
          {itemsWithLevel === 0 ? (
            <div className="mt-2">
              <Honesty verdict="not set up" compact>
                No item has a reorder level yet, so this list has nothing to test stock against. It is empty
                because the question has not been asked — not because the store is full. Set a reorder level on
                an item under Masters → Items.
              </Honesty>
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-stone-700">
              All {itemsWithLevel} {itemsWithLevel === 1 ? 'item that carries' : 'items that carry'} a reorder
              level {itemsWithLevel === 1 ? 'is' : 'are'} above it.
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-stone-700">
            {rows.length} {rows.length === 1 ? 'item needs' : 'items need'} reordering across{' '}
            {ordered.length} {ordered.length === 1 ? 'supplier' : 'suppliers'}.
          </p>

          {ordered.map((g) => (
            <section key={g.vendorId ?? 'none'} className={cardCls}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className={sectionHeadCls}>
                  {g.vendor ?? 'No usual vendor'}
                  <span className="ml-2 font-sans text-[11px] normal-case tracking-normal text-stone-400">
                    {g.rows.length} {g.rows.length === 1 ? 'item' : 'items'}
                  </span>
                </h2>
                {g.vendorId !== null && (
                  <Link
                    href={`/store/masters/vendors/${g.vendorId}`}
                    className="shrink-0 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    vendor page →
                  </Link>
                )}
              </div>

              {g.vendor === null && (
                <p className="mt-1.5 text-xs text-stone-500">
                  These items have no default vendor set — set one under Masters → Items so they join a trip.
                </p>
              )}

              <div className="mt-2 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Item</th>
                      <th className={thCls}>Code</th>
                      <th className={thNumCls}>On hand</th>
                      <th className={thNumCls}>Reorder at</th>
                      <th className={thNumCls}>Suggested</th>
                      <th className={thCls}>Unit</th>
                      <th className={thNumCls}>Est. value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const short = Number(r.on_hand_qty) < 0
                      const estimate =
                        r.issue_cost === null
                          ? null
                          : (Number(r.suggested_qty) * Number(r.issue_cost)).toFixed(2)
                      return (
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
                          <td className={`${tdNumCls} ${short ? 'font-semibold text-red-700' : ''}`}>
                            {r.on_hand_qty}
                          </td>
                          <td className={`${tdNumCls} text-stone-500`}>{r.reorder_level}</td>
                          <td className={`${tdNumCls} font-semibold`}>{r.suggested_qty}</td>
                          <td className={`${tdCls} text-stone-500`}>{r.purchase_unit}</td>
                          <td className={tdNumCls}>
                            {estimate === null ? (
                              <span className="text-stone-400">—</span>
                            ) : (
                              formatMoneyString(estimate)
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {g.rows.some((r) => r.issue_cost === null) && (
                <p className="mt-2 text-xs text-stone-500">
                  Items with no purchase history yet show no estimated value — a bill gives them a cost.
                </p>
              )}
            </section>
          ))}

          <p className="text-xs text-stone-400">
            reorder_due · suggested quantity brings stock back to the par level where one is set
          </p>
        </div>
      )}
    </>
  )
}
