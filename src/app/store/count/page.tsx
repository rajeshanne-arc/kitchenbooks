import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getIssueHistoryDays, listCounts } from '@/server/counts-queries'
import { listCountAcceptances } from '@/server/adjustment-queries'
import { FirstCountWarning } from '@/components/counts/CountEntry'
import Honesty, { HonestyPill } from '@/components/Honesty'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function CountsPage() {
  const restaurant = await getRestaurant()
  const [counts, acceptances, historyDays] = await Promise.all([
    listCounts(restaurant.id),
    listCountAcceptances(restaurant.id),
    getIssueHistoryDays(restaurant.id),
  ])

  // Acceptance is a property of the count, not of this page's rendering —
  // it is read from stock_counts.accepted_at, never inferred from whether
  // adjustments happen to exist.
  const accepted = new Map(acceptances.map((a) => [a.count_id, a]))
  // An unknown count reads as waiting, never as accepted: when the two reads
  // disagree the loud answer is the safe one.
  const waiting = counts.filter((c) => {
    const state = accepted.get(c.id)
    return state === undefined || state.accepted_at === null
  })

  return (
    <section className="mt-4 space-y-4">
      <FirstCountWarning days={historyDays} />

      {/* An unaccepted count is the quiet failure this screen exists to make
          loud: nothing looks broken, and the same variance comes back. */}
      {waiting.length > 0 && (
        <Honesty
          level="alarm"
          verdict={waiting.length === 1 ? 'not accepted' : 'not accepted yet'}
          meter={{ filled: counts.length - waiting.length, total: counts.length, unit: 'counts accepted' }}
        >
          {waiting.length === 1 ? 'One count has' : `${waiting.length} counts have`} been taken and nobody has decided
          what {waiting.length === 1 ? 'it' : 'they'} mean. A count records the variance and changes nothing — until
          somebody accepts it, the book still carries the old figure and the same difference will reappear at the next
          count with nobody knowing why. Open one below to accept it.
        </Honesty>
      )}

      <Link
        href="/store/count/new"
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
              const state = accepted.get(c.id)
              const isWaiting = state === undefined || state.accepted_at === null
              return (
                <li key={c.id}>
                  {/* HonestyPill, not a strip with an action: this row is
                      already a Link, and a link inside a link is invalid. */}
                  <Link
                    href={`/store/count/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-stone-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-stone-900">{fmtDate(c.count_date)}</span>
                      <span className="block text-xs text-stone-500">
                        {c.line_count} {c.line_count === 1 ? 'item' : 'items'}
                        {c.note !== null && <> · {c.note}</>}
                      </span>
                      <span className="mt-1 block text-xs">
                        {isWaiting ? (
                          <HonestyPill level="alarm">not accepted — the book still holds the old figure</HonestyPill>
                        ) : (
                          <span className="text-stone-500">
                            accepted
                            {state !== undefined && state.accepted_by !== null ? ` by ${state.accepted_by}` : ''}
                            {state !== undefined && state.variance_lines > 0 ? (
                              <>
                                {' '}
                                · {state.variance_lines} {state.variance_lines === 1 ? 'correction' : 'corrections'}{' '}
                                written
                              </>
                            ) : (
                              <> · the book was right, nothing written</>
                            )}
                          </span>
                        )}
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
