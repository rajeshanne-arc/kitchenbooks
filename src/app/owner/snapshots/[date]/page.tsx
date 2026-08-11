import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getSnapshot } from '@/server/counts-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function SnapshotPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()
  const restaurant = await getRestaurant()
  const rows = await getSnapshot(restaurant.id, date)
  if (rows.length === 0) notFound()

  return (
    <div className="mt-4">
      <Link href="/kitchen/recipes" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Recipes
      </Link>
      <section className={`${cardCls} mt-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-stone-900">Photograph — {fmtDate(date)}</h2>
          <span className="text-xs text-stone-400">
            {rows.length} {rows.length === 1 ? 'dish' : 'dishes'} · dish_cost_snapshots
          </span>
        </div>
        <p className="mt-0.5 text-xs text-stone-400">
          Costs as they stood that day. The live recipe pages have moved on; this page never will.
        </p>
        <ul className="mt-3 divide-y divide-rule-soft">
          {rows.map((r, i) => (
            <li key={`${r.code}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium text-stone-900">
                  <code className="mr-1.5 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700">
                    {r.code}
                  </code>
                  {r.name}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[15px] font-semibold tabular-nums text-stone-900">
                  {r.dish_cost !== null ? formatMoneyString(r.dish_cost) : '—'}
                </span>
                {r.food_cost_pct !== null && r.selling_price !== null && (
                  <span className="block text-xs tabular-nums text-stone-500">
                    {r.food_cost_pct}% of {formatMoneyString(r.selling_price)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
