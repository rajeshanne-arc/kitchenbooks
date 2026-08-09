import Link from 'next/link'
import { Suspense } from 'react'
import FilterInput from '@/components/books/FilterInput'
import { RetiredBadge } from '@/components/books/Badges'
import { getRestaurant } from '@/server/queries'
import { listVendors } from '@/server/books-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const restaurant = await getRestaurant()
  const vendors = await listVendors(restaurant.id, q.slice(0, 60))

  return (
    <section>
      <Suspense>
        <FilterInput placeholder="Filter vendors by name or code" />
      </Suspense>
      {vendors.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
          {q !== '' ? (
            <p className="text-sm text-stone-500">No vendor matches “{q}”.</p>
          ) : (
            <>
              <p className="text-lg font-semibold text-stone-900">No vendors yet.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
                Vendors are born inside the bill flow — enter a bill from a new supplier and they appear here, code and
                all.
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
          {vendors.map((v) => {
            const balP = decimalStringToPaise(v.balance)
            return (
              <li key={v.id}>
                <Link
                  href={`/books/vendors/${v.id}`}
                  className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                    v.status === 'inactive' ? 'opacity-60' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-medium text-stone-900">{v.name}</span>
                      {v.status === 'inactive' && <RetiredBadge />}
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      <span className="font-mono">{v.code}</span> · {v.category_name}
                    </span>
                  </span>
                  {balP > 0 ? (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-700">
                      owes {formatMoneyString(v.balance)}
                    </span>
                  ) : balP < 0 ? (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700">
                      advance {formatMoneyString(v.balance)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm text-stone-300">settled</span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
