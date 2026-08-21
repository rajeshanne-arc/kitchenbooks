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
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import type { ReorderRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

// What to buy, grouped by who to buy it from — because the trip is the unit
// of work, not the item. One card per vendor is one phone call or one visit.
//
// AND ORDERED BY URGENCY, not by name. Alphabetical order cannot say that one
// item is out and another merely crossed its line an hour ago. Urgency is
// defined in the query and stated on this screen: how much of the reorder
// level is still on the shelf, lowest first. A vendor's place in the list is
// its MOST urgent item, because the decision this page drives is which call to
// make first — not which vendor comes first in the alphabet.
//
// VALUE IS DELIBERATELY ABSENT. An order goes to a vendor and is filled or it
// is not; what the stock is worth belongs to On hand, which is the owner's
// question. Three jobs, three orderings of one table.
//
// Every figure here is reorder_due's: on hand, the level it crossed, and the
// suggested quantity. Nothing is recomputed on this page.

/** ONE TABLE DEFINITION, rendered grouped and flat alike. Vendor is the trip;
 *  urgency is the risk — two real questions over the same rows, so the markup
 *  must not fork. `showVendor` is the only difference: inside a vendor card it
 *  would repeat the heading, and in the flat list it is the missing context. */
function ReorderTable({ rows, showVendor }: { rows: ReorderRow[]; showVendor: boolean }) {
  return (
      <div className="mt-2 overflow-x-auto">
        <table className={dataTableCls}>
          <thead>
            <tr>
              <th className={thCls}>Item</th>
              <th className={thCls}>Code</th>
      {showVendor && <th className={thCls}>Vendor</th>}
              <th className={thNumCls}>On hand</th>
              <th className={thNumCls}>Reorder at</th>
              <th className={thNumCls}>Suggested</th>
              <th className={thCls}>Unit</th>
              <th className={thNumCls}>Est. value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
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
      {showVendor && (
        <td className={`${tdCls} text-stone-500`}>{r.usual_vendor ?? 'no usual vendor'}</td>
      )}
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
  )
}

const VIEWS = [
  { value: 'by-vendor' as const, label: 'By vendor', hint: 'One card per supplier — the trip is the unit of work.' },
  { value: 'by-urgency' as const, label: 'By urgency', hint: 'One list, emptiest shelf first — the risk, regardless of who supplies it.' },
]

export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const view = readView('reorder', (await searchParams).view)
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
  // A vendor ranks by its MOST urgent line. `rows` arrives already sorted by
  // urgency, so that is simply the first one — the query's ordering survives
  // to the screen rather than being re-derived here.
  const urgencyOf = (g: { rows: typeof rows }): number => {
    const u = g.rows[0]?.urgency
    return u === null || u === undefined ? Number.POSITIVE_INFINITY : Number(u)
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.vendor === null) return 1 // "no usual vendor" sinks to the bottom
    if (b.vendor === null) return -1
    const d = urgencyOf(a) - urgencyOf(b)
    return d !== 0 ? d : (a.vendor ?? '').localeCompare(b.vendor ?? '')
  })

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Reorder</h1>
        <p className={pageSubCls}>
          {restaurant.name} — items at or below their reorder level, grouped by who supplies them, most
          urgent supplier first
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

          <ViewToggle
            param="view"
            value={view}
            options={VIEWS}
            defaultValue={VIEW_KEYS.reorder[0]}
            label="How to order what needs buying"
          />

          {view === 'by-urgency' ? (
            <section className={cardCls}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className={sectionHeadCls}>Emptiest first</h2>
                <span className="font-mono text-[11px] text-stone-400">
                  {rows.length} {rows.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              {/* `rows` arrives urgency-ordered from the query, so this is the
                  view's own ordering surviving to the screen untouched. */}
              <ReorderTable rows={rows} showVendor />
            </section>
          ) : (
          ordered.map((g) => (
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

              <ReorderTable rows={g.rows} showVendor={false} />

              {g.rows.some((r) => r.issue_cost === null) && (
                <p className="mt-2 text-xs text-stone-500">
                  Items with no purchase history yet show no estimated value — a bill gives them a cost.
                </p>
              )}
            </section>
          )))}

          {/* SLOW-MOVING is the same question from the other end — what to buy
              against what was over-bought — so it belongs next to this list
              rather than in a tab of its own. It was previously a chip
              pointing at /store/reorder/slow, a route that never existed, so
              it 404'd and nothing else linked to it either. */}
          <p className="text-sm text-stone-600">
            <Link href="/store/slow-moving" className="font-medium text-emerald-700 underline underline-offset-2">
              Slow-moving stock &rarr;
            </Link>{' '}
            — what is sitting unused, which is the same question from the other end.
          </p>

          <p className="text-xs text-stone-400">
            reorder_due · suggested quantity brings stock back to the par level where one is set
          </p>
        </div>
      )}
    </>
  )
}
