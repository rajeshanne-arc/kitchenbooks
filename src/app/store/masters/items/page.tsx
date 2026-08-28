import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { StatusBadge } from '@/components/books/Badges'
import ShowClosed from '@/components/books/ShowClosed'
import { getRestaurant } from '@/server/queries'
import { listItems } from '@/server/books-queries'
import { formatMoneyString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; closed?: string }>
}) {
  const { q = '', closed } = await searchParams
  const restaurant = await getRestaurant()
  const showClosed = closed === '1'
  const items = await listItems(restaurant.id, q.slice(0, 60), showClosed)

  return (
    <section>
      <div className="mt-3 flex items-center justify-end">
        <Link
          href="/store/masters/items/new"
          className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          ＋ Add item
        </Link>
      </div>
      <Suspense>
        <FilterInput placeholder="Filter items by name or code" />
      </Suspense>
      {/* THE REVEAL. Browsing hides a merged or discarded row; searching finds
          it anyway, because a code somebody read off an old bill must still
          answer. This is for the third case — looking for what was closed. */}
      <Suspense>
        <ShowClosed on={showClosed} searching={q !== ''} noun="items" />
      </Suspense>
      {items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          {q !== '' ? (
            <p className="text-sm text-stone-500">No item matches “{q}”.</p>
          ) : (
            <>
              <p className="text-lg font-semibold text-stone-900">No items yet.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                Items are born on bills — pick a starter-library suggestion or type a new one while entering a bill, and
                it lands here with a code.
              </p>
              <Link
                href="/store/purchasing/receive"
                className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Enter a bill
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-rule-soft">
          {items.map((i) => (
            <li key={i.id}>
              <Link
                href={`/store/masters/items/${i.id}`}
                className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                  i.status === 'active' ? '' : 'opacity-60'
                }`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-stone-900">{i.name}</span>
                    <StatusBadge status={i.status} />
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-500">
                    <span className="font-mono">{i.code}</span> · {i.category_name} · per {i.purchase_unit}
                  </span>
                  {/* AFTER A DISCARD THERE IS NO NEGATIVE TWIN TO READ. The
                      approval's reason is the only account of why this code went
                      quiet that will ever exist, so the row that survives
                      carries it — with the name of whoever allowed it. */}
                  {(i.status === 'merged' || i.status === 'discarded') && (
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {i.merged_into_code != null && (
                        <>became <span className="font-mono">{i.merged_into_code}</span> · </>
                      )}
                      {i.closed_reason != null ? <>“{i.closed_reason}”</> : 'no reason recorded'}
                      {i.closed_by != null && <> · approved by {i.closed_by}</>}
                    </span>
                  )}
                </span>
                {i.prefill_rate !== null ? (
                  <span className="shrink-0 text-sm tabular-nums text-stone-500">
                    last {formatMoneyString(i.prefill_rate)}
                  </span>
                ) : (
                  <span className="shrink-0 text-sm text-stone-300">no rate yet</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
