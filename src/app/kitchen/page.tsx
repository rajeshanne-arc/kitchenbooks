// Kitchen dashboard — the chef's day at a glance. Every number reads a
// named table or view (issues, productions, kitchen_wastage,
// kitchen_closing_current, sales_current × pos_item_map, dish_costs) and
// every card drills to its source tab.
import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getKitchenDay, getWasteByReason } from '@/server/kitchen-queries'
import { getQtySold } from '@/server/sales-queries'
import { listDishCosts } from '@/server/recipes-queries'
import { monthStartIST, todayIST } from '@/server/store-queries'
import GroupTabs from '@/components/GroupTabs'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function KitchenDashboardPage() {
  const restaurant = await getRestaurant()
  const today = todayIST()
  const month = monthStartIST()
  const [day, wasteByReason, qtySold, dishCosts] = await Promise.all([
    getKitchenDay(restaurant.id, today),
    getWasteByReason(restaurant.id, month),
    getQtySold(restaurant.id, month),
    listDishCosts(restaurant.id),
  ])

  const perf = qtySold
    .map((q) => {
      const dish = dishCosts.find((d) => d.recipe_id === q.recipe_id)
      return dish === undefined ? null : { ...dish, qty_sold: q.qty_sold, sales_value: q.sales_value }
    })
    .filter((r) => r !== null)
    .sort((a, b) => decimalStringToPaise(b.sales_value) - decimalStringToPaise(a.sales_value))
    .slice(0, 10)

  const unclosed = day.filter((d) => d.closed === null).length

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Kitchen</h1>
        <p className="mt-0.5 text-sm text-stone-400">
          {restaurant.name} — {fmtDate(today)}
        </p>
      </header>
      <GroupTabs group="kitchen" />

      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Today per section</h2>
            <span className="text-xs text-stone-400">issued · produced · wasted · closed</span>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem] gap-1 border-b border-stone-200 pb-1.5 text-right">
            <span />
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Issued</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Produced</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Wasted</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Closed</span>
          </div>
          <ul className="divide-y divide-stone-100">
            {day.map((d) => (
              <li key={d.section_id} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem] items-center gap-1 py-2 text-right">
                <span className="truncate text-left text-sm text-stone-900">{d.section_name}</span>
                <span className="tabular-nums text-sm text-stone-700">{formatMoneyString(d.issued)}</span>
                <span className="tabular-nums text-sm text-stone-700">{formatMoneyString(d.produced)}</span>
                <span className={`tabular-nums text-sm ${decimalStringToPaise(d.wasted) > 0 ? 'text-red-700' : 'text-stone-400'}`}>
                  {formatMoneyString(d.wasted)}
                </span>
                {d.closed === null ? (
                  <span className="text-xs text-stone-400">not closed</span>
                ) : (
                  <span className="tabular-nums text-sm font-medium text-emerald-800">{formatMoneyString(d.closed)}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between">
            {unclosed > 0 ? (
              <span className="text-xs font-medium text-amber-700">{unclosed} sections not closed yet</span>
            ) : (
              <span className="text-xs text-emerald-700">all sections closed</span>
            )}
            <Link href="/kitchen/closing" className="text-xs font-medium text-emerald-700 hover:underline">
              go close →
            </Link>
          </div>
        </section>

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Dishes this month</h2>
            <span className="text-xs text-stone-400">mapped POS sales × live dish cost</span>
          </div>
          {perf.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              No mapped sales this month yet — fetch days and map POS items on the Sales page, and the menu starts
              talking.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-stone-100">
              {perf.map((p) => (
                <li key={p.recipe_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/books/recipes/${p.recipe_id}`} className="block truncate text-sm text-stone-900 hover:text-emerald-700">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-stone-500">
                      {p.qty_sold} sold · {formatMoneyString(p.sales_value)}
                      {p.uncosted_lines > 0 && <span className="text-amber-700"> · {p.uncosted_lines} uncosted lines</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums text-sm font-semibold text-stone-900">
                      {formatMoneyString(p.dish_cost)}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {p.food_cost_pct !== null ? `${p.food_cost_pct}% food cost` : 'no selling price'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Waste by reason — this month</h2>
            <Link href="/kitchen/wastage" className="text-xs font-medium text-emerald-700 hover:underline">
              record →
            </Link>
          </div>
          {wasteByReason.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">Nothing wasted this month. May it stay that way.</p>
          ) : (
            <ul className="mt-1 divide-y divide-stone-100">
              {wasteByReason.map((w) => (
                <li key={w.reason} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-stone-900">
                    {w.reason} <span className="text-xs text-stone-400">×{w.entries}</span>
                  </span>
                  <span className="tabular-nums text-sm font-semibold text-red-700">{formatMoneyString(w.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
