import { getRestaurant } from '@/server/queries'
import { getSupplierExposure } from '@/server/recipes-queries'
import { formatMoneyString } from '@/lib/money'
import {
  cardCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

// EXPOSURE, not spend. This is not what was bought — it is what the cooking
// DEPENDS ON. A supplier can appear here having sold nothing this month and
// still be the reason thirty dishes are possible.
//
// Sorted by DISHES because that is the ordering that matches the risk: if
// the big-money supplier fails you pay more, and if the thirty-dish
// supplier fails, a third of the menu stops.

export default async function SupplierExposurePage() {
  const restaurant = await getRestaurant()
  const rows = await getSupplierExposure(restaurant.id)
  const totalDishes = rows.reduce((n, r) => Math.max(n, r.dishes), 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Supplier exposure</h1>
        <p className={pageSubCls}>{restaurant.name} — how much of the menu depends on each supplier</p>
      </header>

      <p className="mb-4 rounded-xl border border-rule bg-stone-50 px-3 py-2 text-sm text-stone-700">
        This is <span className="font-medium">exposure, not spend</span>. It counts what the cooking depends on,
        not what was bought — a supplier who sold nothing this month can still be the reason thirty dishes are
        possible.
      </p>

      {rows.length === 0 ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing to show</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            No recipe line yet traces to an item with a usual vendor. Set usual vendors on items under Store →
            Masters, and the menu&apos;s dependencies appear here.
          </p>
        </section>
      ) : (
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Worst dependency first</h2>
            <span className="font-mono text-[10px] text-stone-400">supplier_costs</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Supplier</th>
                  <th className={thNumCls}>Dishes</th>
                  <th className={thCls}>
                    <span className="sr-only">Share of menu</span>
                  </th>
                  <th className={thNumCls}>Items</th>
                  <th className={thNumCls}>Batch cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplier} className={trCls}>
                    <td className={`${tdCls} font-medium`}>{r.supplier}</td>
                    <td className={`${tdNumCls} font-semibold`}>{r.dishes}</td>
                    <td className={tdCls}>
                      <span
                        aria-hidden
                        className="block h-1.5 rounded-full bg-emerald-700"
                        style={{ width: `${totalDishes === 0 ? 0 : (r.dishes / totalDishes) * 100}%` }}
                      />
                    </td>
                    <td className={`${tdNumCls} text-stone-500`}>{r.items}</td>
                    <td className={tdNumCls}>{formatMoneyString(r.batch_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Ordered by dishes, deliberately — a supplier behind {rows[0].dishes}{' '}
            {rows[0].dishes === 1 ? 'dish' : 'dishes'} is a harder problem than a larger figure behind two. A
            sub-recipe&apos;s ingredients are split across the suppliers inside it, so a gravy made of four
            suppliers&apos; goods exposes all four.
          </p>
        </section>
      )}
    </>
  )
}
