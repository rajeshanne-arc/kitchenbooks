import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { listStoreLog } from '@/server/store-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { ReversalBadge, VoidedBadge } from '@/components/books/Badges'

export const dynamic = 'force-dynamic'

export default async function StoreLogPage() {
  const restaurant = await getRestaurant()
  const rows = await listStoreLog(restaurant.id)

  if (rows.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
        <p className="text-lg font-semibold text-stone-900">No store activity yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
          Issues to sections and wastage entries land here, newest first — the store’s day, in one log.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            href="/issue"
            className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Issue to section
          </Link>
          <Link
            href="/wastage"
            className="rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:border-amber-400"
          >
            Record wastage
          </Link>
        </div>
      </div>
    )
  }

  return (
    <section className="mt-2">
      <ul className="divide-y divide-stone-100">
        {rows.map((r) => {
          const neg = decimalStringToPaise(r.value) < 0
          const href = r.kind === 'issue' ? (`/books/issues/${r.id}` as const) : (`/books/wastage/${r.id}` as const)
          return (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={href}
                className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                  r.is_reversal ? 'border-l-2 border-violet-300 pl-3' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-stone-900">
                      {r.kind === 'issue' ? `→ ${r.section_name}` : `Waste · ${r.item_name}`}
                    </span>
                    {r.is_voided && <VoidedBadge />}
                    {r.is_reversal && <ReversalBadge />}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {fmtDate(r.date)}
                    {r.kind === 'issue' ? (
                      <>
                        {' · '}
                        <span className="font-mono">{r.section_code}</span> · {r.line_count}{' '}
                        {r.line_count === 1 ? 'item' : 'items'}
                      </>
                    ) : (
                      <>
                        {' · '}
                        {r.qty} {r.purchase_unit} · {r.reason}
                      </>
                    )}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-[15px] font-semibold tabular-nums ${
                    neg ? 'text-red-700' : 'text-stone-900'
                  } ${r.is_voided ? 'text-stone-400 line-through decoration-stone-400' : ''}`}
                >
                  {formatMoneyString(r.value)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
