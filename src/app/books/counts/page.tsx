import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getIssueHistoryDays, listCounts } from '@/server/counts-queries'
import { FirstCountWarning } from '@/components/counts/CountEntry'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function CountsPage() {
  const restaurant = await getRestaurant()
  const [counts, historyDays] = await Promise.all([
    listCounts(restaurant.id),
    getIssueHistoryDays(restaurant.id),
  ])

  return (
    <section className="mt-4 space-y-4">
      <FirstCountWarning days={historyDays} />
      <Link
        href="/books/counts/new"
        className="block rounded-xl bg-emerald-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-800"
      >
        ＋ New count
      </Link>
      <div className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Counts</h2>
          <span className="text-xs text-stone-400">numbers frozen at count time · count_variances</span>
        </div>
        {counts.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            Nothing counted yet. A count freezes book stock and cost the moment it is saved, so the variance stays
            true even as stock moves on.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {counts.map((c) => {
              const total = decimalStringToPaise(c.total_variance_value)
              return (
                <li key={c.id}>
                  <Link
                    href={`/books/counts/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-stone-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-stone-900">{fmtDate(c.count_date)}</span>
                      <span className="block text-xs text-stone-500">
                        {c.line_count} {c.line_count === 1 ? 'item' : 'items'}
                        {c.note !== null && <> · {c.note}</>}
                      </span>
                    </span>
                    <span
                      className={`text-right text-[15px] font-semibold tabular-nums ${
                        total < 0 ? 'text-red-700' : 'text-stone-900'
                      }`}
                    >
                      {formatMoneyString(c.total_variance_value)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
