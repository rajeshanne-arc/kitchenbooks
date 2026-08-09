import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { RetiredBadge } from '@/components/books/Badges'
import { getRestaurant } from '@/server/queries'
import { listStock, stockTotalValue } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const restaurant = await getRestaurant()
  const [rows, total] = await Promise.all([listStock(restaurant.id, q.slice(0, 60)), stockTotalValue(restaurant.id)])

  return (
    <section>
      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Stock value on hand</span>
          <span className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
            {formatMoneyString(total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          purchases in, issues and wastage out, at weighted-average cost · stock_on_hand
        </p>
      </div>

      <Suspense>
        <FilterInput placeholder="Filter stock by item name or code" />
      </Suspense>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          {q !== '' ? (
            <p className="text-sm text-stone-500">No stock row matches “{q}”.</p>
          ) : (
            <>
              <p className="text-lg font-semibold text-stone-900">Nothing on hand yet.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                Stock builds from purchase bills, falls with issues and wastage — enter a bill and this page comes
                alive.
              </p>
              <Link
                href="/bill"
                className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Enter a bill
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100">
          {rows.map((r) => {
            const negative = decimalStringToPaise(r.on_hand_qty + '') < 0 || r.on_hand_qty.startsWith('-')
            return (
              <li key={r.item_id} className={r.status === 'inactive' ? 'opacity-60' : ''}>
                <div className="px-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/books/items/${r.item_id}`}
                          className="truncate text-[15px] font-medium text-stone-900 hover:underline"
                        >
                          {r.name}
                        </Link>
                        {r.status === 'inactive' && <RetiredBadge />}
                      </div>
                      <div className="mt-0.5 text-xs text-stone-500">
                        <span className="font-mono">{r.code}</span> · {r.category_name} · purchased {r.purchased_qty} ·
                        issued {r.issued_qty} · wasted {r.wasted_qty}
                        {r.issue_cost !== null && <> · avg {formatMoneyString(r.issue_cost)}/{r.purchase_unit}</>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`text-[15px] font-bold tabular-nums ${
                          negative ? 'text-red-700' : 'text-stone-900'
                        }`}
                      >
                        {r.on_hand_qty} {r.purchase_unit}
                      </div>
                      <div className={`text-xs tabular-nums ${negative ? 'text-red-600' : 'text-stone-500'}`}>
                        {formatMoneyString(r.on_hand_value)}
                      </div>
                    </div>
                  </div>
                  {negative && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
                      More issued than purchased on record — a bill is probably missing.
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
